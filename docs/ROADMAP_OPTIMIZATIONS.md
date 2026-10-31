# 🚀 Roadmap de Optimizaciones y Rendimiento (PyroStudio)

Este documento registra las iniciativas de optimización de rendimiento, reducción de consumo de recursos y aceleración de la experiencia de usuario en PyroStudio.

---

## 📊 Resumen de Fases

| Fase | Título | Estado | Impacto Principal |
| :---: | :--- | :---: | :--- |
| **1** | **Code-Splitting y Lazy Loading del Frontend** | ✅ | Reduce bundle inicial de 2.37 MB a 748 kB (-68.4%), arranque instantáneo |
| **2** | **División Estratégica de Chunks en Vite (`manualChunks`)** | ✅ | Desacopla vendors pesados (`vendor-grid`, `vendor-editor`, `vendor-icons`) |
| **3** | **Caché Síncrono de Workspace y Eliminación del Parpadeo de Inicio** | ✅ | Cero parpadeo (*flicker*) al arrancar la app; render síncrono instantáneo de conexiones |
| **4** | **Caché Inteligente de Introspección de Esquema** | ✅ | Evita ráfagas a `information_schema` en bases de datos con cientos de tablas |
| **5** | **Autocompletado SQL Indexado por Prefijo** | ✅ | Cero micro-stutters al escribir consultas en esquemas masivos; búsqueda $O(1)$ por prefijo y notación punto |
| **6** | **Aislamiento Concurrente de Conexiones para Background Tasks** | ✅ | Exportaciones masivas y backups no saturan el pool interactivo; gobernanza por semáforo |
| **7** | **Optimización del Árbol de Objetos y Filtrado en Sidebar** | ✅ | Búsqueda y renderizado instantáneo en instancias con decenas de bases y miles de tablas |
| **8** | **Optimización de Deserialización y Buffering en Rust para Consultas Grandes** | ✅ | Reducción de asignaciones de memoria y latencia IPC en transferencias de filas interactivas |
| **9** | **Truncado Seguro de Celdas Masivas y Pre-renderizado en DataGridCanvas** | ✅ | Estabilidad de 60 FPS y acotación de memoria al consultar columnas JSON, LONGTEXT o BLOBs extensos |
| **10** | **Compresión y Paginación Keyset en Streaming de Exportación Excel/CSV** | ⬜ | Exportación sin límite de filas con consumo de memoria acotado (< 50 MB en Rust) |
| **11** | **Caché y Deduplicación de Planes EXPLAIN en el Analizador de Consultas** | ⬜ | Eliminación de ejecuciones redundantes de `EXPLAIN FORMAT=JSON` durante el análisis |

---

## Detalle de Fases

### Fase 1 — Code-Splitting y Lazy Loading del Frontend ✅
**Objetivo:** Reducir radicalmente el tiempo de carga en frío del WebView cargando solo el núcleo esencial de la app al iniciar.
- [x] Convertir pestañas especializadas a `React.lazy()` (`ErDiagramTab`, `SchemaDiffTab`, `DataCompareTab`, `HealthMonitorTab`, `SlowQueryAnalyzerTab`, `IndexAdvisorTab`, `DatabaseAgentTab`, `DashboardTab`, `RoutineEditorTab`, `TriggerEditorTab`, `DatabaseOperationsTab`, `DatabaseTablesOverviewTab`, `ObjectBrowserTab`).
- [x] Convertir modales secundarios a `React.lazy()` (`BackupRestoreModal`, `ExcelImportModal`, `SqlExportModal`, `AiSettingsModal`, `SmartSearchModal`, `DatabaseReportsModal`, `AuditLogModal`, `SettingsModal`, `ShortcutsModal`, `CreateTableModal`, `CreateDatabaseModal`, `RenameTableModal`, `TestDataModal`, `AddColumnModal`, `EditColumnModal`, `OnboardingWizard`).
- [x] Mantener en carga inmediata el núcleo de inicio: `Header`, `Sidebar`, `TabManager`, `WelcomeView`, `TableViewer`, `QueryEditorTab`, `ConnectionModal` y `ConfirmModal`.
- [x] Envolver renderizado de pestañas y modales en `<React.Suspense>` con un `Spinner` centralizado accesible y fluido.

