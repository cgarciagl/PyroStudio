# Roadmap de mejoras — PyroStudio

Plan por fases. Cada ítem indica **qué**, **cómo** (capas afectadas) y **criterio de aceptación**. Todo respeta `AGENTS.md`: comandos Tauri sin lógica → `service.rs` → módulos de dominio → `DatabaseBackend`; sin diálogos nativos; primitivas de `ui/styles.ts`; paridad Modo Tabla / Modo Consulta.

---

## Estado (actualizado 2026-10-30)

Leyenda: ✅ hecho · 🟡 parcial · ⬜ pendiente. Cada apartado lleva su marca en el título y,
cuando hace falta, una nota **Estado:** con lo implementado y lo que falta.

| Fase | Estado | Commit |
| ---- | ------ | ------ |
| 0 — Robustez del dump | 🟡 0.1 y 0.2 hechas; falta 0.3 | `b2d8a0e` |
| 1 — Primera experiencia | ⬜ | — |
| 2 — Continuidad | ✅ | `7c1e79c` |
| 3 — Seguridad operativa | ✅ | `b2d8a0e` |
| 4 — Backups grandes | ⬜ | — |
| 5 — Exportación masiva | 🟡 5.1 y 5.2 hechas; faltan 5.3–5.5 | `b2d8a0e` y siguiente |
| 6 — Productividad | ✅ | `b2d8a0e` |
| 7 — Workspace y equipo | ⬜ | — |
| 8 — Mantenimiento | ✅ | `d2fcafb` y siguiente |

Pendiente transversal: nada de lo hecho se ha probado contra un MariaDB/MySQL real; en
particular el checksum por bloques de la 6.3 y el dump por keyset de la 0.1.

---

## Diagnóstico previo (problemas detectados en el código actual)

| #   | Dónde                    | Problema                                            | Impacto                                                                                                                       |
| --- | ------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| D1  | `db/sql_dump.rs` (~L255) | Paginación `LIMIT 2000 OFFSET n` **sin `ORDER BY`** | Orden no determinista: filas duplicadas u omitidas; coste O(n²) — en tablas de decenas de millones el dump se vuelve inviable |
| D2  | `db/sql_dump.rs` (~L258) | Si falla un chunk se hace `eprintln!` + `break`     | **El backup termina "con éxito" pero incompleto, en silencio**                                                                |
| D3  | `db/sql_dump.rs`         | Sin snapshot consistente                            | Tablas volcadas en momentos distintos → backup incoherente entre tablas relacionadas                                          |
| D4  | `excel/exporter.rs`      | Límite duro 1.048.575 filas → error                 | No se puede exportar nada mayor que una hoja                                                                                  |
| D5  | `excel/exporter.rs`      | Formato con bordes en **cada celda**                | Archivo más pesado y escritura más lenta en exportaciones masivas                                                             |

D1–D3 son correcciones urgentes (Fase 0) antes de construir backups incrementales encima.

---

## Fase 0 — Correcciones de robustez (urgente) 🟡

### 0.1 Dump con paginación por clave (keyset) o streaming ✅

**Estado:** Lectura por bloques ordenados por PK (simple o compuesta); sin PK, por todas las columnas. Tests en `sql_dump.rs`.

- **Cómo:** sustituir `LIMIT/OFFSET` por:
  - Tabla con PK: `WHERE (pk1, pk2) > (?, ?) ORDER BY pk1, pk2 LIMIT n` (soporta PK compuesta).
  - Tabla sin PK: un único `stream_rows` (ya existe en el backend, se usa en Excel) sin paginar.
- **Aceptación:** test con tabla de 1M filas sin duplicados ni pérdidas; tiempo lineal.

### 0.2 Errores visibles ✅

**Estado:** Los errores de lectura abortan el backup; se escribe a `.partial` y se renombra al terminar.

- Un fallo de chunk aborta el dump con `PyroError` y borra/renombra el archivo parcial a `*.partial`. El resumen (`SqlDumpSummary`) incluye filas por tabla para verificar.

