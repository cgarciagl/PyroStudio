# 🚀 Roadmap de Optimizaciones y Rendimiento (PyroStudio)

Este documento registra las iniciativas de optimización de rendimiento, reducción de consumo de recursos y aceleración de la experiencia de usuario en PyroStudio.

---

## 📊 Resumen de Fases

| Fase | Título | Estado | Impacto Principal |
| :---: | :--- | :---: | :--- |
| **1** | **Code-Splitting y Lazy Loading del Frontend** | ✅ | Reduce bundle inicial de 2.37 MB a 748 kB (-68.4%), arranque instantáneo |
| **2** | **División Estratégica de Chunks en Vite (`manualChunks`)** | ✅ | Desacopla vendors pesados (`vendor-grid`, `vendor-editor`, `vendor-icons`) |
| **3** | **Caché Inteligente de Introspección de Esquema** | ⬜ | Evita ráfagas a `information_schema` en bases de datos con cientos de tablas |
| **4** | **Autocompletado SQL Indexado por Prefijo** | ⬜ | Cero micro-stutters al escribir consultas en esquemas masivos |
| **5** | **Aislamiento Concurrente de Conexiones para Background Tasks** | ⬜ | Exportaciones masivas y backups no saturan el pool interactivo |

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

### Fase 3 — Caché Inteligente de Introspección de Esquema ⬜
**Objetivo:** Navegación instantánea en el árbol lateral y reducción de consultas repetitivas a `information_schema` en esquemas grandes.
- [ ] Almacenar en `schemaStore` el árbol de tablas, vistas y rutinas con política de invalidación por evento.
- [ ] Invalidar selectivamente cuando se ejecuten sentencias DDL detectadas (`CREATE`, `ALTER`, `DROP`) o al pulsar «Refrescar».

### Fase 4 — Autocompletado SQL Indexado por Prefijo ⬜
**Objetivo:** Autocompletado instantáneo a 60 FPS en el editor SQL para bases de datos con miles de columnas.
- [ ] Indexar nombres de tablas y columnas en un mapa hash/trie en memoria por esquema activo.
- [ ] Filtrar candidatos de autocompletado por prefijo sin recorrer arreglos no indexados en cada pulsación.

### Fase 5 — Aislamiento Concurrente de Conexiones para Background Tasks ⬜
**Objetivo:** Prevenir contención en el pool de conexiones de Rust.
- [ ] Gestionar límites dinámicos en el pool de conexiones de `sqlx` dedicados a exportaciones masivas y backups para no agotar las conexiones interactivas del usuario.