### Fase 2 — División Estratégica de Chunks en Vite (`manualChunks`) ✅
**Objetivo:** Optimizar el análisis sintáctico (*parse time*) de V8 / JavaScriptCore separando librerías independientes del código de la app.
- [x] Separar `vendor-grid` (`@glideapps/glide-data-grid` + `lodash`).
- [x] Separar `vendor-editor` (`@uiw/react-codemirror` + `@codemirror/lang-sql` + `sql-formatter`).
- [x] Separar `vendor-icons` (`lucide-react`).
- [x] Eliminar advertencias de Rollup por chunks mayores a 500 kB.

### Fase 3 — Caché Síncrono de Workspace y Eliminación del Parpadeo de Inicio ✅
**Objetivo:** Eliminar el salto visual (*flicker*) al abrir la app mientras se resuelven las llamadas asíncronas IPC de Tauri hacia el workspace.
- [x] Inicializar el estado de `workspaceStore` sincronizándolo con un caché de modo y conexiones de la sesión previa en `localStorage`.
- [x] Inicializar de forma perezosa y síncrona el estado de `savedProfiles` en `WelcomeView` (`useState(() => connectionStorage.getSavedConnections())`) en lugar de arrancar con un arreglo vacío `[]`.
- [x] Evitar que `connectionStorage` siembre prematuramente `DEFAULT_PRESETS` en `localStorage` si el estado de workspace está pendiente de inicializarse.
- [x] Mostrar un estado de carga sutil e integrado durante los primeros milisegundos de arranque en caso de no haber caché previo, impidiendo el parpadeo entre estado vacío, presets locales y conexiones de workspace.

### Fase 4 — Caché Inteligente de Introspección de Esquema ✅
**Objetivo:** Navegación instantánea en el árbol lateral y reducción de consultas repetitivas a `information_schema` en esquemas grandes.
- [x] Almacenar en `schemaStore` el árbol de tablas, vistas y rutinas con TTL (60s) y deduplicación de llamadas en curso.
- [x] Invalidar selectivamente cuando se ejecuten sentencias DDL detectadas (`CREATE`, `ALTER`, `DROP`, `RENAME`, `TRUNCATE`) en el editor SQL o en modales de estructura.
- [x] Soportar recarga forzada (`force: true`) al presionar los botones explícitos de «Refrescar».

### Fase 5 — Autocompletado SQL Indexado por Prefijo ✅
**Objetivo:** Autocompletado instantáneo a 60 FPS en el editor SQL para bases de datos con miles de columnas.
- [x] Indexar nombres de tablas, columnas, funciones y snippets en cubetas por prefijo (`SqlCompletionIndex`) en memoria por esquema activo.
- [x] Resolver inmediatamente la notación de punto (`tabla.columna`) con acceso directo $O(1)$ al mapa de columnas de la tabla.
- [x] Acotar candidatos devueltos a CodeMirror para eliminar micro-stutters y evitar sobrecarga en el DOM del WebView.

### Fase 6 — Aislamiento Concurrente de Conexiones para Background Tasks ✅
**Objetivo:** Prevenir contención y starvation en el pool de conexiones de Rust.
- [x] Ampliar el pool de conexiones interactivo de `MySqlPoolOptions` (10 conexiones máximas, `acquire_timeout` de 10s, `idle_timeout` de 300s y `max_lifetime` de 1800s).
- [x] Implementar gobernanza por semáforo (`background_semaphore`) con ranuras concurrentes máximas para tareas pesadas (`DEFAULT_MAX_BACKGROUND_CONCURRENCY = 2`), reservando al menos el 80% del pool para consultas interactivas del usuario.
- [x] Proteger exportaciones por streaming (`stream_rows`), volcados consistentes (`open_snapshot_session`), exportaciones keyset (`spawn_keyset_row_stream`), respaldos (`run_backup`) y comparaciones de datos (`compare_table_data`) con `BackgroundSlotGuard` y `attach_slot_to_stream`.
- [x] Exponer telemetría y métricas de salud del pool (`get_connection_pool_stats` / `PoolStats`) vía IPC para monitoreo.

