//! Schema snapshot for the entity-relationship diagram: tables, their columns
//! and every foreign key of one database, fetched in a single round of calls.

use futures_util::stream::{self, StreamExt};
use serde::Serialize;

use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::introspect::introspector;
use super::models::ForeignKeyMetadata;

/// Column lookups run concurrently, but bounded so big schemas don't
/// exhaust the connection pool.
const COLUMN_FETCH_CONCURRENCY: usize = 6;

#[derive(Debug, Clone, Serialize)]
pub struct ErColumn {
    pub name: String,
    pub column_type: String,
    pub is_nullable: bool,
    pub is_primary_key: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ErTable {
    pub name: String,
    pub is_view: bool,
    pub columns: Vec<ErColumn>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ErRelation {
    pub table: String,
    pub foreign_key: ForeignKeyMetadata,
}

#[derive(Debug, Clone, Serialize)]
pub struct ErSchema {
    pub database: String,
    pub tables: Vec<ErTable>,
    pub relations: Vec<ErRelation>,
}

/// Foreign keys of other tables (or the same one) that point at `table`.
pub async fn fetch_referencing_relations(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: &str,
) -> Result<Vec<ErRelation>, PyroError> {
    let mut relations: Vec<ErRelation> = introspector(backend)
        .foreign_keys(backend, database)
        .await?
        .into_iter()
        .flat_map(|(child, fks)| {
            fks.into_iter()
                .filter(|fk| fk.referenced_table == table)
                .map(move |fk| ErRelation {
                    table: child.clone(),
                    foreign_key: fk,
                })
        })
        .collect();
    relations.sort_by(|a, b| {
        (&a.table, &a.foreign_key.column_name).cmp(&(&b.table, &b.foreign_key.column_name))
    });
    Ok(relations)
}

pub async fn fetch_er_schema(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<ErSchema, PyroError> {
    let schema = introspector(backend);
    let table_list = schema.list_tables(backend, database).await?;

    let mut tables: Vec<ErTable> = stream::iter(table_list)
        .map(|meta| async move {
            let columns = schema.table_columns(backend, database, &meta.name).await?;
            let is_view = meta.table_type.to_ascii_uppercase().contains("VIEW");
            Ok::<_, PyroError>(ErTable {
                name: meta.name,
                is_view,
                columns: columns
                    .into_iter()
                    .map(|c| ErColumn {
                        is_primary_key: c.column_key.eq_ignore_ascii_case("PRI"),
                        name: c.name,
                        column_type: c.column_type,
                        is_nullable: c.is_nullable,
                    })
                    .collect(),
            })
        })
        .buffer_unordered(COLUMN_FETCH_CONCURRENCY)
        .collect::<Vec<_>>()
        .await
        .into_iter()
        .collect::<Result<_, _>>()?;
    tables.sort_by(|a, b| a.name.cmp(&b.name));

    let mut relations: Vec<ErRelation> = schema
        .foreign_keys(backend, database)
        .await?
        .into_iter()
        .flat_map(|(table, fks)| {
            fks.into_iter().map(move |fk| ErRelation {
                table: table.clone(),
                foreign_key: fk,
            })
        })
        .collect();
    relations.sort_by(|a, b| {
        (&a.table, &a.foreign_key.name, &a.foreign_key.column_name).cmp(&(
            &b.table,
            &b.foreign_key.name,
            &b.foreign_key.column_name,
        ))
    });

    Ok(ErSchema {
        database: database.to_string(),
        tables,
        relations,
    })
}

#[cfg(test)]
mod tests {
    use super::fetch_er_schema;
    use crate::db::sqlite::tests::TempDatabase;

    #[tokio::test]
    async fn reads_tables_keys_and_relations() {
        let db = TempDatabase::with_schema(
            "CREATE TABLE customer (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
             CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customer(id));
             CREATE VIEW big_orders AS SELECT * FROM orders;",
        )
        .await;

        let schema = fetch_er_schema(&db.backend, "main").await.unwrap();

        let names: Vec<_> = schema.tables.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, ["big_orders", "customer", "orders"]);
        assert!(schema.tables[0].is_view);
        let customer = &schema.tables[1];
        assert!(customer.columns[0].is_primary_key);
        assert!(!customer.columns[1].is_nullable);

        assert_eq!(schema.relations.len(), 1);
        let relation = &schema.relations[0];
        assert_eq!(relation.table, "orders");
        assert_eq!(relation.foreign_key.column_name, "customer_id");
        assert_eq!(relation.foreign_key.referenced_table, "customer");

        let referencing = super::fetch_referencing_relations(&db.backend, "main", "customer")
            .await
            .unwrap();
        assert_eq!(referencing.len(), 1);
        assert_eq!(referencing[0].table, "orders");
        assert!(
            super::fetch_referencing_relations(&db.backend, "main", "orders")
                .await
                .unwrap()
                .is_empty()
        );
    }
}