### 0.3 Snapshot consistente ⬜

**Estado:** Bloqueado por diseño: `DatabaseBackend` no permite reservar una conexión para todo el dump. Requisito previo de la Fase 4.

- Conexión dedicada (`acquire()`), `SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ; START TRANSACTION WITH CONSISTENT SNAPSHOT` para InnoDB. Registrar en la cabecera del dump la posición de binlog/GTID (`SHOW MASTER STATUS` / `@@gtid_binlog_pos`) — base necesaria para la Fase 4.
- Aviso en UI si hay tablas MyISAM/Aria (no transaccionales).

---

## Fase 1 — Primera experiencia ⬜

### 1.1 Asistente de primer arranque ⬜

- **Disparador:** no hay workspace activo **y** no existe `onboardingCompleted` en preferencias.
- **Pasos** (`OnboardingWizard.tsx` sobre `Modal`):
  1. **Workspace** — qué es (carpeta con conexiones, consultas guardadas, favoritos, snippets), para qué (versionarlo con git, compartirlo con el equipo, separar proyectos). Botones: «Elegir carpeta», «Crear nueva», «Más tarde».
  2. **Vault** — dónde se guardan las contraseñas; usa `get_vault_status` y explica el aviso si no hay llavero del SO.
  3. **Primera conexión** — abre `ConnectionModal` o la conexión demo (1.2).
- Se puede relanzar desde Preferencias → «Ver introducción».
- **Aceptación:** test Vitest del flujo; nunca bloquea el uso (siempre se puede omitir).

### 1.2 Conexión de demostración ⬜

- Base SQLite de ejemplo empaquetada como recurso Tauri (tienda: clientes, pedidos, productos con FKs, vista, trigger). Se copia al directorio de datos al elegirla (nunca se escribe sobre el recurso).

### 1.3 Tips contextuales de primera vez ⬜

- Hook `useFirstTimeHint(id)` con estado en preferencias; burbuja discreta (sin animaciones pulsantes) en grid, editor, Safe Mode y cambios pendientes.

---

## Fase 2 — Continuidad y no perder trabajo ✅

### 2.1 Restauración de sesión ✅

**Estado:** `services/sessionRestore.ts`. Se guarda en localStorage (no en `.pyro/session.json`): las pestañas son locales del equipo según `WORKSPACES.md`. Clave = motor + archivo/host + puerto + usuario. Solo restaura tras conectar el usuario. Falta: posición del cursor.

- Persistir (debounce 1 s) el estado serializable de `TabManager`: tipo de pestaña, conexión, base, tabla, SQL del editor, posición del cursor. Guardado en el workspace (`.pyro/session.json`) o en datos de la app si no hay workspace.
- Al iniciar: reabrir pestañas **sin conectar automáticamente** a conexiones marcadas PROD (se conecta al enfocar la pestaña).

### 2.2 Borradores autoguardados ✅

**Estado:** Cubierto por la sesión de 2.1 (el SQL de cada pestaña se guarda con debounce de 1 s) en lugar de `.pyro/drafts/`; aviso «Sesión restaurada… N consultas con cambios sin guardar».

- Cada pestaña de consulta tiene un `draftId`; el contenido se escribe en `.pyro/drafts/`. Recuperación tras crash con aviso «Se recuperaron N borradores».

### 2.3 Aviso de cambios pendientes al cerrar ✅

**Estado:** `stores/pendingChangesStore.ts` + `TabIdContext`. Opciones «Descartar y cerrar» / «Cancelar» (sin botón «Aplicar»). Cerrar varias pestañas a la vez («Cerrar otras», «a la derecha/izquierda») aún no pregunta.

- Al cerrar pestaña o ventana (`onCloseRequested` de Tauri) con cambios staged sin aplicar → `showConfirm` con «Aplicar», «Descartar», «Cancelar». Aplica igual en Modo Tabla y Modo Consulta (paridad).