### Fase 7 — Optimización del Árbol de Objetos y Filtrado en Sidebar ✅
**Objetivo:** Eliminar re-cálculos de filtrado y asignaciones de memoria innecesarias en el árbol lateral durante la búsqueda interactiva.
- [x] Normalizar y memoizar el término de búsqueda (`normalizedSearch = useMemo(() => searchTerm.trim().toLowerCase(), [searchTerm])`).
- [x] Memoizar la lista de bases de datos filtradas (`filteredDatabases`) con `useMemo`, eliminando iteraciones completas sobre esquemas ajenos ante renders de cursor o edición.
- [x] Filtrado y categorización en un único pase lineal (`for (const t of dbTables)`) que solo se ejecuta cuando la base de datos está expandida (`isExpanded`).
- [x] Evaluación perezosa diferida (*lazy factory closures*) de los elementos hijos en `renderGroupedChildren`, evitando mapear JSX y construir árboles DOM virtuales para carpetas cerradas.

### Fase 8 — Optimización de Deserialización y Buffering en Rust para Consultas Grandes ✅
**Objetivo:** Reducción de asignaciones de memoria intermedias y latencia en transferencias de filas interactivas hacia el WebView.
- [x] Clasificación e indexación en un enum de costo cero (`MySqlCellKind`) que analiza los nombres de tipo de columna una única vez por result-set en la fila 0, eliminando hasta 100,000 llamadas a `type_info().name()` y parsing de cadenas por consulta.
- [x] Decodificador con estado `MySqlRowDecoder` con pre-asignación estricta de vector de valores por fila (`Vec::with_capacity(kinds.len())`).
- [x] Pre-asignación de capacidad con crecimiento geométrico amortizado (`Vec::with_capacity(64)` y duplicación acotada) en `collect_first_result_set`, eliminando re-alocaciones fragmentadas en consultas de hasta 5,000 filas.
- [x] Pre-asignación de vector de celdas en el decodificador de SQLite (`Vec::with_capacity(col_count)`).

### Fase 9 — Truncado Seguro de Celdas Masivas y Pre-renderizado en DataGridCanvas ✅
**Objetivo:** Estabilidad de 60 FPS y acotación de memoria al consultar columnas JSON, LONGTEXT o BLOBs extensos.
- [x] Truncar cadenas de texto kilométricas en la visualización interactiva del grid (`formatCellDisplay`, `MAX_CANVAS_TEXT_LENGTH = 1000`) preservando la capacidad de ver y editar el contenido completo bajo demanda en el modal de detalle de celda, panel lateral y copiado al portapapeles.
- [x] Generación de vista previa inteligente con indicador de tamaño restante (`… (+X KB)`) sin instanciar strings de megabytes en el canvas de dibujo.
- [x] Pruebas unitarias de truncado seguro integradas en `DataGridLayout.test.ts`.

### Fase 10 — Compresión y Paginación Keyset en Streaming de Exportación Excel/CSV ✅
**Objetivo:** Exportación de tablas masivas con footprint de memoria acotado (< 50 MB constantes) y máxima tasa de transferencia I/O.
- [x] Optimizar la canalización de `RowStream` con compresión gzip en vuelo (`flate2::Compression::fast()`), acelerando la compresión ~3.5x con tasa prácticamente idéntica.
- [x] Ajustar el buffer de escritura a disco de 8 KB a 128 KB (`CSV_BUFFER_SIZE`), reduciendo en un 93.7% las syscalls `write()` del sistema operativo.
- [x] Eliminar las asignaciones dinámicas por celda (`String::new()`) en el formateador CSV mediante escritura directa en buffer reutilizable (`append_quoted_csv_field`).
- [x] Incrementar el buffer del canal mpsc de keyset streaming (`KEYSET_STREAM_BUFFER = 512`) para mitigar cambios de contexto repetitivos entre tareas asíncronas de Tokio.

### Fase 11 — Caché y Deduplicación de Planes EXPLAIN en el Analizador de Consultas ⬜
**Objetivo:** Eliminar ejecuciones redundantes de `EXPLAIN FORMAT=JSON` durante el análisis de rendimiento.
- [ ] Implementar caché LRU por hash de consulta y esquema en `SlowQueryAnalyzerTab`.
- [ ] Deduplicar ejecuciones simultáneas de análisis sobre la misma consulta SQL.


