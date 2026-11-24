# Roadmap de Internacionalización (i18n) — PyroStudio

Este documento lleva el seguimiento completo de la migración multiidioma (**Español `es`** / **Inglés `en`** / **Sistema `system`**) en PyroStudio.

> **Convenciones:**
> - Los archivos de traducción viven en `src/i18n/locales/{es,en}/<namespace>.json`.
> - El idioma activo se persiste en `usePreferenceStore` (`language: "es" | "en" | "system"`), sincroniza `document.documentElement.lang` y `data-lang`, y se inicializa en `src/main.tsx`.
> - Todo nuevo namespace debe agregarse a `src/i18n/index.ts` para quedar cubierto automáticamente por el test de paridad de claves (`src/i18n/__tests__/i18n.test.ts`).
> - Para textos fuera de componentes React (stores, services, utils) usar `i18n.t(...)` importado desde `src/i18n`.

---

## Fase 1 — Infraestructura Base y Selector de Idioma ✅

- [x] Instalar `i18next` y `react-i18next` en `package.json`.
- [x] Crear `src/i18n/index.ts` con `detectSystemLanguage`, `resolveLanguage`, `applyLanguageToDom` y configuración de `i18next`.
- [x] Crear `src/i18n/i18next.d.ts` con tipado estricto de namespaces y claves.
- [x] Crear namespaces iniciales `common.json` y `settings.json` para `es` y `en`.
- [x] Agregar `language` y `setLanguage` + `initPreferencesLanguage` en `src/stores/preferenceStore.ts`.
- [x] Inicializar `initPreferencesLanguage()` en `src/main.tsx` y `src/i18n` en `src/test/setup.ts`.
- [x] Agregar selector de idioma (`Español`, `English`, `Sistema`) en `src/components/SettingsModal.tsx` (pestaña Apariencia) y traducir cabecera, navegación y pestaña Apariencia.
- [x] Agregar pruebas unitarias en `src/stores/__tests__/preferenceStore.test.ts` y test de paridad de claves en `src/i18n/__tests__/i18n.test.ts`.

---

## Fase 2 — Shell Principal, Configuración y Modales Base

**Namespaces sugeridos:** `shell.json`, `settings.json` (completar), `modals.json`

### Shell y Navegación Principal
- [x] `src/App.tsx`
- [x] `src/main.tsx` (`ErrorBoundary fallbackTitle`)
- [x] `src/components/ErrorBoundary.tsx`
- [x] `src/components/Header.tsx`
- [x] `src/components/Sidebar.tsx`
- [x] `src/components/TabManager.tsx`
- [x] `src/components/StatusFooter.tsx`
- [x] `src/components/WelcomeView.tsx`
- [x] `src/components/CommandPalette.tsx`
- [x] `src/components/SavedQueriesFolder.tsx`

### Configuración, Onboarding y Acerca de
- [x] `src/components/SettingsModal.tsx` (pestañas restantes: `database`, `workspace`, `editor`, `ai`, `shortcuts`, `about`)
- [x] `src/components/WorkspaceSettings.tsx`
- [x] `src/components/AiSettingsModal.tsx`
- [x] `src/components/ShortcutsModal.tsx`
- [x] `src/components/AboutModal.tsx`
- [x] `src/components/OnboardingWizard.tsx` (incluir selector de idioma opcional en el primer arranque)
- [x] `src/components/UpdateModal.tsx`

### Modales Base y UI Compartida
- [x] `src/components/ConfirmModal.tsx`
- [x] `src/components/SafeExecutionModal.tsx`
- [x] `src/components/ui/Modal.tsx`
- [x] `src/components/ui/FirstTimeHint.tsx`
- [x] `src/components/ui/DatabaseScopeBar.tsx`
- [x] `src/components/ui/RightDock.tsx`

---

## Fase 3 — Conexiones, Favoritos y Variables de Entorno

