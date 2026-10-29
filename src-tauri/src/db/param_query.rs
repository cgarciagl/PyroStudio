/// Engine-neutral value bound to a `?` placeholder.
#[derive(Debug, Clone, PartialEq)]
pub enum SqlParam {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Text(String),
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
