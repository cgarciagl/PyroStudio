use super::models::{
    ColumnMetadata, DiffType, MigrationPlan, MigrationStatement, SchemaDiffResult,
};
use super::safe_mode::DangerLevel;

/// Generates a column definition fragment for CREATE/ALTER TABLE
pub fn format_column_definition(col: &ColumnMetadata) -> String {
    let mut def = format!("`{}` {}", col.name, col.column_type);

    if !col.is_nullable {
        def.push_str(" NOT NULL");
    } else {
        def.push_str(" NULL");
    }

    if let Some(ref default_val) = col.column_default {
        if default_val.eq_ignore_ascii_case("current_timestamp")
            || default_val.starts_with("current_timestamp(")
            || default_val.eq_ignore_ascii_case("null")
        {
            def.push_str(&format!(" DEFAULT {default_val}"));
        } else {
            def.push_str(&format!(" DEFAULT '{default_val}'"));
        }
    }

    if !col.extra.is_empty() {
        def.push_str(&format!(" {}", col.extra));
    }

    if !col.comment.is_empty() {
        def.push_str(&format!(" COMMENT '{}'", col.comment.replace('\'', "''")));
    }

    def
}

/// Generates executable MariaDB/MySQL SQL migration scripts from a SchemaDiffResult.
pub fn generate_migration_plan(diff: &SchemaDiffResult) -> MigrationPlan {
    let mut statements = Vec::new();
    let mut warnings = Vec::new();

    // 1. Process Tables
    for tbl in &diff.tables {
        match tbl.diff_type {
            DiffType::Added => {
                let mut lines = Vec::new();
                let mut pk_cols = Vec::new();

                for col_diff in &tbl.columns {
                    if let Some(ref col) = col_diff.source_column {
                        lines.push(format!("  {}", format_column_definition(col)));
                        if col.column_key.eq_ignore_ascii_case("pri") {
                            pk_cols.push(format!("`{}`", col.name));
                        }
                    }
                }

                if !pk_cols.is_empty() {
                    lines.push(format!("  PRIMARY KEY ({})", pk_cols.join(", ")));
                }

                for idx_diff in &tbl.indexes {
                    if let Some(ref idx) = idx_diff.source_index {
                        if !idx.is_primary {
                            let idx_type = if idx.is_unique { "UNIQUE KEY" } else { "KEY" };
                            let cols_str = idx
                                .columns
                                .iter()
                                .map(|c| format!("`{}`", c.column_name))
                                .collect::<Vec<_>>()
                                .join(", ");
                            lines.push(format!("  {} `{}` ({})", idx_type, idx.key_name, cols_str));
                        }
                    }
                }

                let engine_str = tbl.source_engine.as_deref().unwrap_or("InnoDB");
                let coll_str = tbl
                    .source_collation
                    .as_deref()
                    .map(|c| format!(" COLLATE={c}"))
                    .unwrap_or_default();

                let sql = format!(
                    "CREATE TABLE IF NOT EXISTS `{}` (\n{}\n) ENGINE={}{};",
                    tbl.table_name,
                    lines.join(",\n"),
                    engine_str,
                    coll_str
                );

                statements.push(MigrationStatement {
                    sql,
                    description: format!("Crear nueva tabla `{}`", tbl.table_name),
                    is_destructive: false,
                    danger_level: DangerLevel::Safe,
                    target_object: tbl.table_name.clone(),
                });
            }
            DiffType::Removed => {
                warnings.push(format!(
                    "Eliminación destructiva de la tabla `{}`.",
                    tbl.table_name
                ));
                statements.push(MigrationStatement {
                    sql: format!("DROP TABLE IF EXISTS `{}`;", tbl.table_name),
                    description: format!(
                        "Eliminar tabla obsoleta `{}` (¡PÉRDIDA DE DATOS!)",
                        tbl.table_name
                    ),
                    is_destructive: true,
                    danger_level: DangerLevel::Critical,
                    target_object: tbl.table_name.clone(),
                });
            }
            DiffType::Modified => {
                // Column modifications
                for col_diff in &tbl.columns {
                    match col_diff.diff_type {
                        DiffType::Added => {
                            if let Some(ref col) = col_diff.source_column {
                                let col_def = format_column_definition(col);
                                statements.push(MigrationStatement {
                                    sql: format!(
                                        "ALTER TABLE `{}` ADD COLUMN {};",
                                        tbl.table_name, col_def
                                    ),
                                    description: format!(
                                        "Agregar columna `{}` en `{}`",
                                        col.name, tbl.table_name
                                    ),
                                    is_destructive: false,
                                    danger_level: DangerLevel::Safe,
                                    target_object: tbl.table_name.clone(),
                                });
                            }
                        }
                        DiffType::Removed => {
                            warnings.push(format!(
                                "Eliminación de columna `{}` en tabla `{}`.",
                                col_diff.name, tbl.table_name
                            ));
                            statements.push(MigrationStatement {
                                sql: format!(
                                    "ALTER TABLE `{}` DROP COLUMN `{}`;",
                                    tbl.table_name, col_diff.name
                                ),
                                description: format!(
                                    "Eliminar columna `{}` en `{}` (¡PÉRDIDA DE DATOS!)",
                                    col_diff.name, tbl.table_name
                                ),
                                is_destructive: true,
                                danger_level: DangerLevel::Critical,
                                target_object: tbl.table_name.clone(),
                            });
                        }
                        DiffType::Modified => {
                            if let Some(ref col) = col_diff.source_column {
                                let col_def = format_column_definition(col);
                                statements.push(MigrationStatement {
                                    sql: format!(
                                        "ALTER TABLE `{}` MODIFY COLUMN {};",
                                        tbl.table_name, col_def
                                    ),
                                    description: format!(
                                        "Modificar definición de columna `{}` en `{}`",
                                        col.name, tbl.table_name
                                    ),
                                    is_destructive: false,
                                    danger_level: DangerLevel::Medium,
                                    target_object: tbl.table_name.clone(),
                                });
                            }
                        }
                        DiffType::Identical => {}
                    }
                }

                // Index modifications
                for idx_diff in &tbl.indexes {
                    match idx_diff.diff_type {
                        DiffType::Added => {
                            if let Some(ref idx) = idx_diff.source_index {
                                if !idx.is_primary {
                                    let idx_type = if idx.is_unique { "UNIQUE" } else { "INDEX" };
                                    let cols_str = idx
                                        .columns
                                        .iter()
                                        .map(|c| format!("`{}`", c.column_name))
                                        .collect::<Vec<_>>()
                                        .join(", ");
                                    statements.push(MigrationStatement {
                                        sql: format!(
                                            "ALTER TABLE `{}` ADD {} `{}` ({});",
                                            tbl.table_name, idx_type, idx.key_name, cols_str
                                        ),
                                        description: format!(
                                            "Agregar índice `{}` en `{}`",
                                            idx.key_name, tbl.table_name
                                        ),
                                        is_destructive: false,
                                        danger_level: DangerLevel::Safe,
                                        target_object: tbl.table_name.clone(),
                                    });
                                }
                            }
                        }
                        DiffType::Removed => {
                            statements.push(MigrationStatement {
                                sql: format!(
                                    "ALTER TABLE `{}` DROP INDEX `{}`;",
                                    tbl.table_name, idx_diff.name
                                ),
                                description: format!(
                                    "Eliminar índice `{}` en `{}`",
                                    idx_diff.name, tbl.table_name
                                ),
                                is_destructive: false,
                                danger_level: DangerLevel::Medium,
                                target_object: tbl.table_name.clone(),
                            });
                        }
                        DiffType::Modified => {
                            if let Some(ref idx) = idx_diff.source_index {
                                if !idx.is_primary {
                                    let idx_type = if idx.is_unique { "UNIQUE" } else { "INDEX" };
                                    let cols_str = idx
                                        .columns
                                        .iter()
                                        .map(|c| format!("`{}`", c.column_name))
                                        .collect::<Vec<_>>()
                                        .join(", ");
                                    statements.push(MigrationStatement {
                                        sql: format!(
                                            "ALTER TABLE `{}` DROP INDEX `{}`, ADD {} `{}` ({});",
                                            tbl.table_name,
                                            idx.key_name,
                                            idx_type,
                                            idx.key_name,
                                            cols_str
                                        ),
                                        description: format!(
                                            "Recrear índice modificado `{}` en `{}`",
                                            idx.key_name, tbl.table_name
                                        ),
                                        is_destructive: false,
                                        danger_level: DangerLevel::Medium,
                                        target_object: tbl.table_name.clone(),
                                    });
                                }
                            }
                        }
                        DiffType::Identical => {}
                    }
                }

                // Foreign Key modifications
                for fk_diff in &tbl.foreign_keys {
                    match fk_diff.diff_type {
                        DiffType::Added => {
                            if let Some(ref fk) = fk_diff.source_fk {
                                statements.push(MigrationStatement {
                                    sql: format!(
                                        "ALTER TABLE `{}` ADD CONSTRAINT `{}` FOREIGN KEY (`{}`) REFERENCES `{}` (`{}`) ON DELETE {} ON UPDATE {};",
                                        tbl.table_name, fk.name, fk.column_name, fk.referenced_table, fk.referenced_column, fk.delete_rule, fk.update_rule
                                    ),
                                    description: format!("Agregar Foreign Key `{}` en `{}`", fk.name, tbl.table_name),
                                    is_destructive: false,
                                    danger_level: DangerLevel::Safe,
                                    target_object: tbl.table_name.clone(),
                                });
                            }
                        }
                        DiffType::Removed => {
                            statements.push(MigrationStatement {
                                sql: format!(
                                    "ALTER TABLE `{}` DROP FOREIGN KEY `{}`;",
                                    tbl.table_name, fk_diff.name
                                ),
                                description: format!(
                                    "Eliminar Foreign Key `{}` en `{}`",
                                    fk_diff.name, tbl.table_name
                                ),
                                is_destructive: false,
                                danger_level: DangerLevel::Medium,
                                target_object: tbl.table_name.clone(),
                            });
                        }
                        _ => {}
                    }
                }
            }
            DiffType::Identical => {}
        }
    }

    // 2. Process Views
    for v_diff in &diff.views {
        match v_diff.diff_type {
            DiffType::Added | DiffType::Modified => {
                if let Some(ref def) = v_diff.source_definition {
                    statements.push(MigrationStatement {
                        sql: format!("CREATE OR REPLACE VIEW `{}` AS {};", v_diff.name, def),
                        description: format!("Actualizar vista `{}`", v_diff.name),
                        is_destructive: false,
                        danger_level: DangerLevel::Safe,
                        target_object: v_diff.name.clone(),
                    });
                }
            }
            DiffType::Removed => {
                statements.push(MigrationStatement {
                    sql: format!("DROP VIEW IF EXISTS `{}`;", v_diff.name),
                    description: format!("Eliminar vista `{}`", v_diff.name),
                    is_destructive: false,
                    danger_level: DangerLevel::Medium,
                    target_object: v_diff.name.clone(),
                });
            }
            DiffType::Identical => {}
        }
    }

    let mut full_sql = String::new();
    full_sql.push_str(
        "-- ----------------------------------------------------------------------------\n",
    );
    full_sql.push_str(&format!(
        "-- Migration generated by PyroStudio Schema Diff\n-- Source: {}\n-- Target: {}\n",
        diff.source_schema, diff.target_schema
    ));
    full_sql.push_str(
        "-- ----------------------------------------------------------------------------\n\n",
    );
    full_sql.push_str("SET FOREIGN_KEY_CHECKS = 0;\n\n");

    for stmt in &statements {
        full_sql.push_str(&format!("-- {}\n{}\n\n", stmt.description, stmt.sql));
    }

    full_sql.push_str("SET FOREIGN_KEY_CHECKS = 1;\n");

    let total = statements.len();

    MigrationPlan {
        source_schema: diff.source_schema.clone(),
        target_schema: diff.target_schema.clone(),
        statements,
        full_sql,
        warnings,
        total_statements: total,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{ColumnDiff, ColumnMetadata, DiffType, TableDiff};

    #[test]
    fn test_generate_migration_for_added_column() {
        let diff = SchemaDiffResult {
            source_schema: "prod".to_string(),
            target_schema: "dev".to_string(),
            tables: vec![TableDiff {
                table_name: "customers".to_string(),
                diff_type: DiffType::Modified,
                columns: vec![ColumnDiff {
                    name: "phone".to_string(),
                    diff_type: DiffType::Added,
                    source_column: Some(ColumnMetadata {
                        name: "phone".to_string(),
                        ordinal_position: 3,
                        column_default: None,
                        is_nullable: true,
                        data_type: "varchar".to_string(),
                        column_type: "varchar(30)".to_string(),
                        column_key: "".to_string(),
                        extra: "".to_string(),
                        comment: "".to_string(),
                        collation: None,
                        character_set: None,
                    }),
                    target_column: None,
                    change_details: vec![],
                }],
                indexes: vec![],
                foreign_keys: vec![],
                source_engine: None,
                target_engine: None,
                source_collation: None,
                target_collation: None,
                change_details: vec![],
            }],
            routines: vec![],
            triggers: vec![],
            views: vec![],
            total_differences: 1,
        };

        let plan = generate_migration_plan(&diff);
        assert_eq!(plan.statements.len(), 1);
        assert!(plan.statements[0]
            .sql
            .contains("ALTER TABLE `customers` ADD COLUMN `phone` varchar(30) NULL;"));
    }
}
