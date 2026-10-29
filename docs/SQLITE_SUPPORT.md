# Soporte SQLite: estado y pendientes

Rama: `feat/sqlite-support`. Este documento resume la arquitectura y lo que
falta para que la siguiente sesión retome sin perder contexto.

## Arquitectura (hecho)

| Pieza | Ubicación | Notas |
| --- | --- | --- |
| Motor de la conexión | `db/engine.rs` (`DbEngine`), `ConnectionConfig.engine` / `file_path` | Perfiles sin `engine` = MySQL (`#[serde(default)]`). |
| Contrato de backend | `db/backend.rs` | `engine()`, `stream_rows`, `begin_transaction`, `execute_params`, `table_transactionality`. |
| MySQL | `db/mysql/` | Único lugar con tipos `MySql*`. Introspección movida sin cambios. |
| SQLite | `db/sqlite/` | `backend` (1 conexión, cancelación por progress handler), `row` (por clase de almacenamiento), `introspector` (`sqlite_master`/`pragma_*`), `alter` (12 pasos), `tests`. |
| Dialecto SQL | `db/dialect.rs` | Comillas, literales, BEGIN, LIMIT de fila, TRUNCATE, upsert, índices, rename. |
| Introspección | `db/introspect.rs` | `SchemaIntrospector`; los módulos `table/index/trigger/database/inspector` delegan. |
| Capacidades | `db/features.rs`, `capabilities.rs` | `EngineFeature`; la UI usa `supportsFeature` / `useFeatureGate`. |
| Túnel PHP SQLite | `tunnel/pyro_tunnel_sqlite.php` + `tunnel/tests/tunnel_sqlite_test.php` | Cliente envía `dbfile`; celdas decodificadas por valor. |
| Frontend | `services/sqlDialect.ts`, `sqlLiterals.ts`, `services/ddl/` | Dialecto del editor, literales del grid, DDL por motor. |

Fases completadas: 0 (desacople), 1 (backend, conexión, navegación), 2 (editor,
grid, capacidades), 3 (DDL, 12 pasos con vista previa, renombrar tabla).

## Pendiente (Fase 4)

1. **EXPLAIN QUERY PLAN**: parser en `src/utils/explainTreeParser` (columnas
   `id`, `parent`, `detail`) reutilizando `ExplainPlanTree`; desde el editor,
   para SQLite ejecutar `EXPLAIN QUERY PLAN <sql>` en lugar de la ruta MySQL.
   Test Vitest del parser.
2. **Backup SQLite**: comando que ejecute `VACUUM INTO '<ruta>'` con ruta de
   `save_*_dialog` (exigir `file_grants::require`). Restore = copiar/abrir el
   archivo. `BackupRestoreModal` debe usar `supportsFeature("fileBackup")` vs
   `sqlDump`. Test Rust de `VACUUM INTO`.
3. **Excel import en SQLite**: `excel/importer.rs` aún usa `INSERT IGNORE`,
   `ON DUPLICATE KEY UPDATE`, backticks y `require_transactional_table`
   (ya abstraído). Usar `Dialect::insert_ignore`/`upsert_suffix`/`qualify_table`
   y el dialecto en `create_new_table` (tipos MySQL). La exportación ya funciona
   (`stream_rows`).
4. **IA** (`db/ai/context.rs`): indicar el motor al modelo y obtener el esquema
   vía introspector (hoy consulta `information_schema`).
5. **Safe mode**: verificar `safe_mode.rs`/`safe_mode_gate.rs` con sintaxis
   SQLite (`DELETE`/`UPDATE` sin `WHERE`, `DROP`); añadir tests.

## Pendiente (Fase 5)

- `README.md`: motores soportados y limitaciones de SQLite.
- Prueba manual con `npm run tauri:dev` y Chinook (abrir, navegar, editar,
  añadir/cambiar columna, exportar Excel, backup).
- Verificación final: `cargo test`, `cargo clippy -- -D warnings`, `npm test`,
  `npm run build` (este último aún no ejecutado en la rama).

## Limitaciones conocidas / notas

- Pool SQLite de 1 conexión: consultas largas bloquean las demás (ATTACH,
  tablas TEMP y PRAGMA quedan consistentes). WAL no se activa automáticamente.
- Túnel SQLite: cada petición abre una conexión nueva (ATTACH no persiste), sin
  cancelación; tipo de columna por mayoría (columnas mixtas llegan como TEXT).
- Tablas sin PK se editan por `rowid` (se muestra como primera columna).
- Bug previo no corregido: `CapabilityAvailability` en Rust no se serializa con
  `{status, detail}` como espera el frontend, por lo que `isSupported(...)`
  devuelve `false` (p. ej. carpeta de secuencias oculta en MySQL).
- Otra sesión de Claude trabajó en paralelo en esta rama (`sqlFormat.ts`,
  `AGENTS.md` sin confirmar): no incluir cambios ajenos en los commits.