**Namespaces sugeridos:** `connection.json`, `favorites.json`

### Modal y Secciones de Conexión
- [x] `src/components/ConnectionModal.tsx`
- [x] `src/components/connection/ProfileList.tsx`
- [x] `src/components/connection/GeneralSection.tsx`
- [x] `src/components/connection/EngineSection.tsx`
- [x] `src/components/connection/ServerSection.tsx`
- [x] `src/components/connection/SqliteFileSection.tsx`
- [x] `src/components/connection/TransportSection.tsx`
- [x] `src/components/connection/TlsSection.tsx`
- [x] `src/components/connectionTransport.tsx`
- [x] `src/components/missingCredential.tsx`

### Favoritos y Variables
- [x] `src/components/FavoritesModal.tsx`
- [x] `src/components/favorites/FavoritesList.tsx`
- [x] `src/components/favorites/FavoriteDetail.tsx`
- [x] `src/components/favorites/FavoriteForm.tsx`
- [x] `src/components/EnvVariablesEditor.tsx`
- [x] `src/components/SqlVariablesModal.tsx`

---

## Fase 4 — Editor SQL, Grid de Datos y Visor de Tablas (Flujo Core)

**Namespaces sugeridos:** `queryEditor.json`, `dataGrid.json`, `tableViewer.json`

### Editor SQL
- [x] `src/components/QueryEditorTab.tsx`
- [x] `src/components/queryEditor/RunButton.tsx`
- [x] `src/components/queryEditor/ExecutionStatus.tsx`
- [x] `src/components/queryEditor/EditTargetBar.tsx`
- [x] `src/components/queryEditor/EmptyResults.tsx`
- [x] `src/components/queryEditor/ScriptMessagesPanel.tsx`
- [x] `src/components/queryEditor/SqlErrorPanel.tsx`
- [x] `src/components/ManualTxBar.tsx`
- [x] `src/components/SqlFormatButton.tsx`
- [x] `src/components/QueryHistoryModal.tsx`
- [x] `src/components/SnippetsModal.tsx`
- [x] `src/components/SmartSearchModal.tsx`

### Grid de Datos Compartido (`DataGridCanvas`)
- [x] `src/components/DataGridCanvas.tsx`
- [x] `src/components/dataGrid/GridToolbarActions.tsx`
- [x] `src/components/dataGrid/GridPagination.tsx`
- [x] `src/components/dataGrid/GridViewport.tsx`
- [x] `src/components/dataGrid/GridCellContextMenu.tsx`
- [x] `src/components/dataGrid/GridHeaderMenu.tsx`
- [x] `src/components/dataGrid/GridModals.tsx`
- [x] `src/components/dataGrid/GridOverlays.tsx`
- [x] `src/components/dataGrid/EmptyResultOverlay.tsx`
- [x] `src/components/dataGrid/ExactCountControl.tsx`
- [x] `src/components/dataGrid/NoPrimaryKeyNotice.tsx`
- [x] `src/components/dataGrid/SaveStatusBadge.tsx`
- [x] `src/components/dataGrid/SmartCopyMenu.tsx`
- [x] `src/components/StagedChangesActionBar.tsx`
- [x] `src/components/PreviewStagedSqlModal.tsx`
- [x] `src/components/PastePreviewModal.tsx`
- [x] `src/components/FillSelectionModal.tsx`
- [x] `src/components/EditRecordModal.tsx`
- [x] `src/components/RecordDetailPanel.tsx`
- [x] `src/components/CellInspectorDrawer.tsx`

### Filtros Visuales
- [x] `src/components/VisualFilterBuilder.tsx`
- [x] `src/components/filter/FilterRuleRow.tsx`
- [x] `src/components/filter/PickerMenu.tsx`
- [x] `src/components/filter/PortalMenu.tsx`

