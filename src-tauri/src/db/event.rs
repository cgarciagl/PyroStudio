use super::backend::DatabaseBackend;
use super::error::PyroError;
use super::models::{EventDetail, EventMetadata};
use super::sql_utils::quote_identifier;

/// Lists all scheduled events in the specified database.
pub async fn list_events(
    backend: &dyn DatabaseBackend,
    database: &str,
) -> Result<Vec<EventMetadata>, PyroError> {
    let clean_db = database.replace('\'', "''");
    let sql = format!(
        r#"
        SELECT 
            EVENT_NAME,
            DEFINER,
            TIME_ZONE,
            EVENT_TYPE,
            EXECUTE_AT,
            INTERVAL_VALUE,
            INTERVAL_FIELD,
            STATUS,
            STARTS,
            ENDS,
            EVENT_COMMENT
        FROM information_schema.EVENTS
        WHERE EVENT_SCHEMA = '{clean_db}'
        ORDER BY EVENT_NAME ASC
        "#
    );

    let res = backend.execute_query(&sql, Some(database)).await?;
    let mut events = Vec::new();

    for r in res.rows {
        let name = r
            .get(0)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        if name.is_empty() {
            continue;
        }

        let definer = r.get(1).and_then(|v| v.as_str()).map(|s| s.to_string());
        let time_zone = r.get(2).and_then(|v| v.as_str()).map(|s| s.to_string());
        let event_type = r
            .get(3)
            .and_then(|v| v.as_str())
            .unwrap_or("RECURRING")
            .to_string();
        let execute_at = r.get(4).and_then(|v| v.as_str()).map(|s| s.to_string());
        let interval_value = r.get(5).and_then(|v| v.as_str()).map(|s| s.to_string());
        let interval_field = r.get(6).and_then(|v| v.as_str()).map(|s| s.to_string());
        let status = r
            .get(7)
            .and_then(|v| v.as_str())
            .unwrap_or("ENABLED")
            .to_string();
        let starts = r.get(8).and_then(|v| v.as_str()).map(|s| s.to_string());
        let ends = r.get(9).and_then(|v| v.as_str()).map(|s| s.to_string());
        let comment = r.get(10).and_then(|v| v.as_str()).map(|s| s.to_string());

        events.push(EventMetadata {
            name,
            definer,
            time_zone,
            event_type,
            execute_at,
            interval_value,
            interval_field,
            status,
            starts,
            ends,
            comment,
        });
    }

    Ok(events)
}

/// Retrieves the DDL and detailed configuration of a scheduled event.
pub async fn get_event_definition(
    backend: &dyn DatabaseBackend,
    database: &str,
    event_name: &str,
) -> Result<EventDetail, PyroError> {
    let q_db = quote_identifier(database)?;
    let q_ev = quote_identifier(event_name)?;
    let sql = format!("SHOW CREATE EVENT {q_db}.{q_ev}");

    let res = backend.execute_query(&sql, Some(database)).await?;
    let row = res.rows.first().ok_or_else(|| {
        PyroError::Database(format!(
            "No se encontró la definición del evento '{event_name}'"
        ))
    })?;

    // SHOW CREATE EVENT returns: Event, sql_mode, time_zone, Create Event, character_set_client, ...
    let ddl = row
        .iter()
        .find_map(|v| {
            if let Some(s) = v.as_str() {
                if s.to_uppercase().contains("CREATE") && s.to_uppercase().contains("EVENT") {
                    return Some(s.to_string());
                }
            }
            None
        })
        .unwrap_or_else(|| format!("-- No se pudo extraer DDL completo para '{event_name}'"));

    // Also get info from information_schema
    let clean_db = database.replace('\'', "''");
    let clean_ev = event_name.replace('\'', "''");
    let info_sql = format!(
        r#"
        SELECT STATUS, EVENT_TYPE, EVENT_BODY, STARTS, ENDS, INTERVAL_VALUE, INTERVAL_FIELD
        FROM information_schema.EVENTS
        WHERE EVENT_SCHEMA = '{clean_db}' AND EVENT_NAME = '{clean_ev}'
        LIMIT 1
        "#
    );

    let (status, event_type, body, starts, ends, interval_expr) =
        if let Ok(info_res) = backend.execute_query(&info_sql, Some(database)).await {
            if let Some(ir) = info_res.rows.first() {
                let st = ir
                    .first()
                    .and_then(|v| v.as_str())
                    .unwrap_or("ENABLED")
                    .to_string();
                let et = ir
                    .get(1)
                    .and_then(|v| v.as_str())
                    .unwrap_or("RECURRING")
                    .to_string();
                let bd = ir.get(2).and_then(|v| v.as_str()).unwrap_or("").to_string();
                let s = ir.get(3).and_then(|v| v.as_str()).map(|x| x.to_string());
                let e = ir.get(4).and_then(|v| v.as_str()).map(|x| x.to_string());
                let iv = ir.get(5).and_then(|v| v.as_str()).unwrap_or("");
                let ifield = ir.get(6).and_then(|v| v.as_str()).unwrap_or("");
                let ie = if !iv.is_empty() {
                    Some(format!("{iv} {ifield}"))
                } else {
                    None
                };
                (st, et, et_or(bd, &ddl), s, e, ie)
            } else {
                (
                    "ENABLED".into(),
                    "RECURRING".into(),
                    ddl.clone(),
                    None,
                    None,
                    None,
                )
            }
        } else {
            (
                "ENABLED".into(),
                "RECURRING".into(),
                ddl.clone(),
                None,
                None,
                None,
            )
        };

    Ok(EventDetail {
        name: event_name.to_string(),
        ddl,
        status,
        event_type,
        body,
        starts,
        ends,
        interval_expr,
    })
}

fn et_or(val: String, fallback: &str) -> String {
    if !val.trim().is_empty() {
        val
    } else {
        fallback.to_string()
    }
}

/// Toggles an event between ENABLE and DISABLE.
pub async fn toggle_event(
    backend: &dyn DatabaseBackend,
    database: &str,
    event_name: &str,
    enable: bool,
) -> Result<(), PyroError> {
    let q_db = quote_identifier(database)?;
    let q_ev = quote_identifier(event_name)?;
    let action = if enable { "ENABLE" } else { "DISABLE" };
    let sql = format!("ALTER EVENT {q_db}.{q_ev} {action};");

    backend.execute_query(&sql, Some(database)).await?;
    Ok(())
}

/// Drops a scheduled event.
pub async fn drop_event(
    backend: &dyn DatabaseBackend,
    database: &str,
    event_name: &str,
) -> Result<(), PyroError> {
    let q_db = quote_identifier(database)?;
    let q_ev = quote_identifier(event_name)?;
    let sql = format!("DROP EVENT IF EXISTS {q_db}.{q_ev};");

    backend.execute_query(&sql, Some(database)).await?;
    Ok(())
}