---

## Fase 3 — Seguridad operativa ✅

### 3.1 Conexiones de solo lectura ✅

**Estado:** `db/read_only.rs`; `SET SESSION TRANSACTION READ ONLY` en MySQL y `PRAGMA query_only` en SQLite. En el túnel HTTP solo actúa el filtro de PyroStudio.

- Flag `readOnly` en `ConnectionConfig`. **Aplicación en backend** (no solo UI): `safe_mode_gate.rs` rechaza todo lo que no clasifique como lectura (`SELECT`, `SHOW`, `EXPLAIN`, `DESCRIBE`, `WITH … SELECT`) con `PyroError::ReadOnlyConnection`. Adicionalmente `SET SESSION TRANSACTION READ ONLY` en MariaDB/MySQL y `PRAGMA query_only=1` en SQLite como segunda barrera.
- UI: celdas en solo lectura, acciones de escritura ocultas, indicador en `StatusFooter`.

### 3.2 Confirmación reforzada en PROD ✅

- En conexiones de entorno PROD, las sentencias críticas de Safe Mode exigen escribir el nombre de la base en `SafeExecutionModal`.

### 3.3 Modo de transacción manual ✅

**Estado:** `db/manual_tx.rs`, `ManualTxBar.tsx`. Solo MySQL directo/SSH (no SQLite ni túnel HTTP). Falta: cancelación por timeout dentro de la transacción.

- Toggle «Auto-commit» por pestaña. Al desactivarlo, la pestaña reserva una conexión dedicada del pool (requisito de aislamiento de sesión), ejecuta `BEGIN` y muestra barra «Transacción abierta · N sentencias · Commit / Rollback». Al cerrar la pestaña con transacción abierta → confirmación.
- Timeout configurable que avisa si la transacción lleva mucho tiempo abierta (bloqueos).

### 3.4 Log de auditoría local ✅

**Estado:** `db/audit.rs`, `AuditLogModal.tsx`, retención 90 días. Falta: las escrituras de `begin_transaction` (p. ej. importación Excel) no se auditan.

- Rust registra (JSON Lines) cada sentencia de escritura ejecutada: fecha, conexión, base, SQL (truncado), filas afectadas, duración, resultado. En `.pyro/audit/` del workspace con rotación. Vista filtrable en un panel `RightDock`.
- Nunca incluir credenciales; los literales pueden enmascararse opcionalmente.

---

## Fase 4 — Backups para bases MariaDB muy grandes ⬜

### Enfoque

Un cliente remoto **no puede** usar `mariadb-backup` (copia física de ficheros, requiere acceso al disco del servidor). La estrategia viable desde PyroStudio es **backup lógico completo + incrementales basados en binlog**, con un modo diferencial por tabla como alternativa cuando no hay binlog.

### 4.1 Motor de backup completo de alto rendimiento (`db/backup/`) ⬜

- Basado en la Fase 0 (snapshot consistente + keyset).
- **Formato de backup en directorio** (no un único `.sql`):
  ```
  backup-2026-10-30T0200/
    manifest.json          # versión servidor, bases, tablas, filas, checksums, posición binlog/GTID, tipo (full|incr)
    schema/<tabla>.sql     # DDL, vistas, rutinas, triggers, eventos
    data/<tabla>.00001.sql.zst  # datos en chunks (p. ej. 256 MB) comprimidos con zstd
  ```
- **Paralelismo:** N tablas a la vez (configurable, por defecto 4), cada una con su conexión del snapshot. Para un snapshot coherente entre conexiones paralelas: `FLUSH TABLES WITH READ LOCK` breve → abrir N transacciones consistentes → `UNLOCK TABLES` (requiere privilegio `RELOAD`; si no lo hay, se degrada a una conexión y se avisa).
- Tablas enormes se dividen por rangos de PK y se vuelcan en paralelo.
- Compresión `zstd` en streaming (crate `zstd`, nivel 3).
- **Reanudable:** el manifest marca los chunks terminados; un backup interrumpido continúa donde quedó.
- **Verificación:** checksum SHA-256 por chunk y conteo de filas; opción «Verificar backup».