### Visor de Tablas e Inspector
- [x] `src/components/TableViewer.tsx`
- [x] `src/components/TableContextMenu.tsx`
- [x] `src/components/tableViewer/StructurePanel.tsx`
- [x] `src/components/tableViewer/StatisticsPanel.tsx`
- [x] `src/components/tableViewer/DdlPanel.tsx`
- [x] `src/components/tableViewer/ForeignKeysPanel.tsx`
- [x] `src/components/tableViewer/TriggersPanel.tsx`
- [x] `src/components/tableViewer/AdvisorPanel.tsx`
- [x] `src/components/tableViewer/InspectorLoading.tsx`
- [x] `src/components/charts/ResultChart.tsx`
- [x] `src/components/charts/StorageCharts.tsx`

---

## Fase 5 — Diseño de Esquema, Objetos DDL y Operaciones de Base de Datos

**Namespaces sugeridos:** `schema.json`, `objects.json`

### Diseño y Edición de Tablas / Columnas
- [x] `src/components/CreateDatabaseModal.tsx`
- [x] `src/components/CreateTableModal.tsx`
- [x] `src/components/RenameTableModal.tsx`
- [x] `src/components/DuplicateTableModal.tsx`
- [x] `src/components/AddColumnModal.tsx`
- [x] `src/components/EditColumnModal.tsx`
- [x] `src/components/DesignDropColumn.tsx`
- [x] `src/components/PrimaryKeyEditor.tsx`
- [x] `src/components/ForeignKeyEditor.tsx`
- [x] `src/components/SchemaDesignerTab.tsx`
- [x] `src/components/ErDiagramTab.tsx`
- [x] `src/components/IndexManagerTab.tsx`
- [x] `src/components/RoutineEditorTab.tsx`
- [x] `src/components/TriggerEditorTab.tsx`
- [x] `src/components/ObjectBrowserTab.tsx`
- [x] `src/components/DatabaseTablesOverviewTab.tsx`
- [x] `src/components/DatabaseOperationsTab.tsx`

---

## Fase 6 — Importación, Exportación, Respaldos y Transferencia

**Namespaces sugeridos:** `transfer.json`, `backup.json`

### Importación / Exportación / Datos de Prueba
- [x] `src/components/SqlExportModal.tsx`
- [x] `src/components/ExcelImportModal.tsx`
- [x] `src/components/excelImport/StepFile.tsx`
- [x] `src/components/excelImport/StepTarget.tsx`
- [x] `src/components/excelImport/StepMode.tsx`
- [x] `src/components/excelImport/StepMapping.tsx`
- [x] `src/components/excelImport/StepExecution.tsx`
- [x] `src/components/DataTransferTab.tsx`
- [x] `src/components/DataMaskingModal.tsx`
- [x] `src/components/TestDataModal.tsx`

### Respaldos y Restauración
- [x] `src/components/BackupRestoreModal.tsx`
- [x] `src/components/backupRestore/BackupTab.tsx`
- [x] `src/components/backupRestore/BackupContentOptions.tsx`
- [x] `src/components/backupRestore/DirectoryBackupSettings.tsx`
- [x] `src/components/backupRestore/BackupResults.tsx`
- [x] `src/components/backupRestore/RestoreTab.tsx`
- [x] `src/components/backupRestore/RestoreSourcePicker.tsx`
- [x] `src/components/backupRestore/RestoreResults.tsx`
- [x] `src/components/backupRestore/VerifyTab.tsx`
- [x] `src/components/backupRestore/ProfilesTab.tsx`
- [x] `src/components/backupRestore/HistoryTab.tsx`
- [x] `src/components/backupRestore/BackupRestoreFooter.tsx`

---

## Fase 7 — Diagnóstico, Rendimiento, Comparadores, Usuarios e IA

**Namespaces sugeridos:** `diagnostics.json`, `compare.json`, `ai.json`

