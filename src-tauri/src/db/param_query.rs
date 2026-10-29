/// Engine-neutral value bound to a `?` placeholder.
#[derive(Debug, Clone, PartialEq)]
pub enum SqlParam {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Text(String),
}

impl SqlParam {
    /// Same conversion the grid relies on: the text `NULL` means SQL `NULL`.
    pub fn from_json(value: &serde_json::Value) -> Self {
        use serde_json::Value;
        match value {
            Value::Null => Self::Null,
            Value::Bool(flag) => Self::Bool(*flag),
            Value::Number(number) => {
                if let Some(integer) = number.as_i64() {
                    Self::Int(integer)
                } else if let Some(unsigned) = number.as_u64() {
                    Self::Int(unsigned as i64)
                } else if let Some(float) = number.as_f64() {
                    Self::Float(float)
                } else {
                    Self::Text(number.to_string())
                }
            }
            Value::String(text) if text.eq_ignore_ascii_case("NULL") => Self::Null,
            Value::String(text) => Self::Text(text.clone()),
            other => Self::Text(other.to_string()),
        }
    }
}

/// Parameterized statement built with `?` placeholders, understood by every
/// supported engine (MariaDB/MySQL and SQLite). Values are never interpolated.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParamQuery {
    sql: String,
    params: Vec<SqlParam>,
}

impl ParamQuery {
    pub fn new(sql: impl Into<String>) -> Self {
        Self {
            sql: sql.into(),
            params: Vec::new(),
        }
    }

    pub fn push(&mut self, sql: &str) -> &mut Self {
        self.sql.push_str(sql);
        self
    }

    pub fn push_bind(&mut self, param: SqlParam) -> &mut Self {
        self.sql.push('?');
        self.params.push(param);
        self
    }

    /// Appends a parenthesized tuple of placeholders: `(?, ?, ?)`.
    pub fn push_bind_tuple(&mut self, params: impl IntoIterator<Item = SqlParam>) -> &mut Self {
        self.sql.push('(');
        for (index, param) in params.into_iter().enumerate() {
            if index > 0 {
                self.sql.push_str(", ");
            }
            self.push_bind(param);
        }
        self.sql.push(')');
        self
    }

    /// Appends a fragment that already holds one `?` per value of `params`.
    pub fn push_bound_fragment(
        &mut self,
        sql: &str,
        params: impl IntoIterator<Item = SqlParam>,
    ) -> &mut Self {
        self.sql.push_str(sql);
        self.params.extend(params);
        self
    }

    pub fn sql(&self) -> &str {
        &self.sql
    }

    pub fn params(&self) -> &[SqlParam] {
        &self.params
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binds_values_as_placeholders_in_order() {
        let mut query = ParamQuery::new("UPDATE t SET a = ");
        query
            .push_bind(SqlParam::Text("O'Reilly".into()))
            .push(" WHERE id = ")
            .push_bind(SqlParam::Int(7));
        assert_eq!(query.sql(), "UPDATE t SET a = ? WHERE id = ?");
        assert_eq!(
            query.params(),
            &[SqlParam::Text("O'Reilly".into()), SqlParam::Int(7)]
        );
    }

    #[test]
    fn bind_tuple_separates_each_placeholder_once() {
        let mut query = ParamQuery::new("INSERT INTO t (a, b) VALUES ");
        query
            .push_bind_tuple([SqlParam::Int(1), SqlParam::Null])
            .push(", ")
            .push_bind_tuple([SqlParam::Bool(true), SqlParam::Float(2.5)]);
        assert_eq!(query.sql(), "INSERT INTO t (a, b) VALUES (?, ?), (?, ?)");
        assert_eq!(query.params().len(), 4);
    }
}
