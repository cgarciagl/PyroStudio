# Soporte SQLite: estado y arquitectura

Rama: `main`. Este documento resume la arquitectura, capacidades implementadas y notas de diseño del soporte completo de SQLite en PyroStudio.

## Arquitectura

| Pieza                | Ubicación                                                               | Notas                                                                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Motor de la conexión | `db/engine.rs` (`DbEngine`), `ConnectionConfig.engine` / `file_path`    | Perfiles sin `engine` = MySQL (`#[serde(default)]`).                                                                                                                     |
| Contrato de backend  | `db/backend.rs`                                                         | `engine()`, `stream_rows`, `begin_transaction`, `execute_params`, `table_transactionality`.                                                                              |
| MySQL                | `db/mysql/`                                                             | Único lugar con tipos `MySql*`. Introspección desacoplada.                                                                                                                |
| SQLite               | `db/sqlite/`                                                            | `backend` (1 conexión, cancelación por progress handler), `row` (por clase de almacenamiento), `introspector` (`sqlite_master`/`pragma_*`), `alter` (12 pasos), `tests`. |
| Dialecto SQL         | `db/dialect.rs`                                                         | Comillas, literales, BEGIN, LIMIT de fila, TRUNCATE, upsert, índices, rename.                                                                                            |
| Introspección        | `db/introspect.rs`                                                      | `SchemaIntrospector`; los módulos `table/index/trigger/database/inspector` delegan.                                                                                      |
| Capacidades          | `db/features.rs`, `capabilities.rs`                                     | `EngineFeature`; la UI usa `supportsFeature` / `useFeatureGate`. Serialización `{status, detail}` verificada.                                                             |
| Túnel PHP SQLite     | `tunnel/pyro_tunnel_sqlite.php` + `tunnel/tests/tunnel_sqlite_test.php` | Cliente envía `dbfile`; celdas decodificadas por valor.                                                                                                                  |
| Frontend             | `services/sqlDialect.ts`, `sqlLiterals.ts`, `services/ddl/`             | Dialecto del editor, literales del grid, DDL por motor, visualizador EXPLAIN adaptado.                                                                                   |

---

## Fases del Proyecto

- **Fase 0 (Desacople):** Abstracción de tipos MySQL y desacople de backend.
- **Fase 1 (Backend & Conexión):** Conexión directa SQLite, túnel PHP, explorador de base de datos.
- **Fase 2 (Editor & Cuadrícula):** Soporte en editor SQL, Grid Canvas (edición in-place, gestión por `rowid` en tablas sin PK).
- **Fase 3 (DDL & Reconstrucción de Esquemas):** Reconstrucción oficial de 12 pasos con previsualización para cambios de columna incompatibles.
- **Fase 4 (Características Avanzadas & Herramientas):**
  1. **EXPLAIN QUERY PLAN:** Parser jerárquico (`id`, `parent`, `detail`) en `src/utils/explainTreeParser.ts` integrado en `QueryEditorTab` y `QueryPlanViewer.tsx` con tests en Vitest.
  2. **Backup SQLite:** Comando nativo `VACUUM INTO '<ruta>'` con validación de seguridad de permisos (`file_grants`), manejo de sobrescritura segura y modal `BackupRestoreModal.tsx` adaptado para respaldos SQLite sin bloqueo de lecturas.
  3. **Importación Excel (.xlsx):** `src-tauri/src/excel/importer.rs` adaptado con dialecto SQLite (`INSERT OR IGNORE`, `ON CONFLICT DO UPDATE`, tipos nativos SQLite, cualificación de identificadores y tests en Rust).
  4. **Contexto de IA:** `src-tauri/src/db/ai/context.rs` refactorizado para usar introspección agnóstica sin consultar `information_schema` y señalando el motor SQLite en el prompt.
  5. **Safe Mode para PRAGMA:** Clasificación inteligente de comandos `PRAGMA` en `src-tauri/src/db/safe_mode.rs` (permite consultas de lectura como `table_info` sin confirmación y clasifica escrituras).
- **Fase 5 (Verificación & Documentación):**
  - Documentación de características y limitaciones en `README.md`.
  - Verificación completa de suite de pruebas: `cargo test` (223 pruebas exitosas), `cargo clippy -- -D warnings` (0 advertencias), `cargo fmt --check`, `npm test` (31 archivos, 207 pruebas exitosas) y `npm run build` (compilación TypeScript y Vite exitosa).

---

## Limitaciones conocidas / notas de diseño

- **Pool SQLite de 1 conexión:** Consultas de muy larga duración ocupan la conexión hasta terminar o cancelarse. Esto garantiza que comandos `ATTACH`, tablas `TEMP` y estados `PRAGMA` permanezcan completamente consistentes.
- **Túnel SQLite:** Cada petición HTTP abre una conexión de ciclo de vida corto (sentencias `ATTACH` no persisten entre peticiones HTTP distintas) y sin soporte de cancelación fuera de banda; decodificación de celdas por tipo dinámico de valor.
- **Tablas sin Clave Primaria:** Se editan de forma unificada mediante la columna física oculta `rowid`.
- **Serialización de Capacidades:** Corregido bug previo; `CapabilityAvailability` serializa como `{ status, detail }` concordando con el tipo TypeScript frontend.