### Monitoreo, Rendimiento y Auditoría
- [x] `src/components/DashboardTab.tsx`
- [x] `src/components/HealthMonitorTab.tsx`
- [x] `src/components/LocksInspectorTab.tsx`
- [x] `src/components/SlowQueryAnalyzerTab.tsx`
- [x] `src/components/slowQuery/ExplainAnalyzer.tsx`
- [x] `src/components/slowQuery/ServerActivity.tsx`
- [x] `src/components/QueryPlanViewer.tsx`
- [x] `src/components/ExplainPlanTree.tsx`
- [x] `src/components/ExplainJsonViewer.tsx`
- [x] `src/components/IndexAdvisorTab.tsx`
- [x] `src/components/IndexAdvisorScriptModal.tsx`
- [x] `src/components/DatabaseReportsModal.tsx`
- [x] `src/components/DiagnosticsModal.tsx`
- [x] `src/components/AuditLogModal.tsx`

### Comparadores y Administración
- [x] `src/components/SchemaDiffTab.tsx`
- [x] `src/components/DataCompareTab.tsx`
- [x] `src/components/UserManagerTab.tsx`

### Asistentes y Agente IA
- [x] `src/components/SqlAssistantModal.tsx`
- [x] `src/components/SqlCopilotDrawer.tsx`
- [x] `src/components/DatabaseAgentTab.tsx`
- [x] `src/components/agent/AgentHeader.tsx`
- [x] `src/components/agent/AgentComposer.tsx`
- [x] `src/components/agent/AgentMessage.tsx`
- [x] `src/components/agent/AgentActivity.tsx`
- [x] `src/components/agent/EmptyConversation.tsx`
- [x] `src/components/agent/TablePicker.tsx`
- [x] `src/components/agent/CodeBlock.tsx`
- [x] `src/components/agent/CopyButton.tsx`
- [x] `src/components/ai/AiNotice.tsx`

---

## Fase 8 — Capa de Lógica (Stores, Services, Utils) y Formatos Localizados

**Namespaces sugeridos:** `errors.json`, `messages.json`

### Stores con mensajes al usuario (`i18n.t`)
- [x] `src/stores/connectionStore.ts`
- [x] `src/stores/uiStore.ts`
- [x] `src/stores/stagedChangesStore.ts`
- [x] `src/stores/pendingChangesStore.ts`
- [x] `src/stores/manualTxStore.ts`
- [x] `src/stores/schemaStore.ts`
- [x] `src/stores/aiStore.ts`
- [x] `src/stores/updaterStore.ts`
- [x] `src/stores/workspaceStore.ts`
- [x] `src/stores/envVariablesStore.ts`
- [x] `src/stores/capabilitiesStore.ts`

### Services y Utils con textos / errores / formatos
- [x] `src/utils/errors.ts` (mapeo de errores Rust/SQL a claves traducibles)
- [x] `src/utils/exportFormatAdvice.ts`
- [x] `src/utils/exportProgress.ts`
- [x] `src/utils/formatBytes.ts` (formatos numéricos con `Intl.NumberFormat`)
- [x] `src/utils/liveMetrics.ts`
- [x] `src/utils/maskingInference.ts`
- [x] `src/services/aiService.ts`
- [x] `src/services/aiReadiness.ts`
- [x] `src/services/diagnosticExport.ts`
- [x] `src/services/sqlDiagnostics.ts`
- [x] `src/services/workspaceService.ts`

---

## Fase 9 — Validación Final y Control de Calidad

- [ ] Verificar que `src/i18n/__tests__/i18n.test.ts` cubra todos los namespaces y pase sin claves faltantes ni sobrantes.
- [ ] Revisar formatos de fecha y números (`Intl.DateTimeFormat`, `Intl.NumberFormat`) usando el idioma resuelto (`es` / `en`).
- [ ] Ejecutar suite completa: `npm test` y `npm run build`.
- [ ] Revisar visualmente en la app (`npm run tauri:dev`) en **Español** e **Inglés** que no haya desbordamientos de texto en botones, pestañas o barras de herramientas.
