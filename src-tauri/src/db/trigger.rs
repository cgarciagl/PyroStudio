use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::models::{TriggerDetail, TriggerMetadata};
use super::sql_utils::qualify_table;

/// Lists all triggers for a database or table.
pub async fn list_triggers(
    backend: &dyn DatabaseBackend,
    database: &str,
    table: Option<&str>,
) -> Result<Vec<TriggerMetadata>, PyroError> {
    let clean_db = database.replace('\'', "''");

    let table_filter = if let Some(tbl) = table {
        if !tbl.is_empty() {
            format!("AND EVENT_OBJECT_TABLE = '{}'", tbl.replace('\'', "''"))
        } else {
            "".to_string()
        }
    } else {
        "".to_string()
    };

    let sql = format!(
        r#"
        SELECT 
            TRIGGER_NAME,
            EVENT_OBJECT_TABLE,
            ACTION_TIMING,
            EVENT_MANIPULATION,
            DEFINER,
            DATE_FORMAT(CREATED, '%Y-%m-%d %H:%i:%s') AS CREATED
        FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = '{clean_db}' {table_filter}
        ORDER BY EVENT_OBJECT_TABLE ASC, TRIGGER_NAME ASC
        "#
    );

    let res = backend.execute_query(&sql, Some(database)).await?;
    let mut triggers = Vec::new();

    for row in res.rows {
        let name = row
            .get(0)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let table_name = row
            .get(1)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let timing = row
            .get(2)
            .and_then(|v| v.as_str())
            .unwrap_or("BEFORE")
            .to_string();
        let event = row
            .get(3)
            .and_then(|v| v.as_str())
            .unwrap_or("INSERT")
            .to_string();
        let definer = row.get(4).and_then(|v| v.as_str()).map(|s| s.to_string());
        let created = row.get(5).and_then(|v| v.as_str()).map(|s| s.to_string());

        if !name.is_empty() {
            triggers.push(TriggerMetadata {
                name,
                table_name,
                timing,
                event,
                definer,
                created,
            });
        }
    }

    Ok(triggers)
}

/// Retrieves the DDL and configuration details of a trigger.
pub async fn get_trigger_definition(
    backend: &dyn DatabaseBackend,
    database: &str,
    name: &str,
) -> Result<TriggerDetail, PyroError> {
    let db_arg = if database.trim().is_empty() {
        None
    } else {
        Some(database)
    };
    let trigger_ref = qualify_table(db_arg, name)?;

    let show_sql = format!("SHOW CREATE TRIGGER {trigger_ref}");
    let res = backend.execute_query(&show_sql, db_arg).await?;

    let mut ddl = String::new();
    let mut table_name = String::new();
    let mut timing = "BEFORE".to_string();
    let mut event = "INSERT".to_string();

    if let Some(row) = res.rows.first() {
        if let Some(s) = row.get(2).and_then(|v| v.as_str()) {
            ddl = s.to_string();
        } else if let Some(s) = row.get(1).and_then(|v| v.as_str()) {
            ddl = s.to_string();
        }
    }

    let esc_db = database.replace('\'', "''");
    let esc_name = name.replace('\'', "''");
    let meta_sql = format!(
        "SELECT EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = '{esc_db}' AND TRIGGER_NAME = '{esc_name}'"
    );
    if let Ok(meta_res) = backend.execute_query(&meta_sql, db_arg).await {
        if let Some(r) = meta_res.rows.first() {
            if let Some(tbl) = r.get(0).and_then(|v| v.as_str()) {
                table_name = tbl.to_string();
            }
            if let Some(tim) = r.get(1).and_then(|v| v.as_str()) {
                timing = tim.to_string();
            }
            if let Some(ev) = r.get(2).and_then(|v| v.as_str()) {
                event = ev.to_string();
            }
        }
    }

    Ok(TriggerDetail {
        name: name.to_string(),
        table_name,
        timing,
        event,
        ddl,
    })
}

/// Drops a trigger.
pub async fn drop_trigger(
    backend: &dyn DatabaseBackend,
    database: &str,
    name: &str,
) -> Result<(), PyroError> {
    let db_arg = if database.trim().is_empty() {
        None
    } else {
        Some(database)
    };
    let trigger_ref = qualify_table(db_arg, name)?;
    let sql = format!("DROP TRIGGER IF EXISTS {trigger_ref}");
    backend.execute_query(&sql, db_arg).await?;
    Ok(())
}

/// Saves a trigger, replacing any previous version if renamed.
pub async fn save_trigger(
    backend: &dyn DatabaseBackend,
    database: &str,
    old_name: Option<&str>,
    ddl: &str,
) -> Result<(), PyroError> {
    let db_arg = if database.trim().is_empty() {
        None
    } else {
        Some(database)
    };

    if let Some(name) = old_name {
        if !name.trim().is_empty() {
            let old_ref = qualify_table(db_arg, name.trim())?;
            let drop_sql = format!("DROP TRIGGER IF EXISTS {old_ref}");
            backend.execute_query(&drop_sql, db_arg).await?;
        }
    }

    backend.execute_query(ddl, db_arg).await?;
    Ok(())
}
