//! Column editor for MariaDB/MySQL.
//!
//! Uses the same column model as the schema designer, so an edit keeps what
//! the dialog does not show (`ON UPDATE`, `UNSIGNED`, expression defaults),
//! refuses generated columns, warns about data loss and drops and restores
//! the foreign keys that MySQL would not let the column change under.

use serde::{Deserialize, Serialize};

use super::backend::DatabaseBackend;
use super::engine::DbEngine;
use super::error::PyroError;
use super::introspect::introspector;
use super::models::ForeignKeyMetadata;
use super::schema_design::{
    column_sql, data_loss_risks, design_column, foreign_key_clause, is_safe_column_type,
    is_safe_expression, is_safe_word, key, normalized_type, qi, DesignColumn, DesignForeignKey,
};

const ENGINE: DbEngine = DbEngine::MySql;

#[derive(Debug, Clone, Deserialize)]
pub struct MySqlColumnChangeRequest {
    pub database: String,
    pub table: String,
    /// Current name of the column.
    pub column: String,
    /// New definition; `primary_key` and `generated` are taken from the database.
    pub definition: DesignColumn,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ColumnChangePlan {
    pub statements: Vec<String>,
    pub warnings: Vec<String>,
}

/// Plan plus what is needed to undo the foreign key drops if the change fails.
#[derive(Debug)]
struct Planned {
    plan: ColumnChangePlan,
    /// Number of leading `DROP FOREIGN KEY` statements.
    dropped: usize,
    /// `ADD CONSTRAINT` statements that restore the dropped keys as they were.
    restore: Vec<String>,
}

fn invalid(message: impl Into<String>) -> PyroError {
    PyroError::InvalidOperation(message.into())
}

/// Columns of one table read like the designer reads them.
pub async fn design_columns(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<Vec<DesignColumn>, PyroError> {
    let engine = backend.engine();
    Ok(introspector(backend)
        .table_columns(backend, database, table)
        .await?
        .into_iter()
        .map(|c| design_column(engine, c, true))
        .collect())
}

/// Groups per-column foreign key rows into multi-column keys.
fn group_foreign_keys(rows: Vec<ForeignKeyMetadata>) -> Vec<DesignForeignKey> {
    let mut keys: Vec<DesignForeignKey> = Vec::new();
    for row in rows {
        match keys.iter_mut().find(|k| k.name == row.name) {
            Some(existing) => {
                existing.columns.push(row.column_name);
                existing.referenced_columns.push(row.referenced_column);
            }
            None => keys.push(DesignForeignKey {
                name: row.name,
                columns: vec![row.column_name],
                referenced_table: row.referenced_table,
                referenced_columns: vec![row.referenced_column],
                on_delete: row.delete_rule,
                on_update: row.update_rule,
            }),
        }
    }
    keys
}

fn validate(definition: &DesignColumn) -> Result<(), PyroError> {
    if definition.name.trim().is_empty() {
        return Err(invalid("El nombre de la columna no puede estar vacío."));
    }
    if !is_safe_column_type(&definition.column_type) {
        return Err(invalid("Tipo de dato no válido."));
    }
    if definition.default_is_expression
        && definition
            .default_value
            .as_deref()
            .is_some_and(|d| !is_safe_expression(d))
    {
        return Err(invalid("La expresión del valor por defecto no es válida."));
    }
    let words = [
        &definition.on_update,
        &definition.collation,
        &definition.charset,
    ];
    if words
        .iter()
        .any(|w| w.as_deref().is_some_and(|v| !is_safe_word(v)))
    {
        return Err(invalid("Atributos de columna no válidos."));
    }
    Ok(())
}

/// Statements for a column change, pure so it can be tested without a server.
fn build_plan(
    table: &str,
    columns: &[DesignColumn],
    old_name: &str,
    requested: &DesignColumn,
    foreign_keys: &[(String, DesignForeignKey)],
    column_types: &dyn Fn(&str, &str) -> Option<String>,
) -> Result<Planned, PyroError> {
    let old = columns
        .iter()
        .find(|c| key(&c.name) == key(old_name))
        .ok_or_else(|| invalid(format!("No se encontró la columna `{old_name}`.")))?;
    if old.generated {
        return Err(invalid(format!(
            "`{}` es una columna generada: su expresión no se puede editar aquí sin perderla. Usa el editor SQL.",
            old.name
        )));
    }
    validate(requested)?;
    let mut definition = requested.clone();
    definition.name = definition.name.trim().to_string();
    definition.primary_key = old.primary_key;
    definition.generated = false;
    if key(&definition.name) != key(&old.name)
        && columns
            .iter()
            .any(|c| key(&c.name) == key(&definition.name))
    {
        return Err(invalid(format!(
            "Ya existe una columna llamada `{}`.",
            definition.name
        )));
    }

    let mut comparable = old.clone();
    comparable.charset = definition.charset.clone();
    comparable.original_name = definition.original_name.clone();
    if comparable == definition {
        return Ok(Planned {
            plan: ColumnChangePlan {
                statements: Vec::new(),
                warnings: Vec::new(),
            },
            dropped: 0,
            restore: Vec::new(),
        });
    }

    let mut warnings: Vec<String> = data_loss_risks(old, &definition);
    let retyped = normalized_type(&old.column_type) != normalized_type(&definition.column_type)
        || old.collation.as_deref().map(key) != definition.collation.as_deref().map(key)
        || definition.charset.is_some();

    let mut drops = Vec::new();
    let mut adds = Vec::new();
    let mut restore = Vec::new();
    if retyped {
        for (owner, fk) in foreign_keys {
            let owns =
                key(owner) == key(table) && fk.columns.iter().any(|c| key(c) == key(old_name));
            let referenced = key(&fk.referenced_table) == key(table)
                && fk
                    .referenced_columns
                    .iter()
                    .any(|c| key(c) == key(old_name));
            if !owns && !referenced {
                continue;
            }
            let rename = |names: &[String], applies: bool| -> Vec<String> {
                names
                    .iter()
                    .map(|n| {
                        if applies && key(n) == key(old_name) {
                            definition.name.clone()
                        } else {
                            n.clone()
                        }
                    })
                    .collect()
            };
            let mut renamed = fk.clone();
            renamed.columns = rename(&fk.columns, key(owner) == key(table));
            renamed.referenced_columns = rename(&fk.referenced_columns, referenced);
            drops.push(format!(
                "ALTER TABLE {} DROP FOREIGN KEY {};",
                qi(ENGINE, owner),
                qi(ENGINE, &fk.name)
            ));
            adds.push(format!(
                "ALTER TABLE {} ADD {};",
                qi(ENGINE, owner),
                foreign_key_clause(ENGINE, &renamed)
            ));
            restore.push(format!(
                "ALTER TABLE {} ADD {};",
                qi(ENGINE, owner),
                foreign_key_clause(ENGINE, fk)
            ));

            // The other side of the key must end up with a compatible type.
            let new_type = normalized_type(&definition.column_type);
            let pairs: Vec<(String, String)> = if referenced {
                fk.columns
                    .iter()
                    .zip(&fk.referenced_columns)
                    .filter(|(_, r)| key(r) == key(old_name))
                    .map(|(c, _)| (owner.clone(), c.clone()))
                    .collect()
            } else {
                fk.columns
                    .iter()
                    .zip(&fk.referenced_columns)
                    .filter(|(c, _)| key(c) == key(old_name))
                    .map(|(_, r)| (fk.referenced_table.clone(), r.clone()))
                    .collect()
            };
            for (other_table, other_column) in pairs {
                if key(&other_table) == key(table) && key(&other_column) == key(old_name) {
                    continue;
                }
                if let Some(other_type) = column_types(&other_table, &other_column) {
                    if normalized_type(&other_type) != new_type {
                        warnings.push(format!(
                            "La clave foránea `{}` no podrá restaurarse: `{}.{}` es {} y la columna pasará a {}. Cambia también esa columna.",
                            fk.name,
                            other_table,
                            other_column,
                            other_type,
                            definition.column_type.trim()
                        ));
                    }
                }
            }
        }
        if !drops.is_empty() {
            warnings.push(format!(
                "Se quitarán y restaurarán {} clave(s) foránea(s) que usan la columna.",
                drops.len()
            ));
        }
    }

    let change = format!(
        "ALTER TABLE {} CHANGE COLUMN {} {};",
        qi(ENGINE, table),
        qi(ENGINE, &old.name),
        column_sql(ENGINE, &definition, true)
    );
    let dropped = drops.len();
    let mut statements = drops;
    statements.push(change);
    statements.extend(adds);
    Ok(Planned {
        plan: ColumnChangePlan {
            statements,
            warnings,
        },
        dropped,
        restore,
    })
}

async fn plan_internal(
    backend: &dyn DatabaseBackend,
    req: &MySqlColumnChangeRequest,
) -> Result<Planned, PyroError> {
    if backend.engine() != ENGINE {
        return Err(invalid("La operación solo aplica a MariaDB/MySQL."));
    }
    let columns = design_columns(backend, &req.database, &req.table).await?;
    let schema = introspector(backend);
    let mut foreign_keys = Vec::new();
    for (owner, rows) in schema.foreign_keys(backend, &req.database).await? {
        for fk in group_foreign_keys(rows) {
            foreign_keys.push((owner.clone(), fk));
        }
    }
    // Types of the columns on the other side of the affected keys.
    let mut other_types: Vec<(String, String, String)> = Vec::new();
    let mut loaded: Vec<String> = Vec::new();
    for (owner, fk) in &foreign_keys {
        for table in [owner, &fk.referenced_table] {
            if loaded.iter().any(|t| key(t) == key(table)) {
                continue;
            }
            loaded.push(table.clone());
            if key(table) == key(&req.table) {
                continue;
            }
            let uses_column = (key(owner) == key(&req.table)
                && fk.columns.iter().any(|c| key(c) == key(&req.column)))
                || (key(&fk.referenced_table) == key(&req.table)
                    && fk
                        .referenced_columns
                        .iter()
                        .any(|c| key(c) == key(&req.column)));
            if !uses_column {
                loaded.pop();
                continue;
            }
            for column in design_columns(backend, &req.database, table).await? {
                other_types.push((table.clone(), column.name, column.column_type));
            }
        }
    }
    let lookup = |table: &str, column: &str| {
        other_types
            .iter()
            .find(|(t, c, _)| key(t) == key(table) && key(c) == key(column))
            .map(|(_, _, ty)| ty.clone())
    };
    build_plan(
        &req.table,
        &columns,
        &req.column,
        &req.definition,
        &foreign_keys,
        &lookup,
    )
}

/// Statements and warnings shown to the user before the change runs.
pub async fn plan_column_change(
    backend: &dyn DatabaseBackend,
    req: &MySqlColumnChangeRequest,
) -> Result<ColumnChangePlan, PyroError> {
    Ok(plan_internal(backend, req).await?.plan)
}

/// Plans again and applies. If the column change fails after its foreign keys
/// were dropped, those keys are restored as they were before reporting the error.
pub async fn apply_column_change(
    backend: &dyn DatabaseBackend,
    req: &MySqlColumnChangeRequest,
) -> Result<(), PyroError> {
    let planned = plan_internal(backend, req).await?;
    let database = Some(req.database.as_str());
    for (index, sql) in planned.plan.statements.iter().enumerate() {
        if let Err(error) = backend.execute_query(sql, database).await {
            let change_index = planned.dropped;
            if index > change_index {
                return Err(invalid(format!(
                    "La columna se modificó, pero no se pudo restaurar una clave foránea ({error}). Sentencia pendiente: {sql}"
                )));
            }
            let mut unrestored = Vec::new();
            for restore in planned.restore.iter().take(index) {
                if backend.execute_query(restore, database).await.is_err() {
                    unrestored.push(restore.clone());
                }
            }
            if unrestored.is_empty() {
                return Err(error);
            }
            return Err(invalid(format!(
                "{error}. Además no se pudieron restaurar estas claves foráneas: {}",
                unrestored.join(" ")
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn col(name: &str, column_type: &str) -> DesignColumn {
        DesignColumn {
            name: name.into(),
            original_name: Some(name.into()),
            column_type: column_type.into(),
            nullable: true,
            ..Default::default()
        }
    }

    fn no_types(_: &str, _: &str) -> Option<String> {
        None
    }

    #[test]
    fn keeps_on_update_unsigned_and_expression_defaults() {
        let mut updated = col("updated", "timestamp");
        updated.default_value = Some("current_timestamp()".into());
        updated.default_is_expression = true;
        updated.on_update = Some("current_timestamp()".into());
        let mut qty = col("qty", "int(10) unsigned");
        qty.default_value = Some("activo".into());
        let columns = vec![updated.clone(), qty.clone()];

        let mut edited = updated.clone();
        edited.comment = "última edición".into();
        let plan = build_plan("t", &columns, "updated", &edited, &[], &no_types).unwrap();
        assert_eq!(
            plan.plan.statements,
            vec!["ALTER TABLE `t` CHANGE COLUMN `updated` `updated` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp() COMMENT 'última edición';"]
        );

        let mut renamed = qty.clone();
        renamed.name = "cantidad".into();
        let plan = build_plan("t", &columns, "qty", &renamed, &[], &no_types).unwrap();
        assert!(plan.plan.statements[0]
            .contains("CHANGE COLUMN `qty` `cantidad` int(10) unsigned NULL DEFAULT 'activo'"));
    }

    #[test]
    fn unchanged_column_has_no_statements() {
        let columns = vec![col("a", "varchar(10)")];
        let plan = build_plan("t", &columns, "a", &columns[0], &[], &no_types).unwrap();
        assert!(plan.plan.statements.is_empty());
    }

    #[test]
    fn generated_columns_and_name_clashes_are_refused() {
        let mut total = col("total", "decimal(10,2)");
        total.generated = true;
        let columns = vec![total.clone(), col("b", "int")];
        assert!(build_plan("t", &columns, "total", &total, &[], &no_types).is_err());

        let mut clash = col("b", "int");
        clash.name = "TOTAL".into();
        let error = build_plan("t", &columns, "b", &clash, &[], &no_types).unwrap_err();
        assert!(error.to_string().contains("Ya existe"));
    }

    #[test]
    fn retyping_drops_and_restores_foreign_keys_on_both_sides() {
        let mut id = col("id", "int(11)");
        id.primary_key = true;
        id.nullable = false;
        let columns = vec![id.clone()];
        let fk = DesignForeignKey {
            name: "fk_ped_cli".into(),
            columns: vec!["cliente_id".into()],
            referenced_table: "clientes".into(),
            referenced_columns: vec!["id".into()],
            on_delete: "CASCADE".into(),
            on_update: "RESTRICT".into(),
        };
        let mut wide = id.clone();
        wide.column_type = "bigint(20)".into();
        let types = |table: &str, column: &str| {
            (table == "pedidos" && column == "cliente_id").then(|| "int(11)".to_string())
        };
        let plan = build_plan(
            "clientes",
            &columns,
            "id",
            &wide,
            &[("pedidos".into(), fk)],
            &types,
        )
        .unwrap();
        let s = &plan.plan.statements;
        assert_eq!(s[0], "ALTER TABLE `pedidos` DROP FOREIGN KEY `fk_ped_cli`;");
        assert!(s[1].starts_with("ALTER TABLE `clientes` CHANGE COLUMN `id` `id` bigint(20)"));
        assert!(s[2].starts_with("ALTER TABLE `pedidos` ADD CONSTRAINT `fk_ped_cli`"));
        assert_eq!(plan.dropped, 1);
        assert!(plan
            .plan
            .warnings
            .iter()
            .any(|w| w.contains("`pedidos.cliente_id` es int(11)")));
    }

    #[test]
    fn narrowing_warns_about_data_loss() {
        let columns = vec![col("name", "varchar(100)")];
        let mut narrow = columns[0].clone();
        narrow.column_type = "varchar(20)".into();
        narrow.nullable = false;
        let plan = build_plan("t", &columns, "name", &narrow, &[], &no_types).unwrap();
        assert_eq!(plan.plan.warnings.len(), 2);
    }
}