### 4.2 Backups incrementales por binlog (opción recomendada) ⬜

- **Requisitos del servidor:** `log_bin=ON`, `binlog_format=ROW` (o MIXED), privilegios `REPLICATION SLAVE` y `REPLICATION CLIENT`. El asistente comprueba los requisitos y explica qué falta.
- **Cómo:** PyroStudio actúa como réplica ligera: se conecta con el protocolo de replicación (`COM_BINLOG_DUMP` / `COM_BINLOG_DUMP_GTID`) desde la posición guardada en el último manifest y **descarga los eventos binlog en bruto** a `incr-<n>/binlog.<seq>.zst`. Opciones de implementación:
  - Crate Rust de protocolo de replicación (evaluar `mysql_async` binlog stream, que soporta MariaDB GTID), o
  - Invocar `mariadb-binlog --read-from-remote-server --raw` si está instalado (fallback).
- **Restauración:** full + aplicar incrementales en orden (`mariadb-binlog | mariadb` o reproducción propia de eventos ROW) con **point-in-time recovery**: restaurar hasta fecha/hora o GTID concreto.
- **Advertencia clave:** si el servidor purga binlogs (`binlog_expire_logs_seconds`) antes del siguiente incremental, la cadena se rompe → el planificador lo detecta (`SHOW BINARY LOGS`) y fuerza un full.

### 4.3 Backups diferenciales por tabla (cuando no hay binlog) ⬜

- Detectar tablas cambiadas desde el último backup con `CHECKSUM TABLE` (o `information_schema.TABLES.UPDATE_TIME`/`DATA_LENGTH` como heurística rápida) y volcar **solo esas tablas completas**. Útil cuando la base es grande pero pocas tablas cambian.
- Opcional, por tabla: incremental por columna de marca temporal (`updated_at > último_backup`), configurado por el usuario; se advierte que no captura borrados.

### 4.4 Programación y retención ⬜

- Planificador en Rust (tarea tokio mientras la app está abierta) + opción de ejecutar en segundo plano vía CLI (`pyro-studio --backup <perfil>`) para el Programador de tareas de Windows / cron / launchd.
- Política de retención: «N fulls», «incrementales hasta el siguiente full», «borrar con más de X días». Nunca borrar un full del que dependan incrementales vigentes.
- Notificación al terminar o fallar; historial de ejecuciones con duración y tamaño.

### 4.5 UI ⬜

- Reemplazar/extender `BackupRestoreModal` por una pestaña «Backups»: perfiles (conexión, bases, destino, tipo, programación, retención), historial, cadena full→incrementales en línea temporal, botones «Ejecutar ahora», «Verificar», «Restaurar…» (con selector de punto en el tiempo).
- Restauración con confirmación reforzada (3.2) y opción de restaurar en **otra base** (`<base>_restored`) para no pisar la original.

**Aceptación Fase 4:** backup full de una base de 50 GB / 200M filas reanudable tras cortar la red; incremental binlog + restore point-in-time verificado con tests de integración contra MariaDB en Docker (CI).

---

## Fase 5 — Exportación masiva a Excel (millones de filas) 🟡

### 5.1 División automática en varias hojas ✅

**Estado:** Continúa en «Datos 1», «Datos 2»… al pasar de 1.048.575 filas.

- Al llegar a 1.048.575 filas, crear `Hoja2`, `Hoja3`… (con cabecera y panel congelado) en lugar de fallar. `constant_memory` ya está activo, así que la memoria se mantiene plana.
- Límite práctico: Excel abre con dificultad archivos de >~5M filas. Opción «Dividir en varios archivos cada N filas» (`export_001.xlsx`, `export_002.xlsx`…) recomendada por encima de ese umbral.

### 5.2 Modo «exportación masiva» ligero ✅

**Estado:** sin umbral: siempre activo en la exportación por streaming. Anchos calculados con las primeras 1.000 filas de cada hoja, celdas vacías sin formato y fechas `YYYY-MM-DD[ HH:MM:SS]` escritas como fecha de Excel (las fechas cero quedan como texto). `export_dataset_to_excel` (exportación desde el grid) no cambió.

- Por encima de un umbral (p. ej. 200k filas) desactivar bordes por celda y cálculo de anchos fila a fila (calcular anchos con las primeras 1.000 filas). Reduce tamaño y tiempo de forma notable.
- Tipos nativos: números y fechas como tipos Excel (no texto) para que el archivo sea útil.

### 5.3 Formatos alternativos para volúmenes enormes ⬜

- Ofrecer en el mismo diálogo: **CSV** (opcionalmente `.csv.gz`), **CSV por partes**, y **Parquet** (crate `parquet`/`arrow`, columnar y comprimido, ideal para millones de filas y para Power BI / Python). La UI recomienda el formato según el número de filas estimado (`EXPLAIN` / `information_schema.TABLES.TABLE_ROWS`).

### 5.4 Estabilidad de la consulta de origen ⬜

- Streaming con conexión dedicada y `net_read_timeout`/`net_write_timeout` ampliados en la sesión para que el servidor no corte una exportación lenta.
- Para tablas (no consultas arbitrarias): paginación keyset por PK con reintento del chunk ante desconexión → exportación **reanudable**.
- Progreso con filas/s, ETA (con filas estimadas) y cancelación (ya existe `CANCEL_EXCEL_OPERATION`).

### 5.5 Paridad ⬜

- Disponible igual desde Modo Tabla y desde resultados de Modo Consulta (re-ejecuta la consulta en streaming sin el límite interactivo de 5.000 filas).

**Aceptación Fase 5:** exportar 10M filas en memoria constante (<300 MB RSS), resultado en varias hojas/archivos abribles, test de división en el límite exacto de filas.

---

## Fase 6 — Productividad ✅

### 6.1 Diagrama ER ✅

**Estado:** `db/er.rs`, `ErDiagramTab.tsx`, `utils/erLayout.ts` (layout por capas propio, sin dagre/elk).

- Nueva pestaña con el grafo de tablas y FKs (`introspect.rs` ya expone FKs). Layout automático (dagre/elk), zoom, filtro por tablas, resaltar vecinos. Exportar PNG/SVG. Colores de nodo vía `ObjectIcon`.

### 6.2 Navegación por FK en el grid ✅

**Estado:** Menú contextual del grid: «Ir a fila referenciada» (abre la tabla filtrada, admite FK compuestas) y «Filas de X que la referencian».

- En `DataGridCanvas`: celdas FK con acción «Ir a fila referenciada» (abre la tabla destino filtrada) y en el menú contextual «Filas que referencian a esta». Funciona en Modo Consulta cuando la columna es trazable a una tabla.

### 6.3 Comparación de datos ✅

**Estado:** `db/data_compare.rs`, `DataCompareTab.tsx`. Checksum `MD5`+`BIT_XOR` por bloques de 1.000 claves en MySQL; SQLite compara todo. Sin probar aún contra un servidor real.

- Complemento de `SchemaDiffTab`: comparar dos tablas (misma o distinta conexión) por PK, con hashing por bloques de PK (`MD5(CONCAT_WS(...))` agregados) para no transferir tablas completas; mostrar insertadas/borradas/modificadas y generar script de sincronización.

### 6.4 Importación CSV/JSON con mapeo ✅

**Estado:** `excel/source.rs` convierte CSV/TSV/JSON/JSON Lines al pipeline del importador Excel; detecta separador y codificación (UTF-8 / Windows-1252).

- Reutilizar el pipeline del importador Excel: vista previa, detección de separador/encoding, mapeo de columnas, tipos, modo insert/upsert, lotes en transacción.

### 6.5 Snippets/plantillas SQL ✅

**Estado:** `workspace/snippets.rs` → `snippets/snippets.json` (no `.pyro/snippets/`); `SnippetsModal.tsx`, autocompletado por prefijo y «Insertar snippet» en la paleta.

- Guardados en `.pyro/snippets/` del workspace, con variables (`SqlVariablesModal` ya existe), insertables desde autocompletado y paleta de comandos.

### 6.6 Generador de datos de prueba ✅

**Estado:** `db/test_data.rs`, `TestDataModal.tsx` (menú «Importar / Exportar» de la tabla). Bloqueo en PROD y solo lectura aplicado en el backend.

- Por columna según tipo/nombre (email, nombre, fecha, FK válida tomando valores existentes). Bloqueado en conexiones PROD y de solo lectura.

---

## Fase 7 — Workspace y equipo ⬜

### 7.1 Exportar/importar workspace sin secretos ⬜

- Paquete `.pyrows` (zip) con conexiones (sin `credentialId` ni secretos), consultas, snippets, favoritos. Al importar, las conexiones aparecen como «credencial pendiente» (`missingCredential.tsx` ya existe).

### 7.2 Variables de entorno por workspace ⬜

- Conjuntos `dev/staging/prod` de variables (`${schema}`, `${tenant}`…) aplicados a consultas guardadas y snippets; selector de entorno activo en la cabecera.

---

## Fase 8 — Mantenimiento y soporte ✅

### 8.1 Panel de diagnóstico ✅

**Estado:** `DiagnosticsModal.tsx` («Diagnóstico» en la paleta) + `src-tauri/src/diagnostics.rs`. «Copiar informe» oculta hosts y rutas por defecto. Los últimos errores y avisos salen del log de la 8.2.

- Versión, SO, ruta de datos, estado del vault/llavero, workspace activo, últimos errores. Botón «Copiar informe» (sin secretos ni hosts si el usuario lo elige).

### 8.2 Logs rotativos ✅

**Estado:** `src-tauri/src/logging.rs`: un archivo diario `pyrostudio.*.log` en `<datos locales>/PyroStudio/logs/`, 14 días; también registra los panics. Nivel en Preferencias → Acerca de (`logLevel`, por defecto «info»). El panel de diagnóstico muestra la carpeta y los últimos errores/avisos. Falta: instrumentar más puntos del backend con `tracing` (hoy: arranque, panics, auditoría y cambios de nivel).

- `tracing` + `tracing-appender` en Rust con rotación diaria; nivel configurable desde Preferencias.

---

## Orden recomendado y estimación orientativa

| Orden | Fase                  | Esfuerzo | Motivo                                                |
| ----: | --------------------- | -------- | ----------------------------------------------------- |
|     1 | 0 — Robustez del dump | S        | Hay riesgo real de backups corruptos/incompletos hoy  |
|     2 | 1.1 + 2.1–2.3         | M        | Mayor impacto en experiencia diaria                   |
|     3 | 3.1–3.2               | S–M      | Seguridad en producción                               |
|     4 | 5.1–5.3               | M        | Desbloquea exportaciones grandes con cambios acotados |
|     5 | 4.1 → 4.4 → 4.2       | L–XL     | Base sólida primero; binlog es lo más complejo        |
|     6 | 3.3–3.4, 6.x          | M c/u    | Productividad                                         |
|     7 | 7.x, 8.x, 1.2–1.3     | S–M      | Pulido                                                |

S ≈ días, M ≈ 1–2 semanas, L/XL ≈ varias semanas.

## Pruebas transversales

- Tests de integración contra MariaDB y MySQL en Docker en CI para dump, keyset, binlog y exportación masiva (fixtures generados, no versionados).
- Tests de Vitest para onboarding, restauración de sesión, solo lectura (UI) y paridad Tabla/Consulta.
- `StyleGuide.test.ts` debe seguir pasando en todos los componentes nuevos.
