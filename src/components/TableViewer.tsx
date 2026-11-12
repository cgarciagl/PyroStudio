import React, { useState } from "react";
import { formatExportProgress } from "../utils/exportProgress";
import {
  Key,
  FileSpreadsheet,
  Upload,
  Loader2,
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  FileCode2,
  ChevronDown,
  FlaskConical,
  GitCompareArrows,
} from "lucide-react";
import { useDdlBuilder } from "../services/ddl";
import { ghostBtn, menuItem, menuPanel, menuSeparator, tabClass } from "./ui/styles";
import type {
  ColumnMetadata,
  TableMetadata,
} from "../types/database";
import { dbService } from "../services/tauriDb";
import { useUIStore } from "../stores/uiStore";
import { useCapabilitiesStore } from "../stores/capabilitiesStore";
import { DataGridCanvas } from "./DataGridCanvas";
import { ConfirmModal } from "./ConfirmModal";
import { IndexAdvisorScriptModal } from "./IndexAdvisorScriptModal";
import { uid } from "../utils/uid";
import { errorText } from "../utils/errors";
import { formatBytes } from "../utils/formatBytes";
import { useTableMetadata, type InspectorTab } from "./tableViewer/useTableMetadata";
import { useTableExport } from "./tableViewer/useTableExport";
import { AdvisorPanel } from "./tableViewer/AdvisorPanel";
import { ForeignKeysPanel } from "./tableViewer/ForeignKeysPanel";
import { TriggersPanel } from "./tableViewer/TriggersPanel";
import { StatisticsPanel } from "./tableViewer/StatisticsPanel";
import { DdlPanel } from "./tableViewer/DdlPanel";
import { StructurePanel } from "./tableViewer/StructurePanel";

const ExcelImportModal = React.lazy(() => import("./ExcelImportModal").then(m => ({ default: m.ExcelImportModal })));
const TestDataModal = React.lazy(() => import("./TestDataModal").then(m => ({ default: m.TestDataModal })));
const AddColumnModal = React.lazy(() => import("./AddColumnModal").then(m => ({ default: m.AddColumnModal })));
const EditColumnModal = React.lazy(() => import("./EditColumnModal").then(m => ({ default: m.EditColumnModal })));
const PrimaryKeyEditor = React.lazy(() => import("./PrimaryKeyEditor").then(m => ({ default: m.PrimaryKeyEditor })));
const DesignDropColumn = React.lazy(() => import("./DesignDropColumn").then(m => ({ default: m.DesignDropColumn })));
const ForeignKeyEditor = React.lazy(() => import("./ForeignKeyEditor").then(m => ({ default: m.ForeignKeyEditor })));
const IndexManagerTab = React.lazy(() => import("./IndexManagerTab").then(m => ({ default: m.IndexManagerTab })));

interface TableViewerProps {
  database: string;
  table: TableMetadata;
  onRefreshTable?: () => void;
  onTableDeleted?: (dbName: string, tableName: string) => void;
  onOpenCreateTrigger?: (dbName: string, tableName?: string) => void;
  /** WHERE condition applied to the data grid on load (foreign key jumps). */
  initialFilter?: string;
}


export const TableViewer: React.FC<TableViewerProps> = ({
  database,
  table,
  onRefreshTable,
  onTableDeleted: _onTableDeleted,
  onOpenCreateTrigger,
  initialFilter,
}) => {
  const { openSqlExportModal, openTab } = useUIStore();
  const [activeTab, setActiveTab] = useState<InspectorTab>("data");
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isTestDataOpen, setIsTestDataOpen] = useState(false);
  // Bumped to reload the data grid (generated/imported rows, structure changes).
  const [gridVersion, setGridVersion] = useState(0);
  const reloadGrid = () => setGridVersion((v) => v + 1);
  const [isAddColumnOpen, setIsAddColumnOpen] = useState(false);
  // SQLite cannot add a primary key with ALTER TABLE, so the 1-click offer is MySQL-only.
  const engine = useDdlBuilder().engine;
  const canOfferPrimaryKey = engine !== "sqlite";
  const [isPkEditorOpen, setIsPkEditorOpen] = useState(false);
  // SQLite drops go through the designer engine (rebuild when DROP COLUMN cannot).
  const [sqliteColumnToDrop, setSqliteColumnToDrop] = useState<string | null>(null);
  const [fkAction, setFkAction] = useState<{ kind: "add" } | { kind: "drop"; name: string } | null>(null);
  const [addColumnPreset, setAddColumnPreset] = useState<"auto_increment_pk" | "none">("none");
  const [editingColumn, setEditingColumn] = useState<ColumnMetadata | null>(null);
  const [showAdvisorScript, setShowAdvisorScript] = useState(false);
  const [columnToDelete, setColumnToDelete] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<{ success?: boolean; message?: string } | null>(null);

  /** Transient status line in the header (success or error). */
  const flashStatus = (success: boolean, message: string, ms = success ? 4000 : 6000) => {
    setActionStatus({ success, message });
    setTimeout(() => setActionStatus(null), ms);
  };
  const showLoadError = (what: string, err: unknown) => flashStatus(false, `${what}: ${errorText(err)}`);

  const {
    columns,
    primaryKeyColumns,
    isLoadingCols,
    inspectorDetails,
    isLoadingInspector,
    advisorReport: tableAdvisorReport,
    isLoadingAdvisor: isLoadingTableAdvisor,
    fetchColumns,
    fetchInspectorDetails,
    fetchAdvisorReport,
    afterSchemaChange: refreshMetadata,
    invalidateIndexes,
  } = useTableMetadata(database, table.name, activeTab, showLoadError);

  const { isExporting, exportProgress, exportSummary, exportTable } = useTableExport(
    database,
    table.name,
    table.rows_count,
    (message) => flashStatus(false, message),
  );

  /** After any structural change: metadata, cached advice and the data grid. */
  const afterSchemaChange = () => {
    refreshMetadata();
    reloadGrid();
    onRefreshTable?.();
  };

  const openAddColumn = (preset: "auto_increment_pk" | "none") => {
    setAddColumnPreset(preset);
    setIsAddColumnOpen(true);
  };
  const openAddPrimaryKey = () => openAddColumn("auto_increment_pk");

  const handleDeleteColumn = (columnName: string) => {
    if (engine === "sqlite") setSqliteColumnToDrop(columnName);
    else setColumnToDelete(columnName);
  };

  const executeDeleteColumn = async () => {
    if (!columnToDelete) return;
    const colName = columnToDelete;
    setColumnToDelete(null);
    try {
      const q = (id: string) => `\`${id.replace(/`/g, "``")}\``;
      await dbService.executeConfirmedQuery(
        `ALTER TABLE ${q(database)}.${q(table.name)} DROP COLUMN ${q(colName)};`,
        database,
      );
      flashStatus(true, `Columna '${colName}' eliminada exitosamente.`);
      afterSchemaChange();
    } catch (err: unknown) {
      flashStatus(false, errorText(err, "Error al eliminar la columna"));
    }
  };

  const [openMenu, setOpenMenu] = useState<"transfer" | "more" | null>(null);

  const primaryTabs: { id: InspectorTab; label: string }[] = [
    { id: "data", label: "Datos" },
    { id: "structure", label: `Estructura (${columns.length})` },
    { id: "indexes", label: "Índices" },
    {
      id: "foreign_keys",
      label: `Relaciones${inspectorDetails ? ` (${inspectorDetails.foreign_keys.length})` : ""}`,
    },
    { id: "ddl", label: "DDL" },
  ];
  const advisorCount = tableAdvisorReport?.recommendations?.length ?? 0;
  const supportsFeature = useCapabilitiesStore((state) => state.supportsFeature);
  const secondaryTabs: { id: InspectorTab; label: string }[] = [
    { id: "triggers", label: `Triggers${inspectorDetails ? ` (${inspectorDetails.triggers.length})` : ""}` },
    { id: "statistics", label: "Estadísticas" },
    ...(supportsFeature("indexAdvisor")
      ? [{ id: "advisor" as const, label: `Asesor de índices${advisorCount ? ` (${advisorCount})` : ""}` }]
      : []),
  ];
  const activeSecondary = secondaryTabs.find((t) => t.id === activeTab);

  return (
    <div
    className={`pyro-view flex-1 flex flex-col h-full overflow-hidden transition-colors bg-surface text-fg`}
    >
      {/* Table Header: one compact row — identity on the left, a single neutral menu on the right */}
      <div
      data-view-toolbar data-inspector-toolbar className={`relative z-40 px-4 py-2 border-b flex items-center justify-between gap-3 select-none bg-surface border-line`}
      >
        <div className="min-w-0 flex items-baseline gap-2">
          <span className={`text-xs font-mono shrink-0 text-fg-subtle`}>
            {database} /
          </span>
          <h1
            className={`text-sm font-semibold font-mono truncate text-fg`}
            title={[table.table_type, table.engine, table.collation].filter(Boolean).join(" · ")}
          >
            {table.name}
          </h1>
          <span className={`hidden md:inline text-[11px] font-mono truncate text-fg-subtle`}>
            {[
              table.rows_count !== null && table.rows_count !== undefined
                ? `~${table.rows_count.toLocaleString()} filas`
                : null,
              table.data_length ? formatBytes(table.data_length) : null,
              table.table_type && table.table_type !== "BASE TABLE" ? table.table_type : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Transient status: one neutral line, color only on the icon */}
          {isExporting && exportProgress ? (
            <span role="status" aria-live="polite" className="flex items-center gap-1.5 text-[11px] text-fg-muted font-mono">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-fg-muted" />
              {formatExportProgress(exportProgress, table.rows_count)}
            </span>
          ) : exportSummary ? (
            <span className="flex items-center gap-1.5 text-[11px] text-fg-muted font-mono">
              <CheckCircle2 className="w-3.5 h-3.5 text-success" />
              Exportado: {exportSummary.total_rows.toLocaleString()} filas ({(exportSummary.file_size_bytes / 1024).toFixed(1)} KB)
            </span>
          ) : actionStatus ? (
            <span className="flex items-center gap-1.5 text-[11px] text-fg-muted font-mono max-w-xs truncate" title={actionStatus.message}>
              {actionStatus.success ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-success" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-danger" />
              )}
              <span className="truncate">{actionStatus.message}</span>
            </span>
          ) : null}

          <div className="relative">
            <button
              onClick={() => setOpenMenu(openMenu === "transfer" ? null : "transfer")}
              disabled={isExporting}
              className={ghostBtn}
            >
              <span>Importar / Exportar</span>
              <ChevronDown className="w-3.5 h-3.5 opacity-60" />
            </button>
            {openMenu === "transfer" && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpenMenu(null)} />
                <div className={menuPanel}>
                  <button className={menuItem} onClick={() => { setOpenMenu(null); exportTable(); }}>
                    <FileSpreadsheet className="w-3.5 h-3.5 opacity-70" /> Exportar (Excel o CSV)
                  </button>
                  <button className={menuItem} onClick={() => { setOpenMenu(null); openSqlExportModal({ database, table: table.name }); }}>
                    <FileCode2 className="w-3.5 h-3.5 opacity-70" /> Exportar a SQL
                  </button>
                  <div className={menuSeparator} />
                  <button className={menuItem} onClick={() => { setOpenMenu(null); setIsImportModalOpen(true); }}>
                    <Upload className="w-3.5 h-3.5 opacity-70" /> Importar (Excel, CSV o JSON)
                  </button>
                  <button className={menuItem} onClick={() => { setOpenMenu(null); setIsTestDataOpen(true); }}>
                    <FlaskConical className="w-3.5 h-3.5 opacity-70" /> Generar datos de prueba
                  </button>
                  <button
                    className={menuItem}
                    onClick={() => {
                      setOpenMenu(null);
                      openTab({
                        id: `data-diff-${uid()}`,
                        title: `Comparar datos (${table.name})`,
                        type: "data_diff",
                        database,
                        tableName: table.name,
                      });
                    }}
                  >
                    <GitCompareArrows className="w-3.5 h-3.5 opacity-70" /> Comparar datos con otra tabla
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Sub-tabs: one accent color; secondary views live under "Más" */}
      <div
      data-inspector-tabs className={`relative z-30 px-4 border-b flex items-center justify-between text-xs select-none bg-surface border-line`}
      >
        <div className="flex items-center gap-1 min-w-0">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none min-w-0">
          {primaryTabs.map((t) => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} className={tabClass(activeTab === t.id)}>
              {t.label}
            </button>
          ))}
          {activeSecondary && (
            <button className={tabClass(true)}>{activeSecondary.label}</button>
          )}
          </div>
          {/* Outside the scroll container so the dropdown is not clipped */}
          <div className="relative shrink-0">
            <button
              onClick={() => setOpenMenu(openMenu === "more" ? null : "more")}
              className={`${tabClass(false)} flex items-center gap-1`}
            >
              Más <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
            {openMenu === "more" && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpenMenu(null)} />
                <div className={`${menuPanel} left-0 right-auto`}>
                  {secondaryTabs.map((t) => (
                    <button
                      key={t.id}
                      className={menuItem}
                      onClick={() => {
                        setOpenMenu(null);
                        setActiveTab(t.id);
                        if (t.id === "advisor") fetchAdvisorReport();
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {activeTab === "structure" && (
          <div className="flex items-center gap-1.5 py-1">
            {primaryKeyColumns.length === 0 && canOfferPrimaryKey && (
              <button
                onClick={openAddPrimaryKey}
                className={ghostBtn}
                title="Añadir clave primaria autoincremental en 1 clic"
              >
                <Key className="w-3.5 h-3.5 text-warning" />
                <span>+ Primary Key</span>
              </button>
            )}
            <button
              onClick={() => openAddColumn("none")}
              className={ghostBtn}
            >
              <Plus className="w-3.5 h-3.5" /> Columna
            </button>
            <button
              onClick={() => setIsPkEditorOpen(true)}
              className={ghostBtn}
              title="Elegir las columnas de la clave primaria y su autoincremento"
            >
              <Key className="w-3.5 h-3.5 text-warning" /> Llave primaria
            </button>
            <button
              onClick={() => {
                fetchColumns();
                fetchInspectorDetails();
              }}
              title="Refrescar columnas y detalles"
              className={ghostBtn}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {activeTab === "advisor" && (
          <div className="flex items-center py-1">
            <button onClick={fetchAdvisorReport} disabled={isLoadingTableAdvisor} className={ghostBtn}>
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingTableAdvisor ? "animate-spin" : ""}`} /> Re-analizar
            </button>
            <button
              onClick={() => setShowAdvisorScript(true)}
              disabled={isLoadingTableAdvisor || advisorCount === 0}
              title="Ver y descargar un script SQL con todas las recomendaciones de esta tabla"
              className={ghostBtn}
            >
              <FileCode2 className="w-3.5 h-3.5" /> Script SQL ({advisorCount})
            </button>
          </div>
        )}
      </div>

      {/* Main Content Pane */}
      {activeTab === "data" ? (
        <div className="flex-1 min-h-0 relative overflow-hidden">
          <DataGridCanvas
            key={gridVersion}
            database={database}
            table={table.name}
            primaryKeyColumns={primaryKeyColumns}
            initialServerFilter={initialFilter}
          />
        </div>
      ) : (
        <div data-inspector-content className="flex-1 overflow-auto p-6">
          {activeTab === "advisor" ? (
            <AdvisorPanel
              database={database}
              tableName={table.name}
              engine={engine}
              isLoading={isLoadingTableAdvisor}
              report={tableAdvisorReport}
              indexCount={inspectorDetails?.indexes?.length}
              onShowScript={() => setShowAdvisorScript(true)}
            />
          ) : activeTab === "indexes" ? (
            <IndexManagerTab
              database={database}
              table={table.name}
              columns={columns}
              onChanged={invalidateIndexes}
            />
          ) : activeTab === "foreign_keys" ? (
            <ForeignKeysPanel
              tableName={table.name}
              isLoading={isLoadingInspector}
              foreignKeys={inspectorDetails?.foreign_keys ?? []}
              onAdd={() => setFkAction({ kind: "add" })}
              onDrop={(name) => setFkAction({ kind: "drop", name })}
            />
          ) : activeTab === "triggers" ? (
            <TriggersPanel
              tableName={table.name}
              isLoading={isLoadingInspector}
              triggers={inspectorDetails?.triggers ?? []}
              onCreateTrigger={onOpenCreateTrigger ? () => onOpenCreateTrigger(database, table.name) : undefined}
            />
          ) : activeTab === "statistics" ? (
            <StatisticsPanel isLoading={isLoadingInspector} statistics={inspectorDetails?.statistics} />
          ) : activeTab === "ddl" ? (
            <DdlPanel isLoading={isLoadingInspector} ddl={inspectorDetails?.ddl} />
          ) : activeTab === "structure" ? (
            <StructurePanel
              columns={columns}
              isLoading={isLoadingCols}
              primaryKeyColumns={primaryKeyColumns}
              canOfferPrimaryKey={canOfferPrimaryKey}
              onAddPrimaryKey={openAddPrimaryKey}
              onEditColumn={setEditingColumn}
              onDeleteColumn={handleDeleteColumn}
            />
          ) : null}
        </div>
      )}

      <React.Suspense fallback={null}>
        {/* Add Column Modal */}
        {isPkEditorOpen && (
          <PrimaryKeyEditor
            database={database}
            table={table.name}
            engine={engine}
            onClose={() => setIsPkEditorOpen(false)}
            onChanged={afterSchemaChange}
          />
        )}

        {sqliteColumnToDrop && (
          <DesignDropColumn
            database={database}
            table={table.name}
            column={sqliteColumnToDrop}
            onClose={() => setSqliteColumnToDrop(null)}
            onChanged={afterSchemaChange}
          />
        )}

        {fkAction && (
          <ForeignKeyEditor
            database={database}
            table={table.name}
            action={fkAction}
            onClose={() => setFkAction(null)}
            onChanged={afterSchemaChange}
          />
        )}

        {isAddColumnOpen && (
          <AddColumnModal
            isOpen={isAddColumnOpen}
            onClose={() => {
              setIsAddColumnOpen(false);
              setAddColumnPreset("none");
            }}
            database={database}
            table={table.name}
            existingColumns={columns}
            initialPreset={addColumnPreset}
            onColumnAdded={afterSchemaChange}
          />
        )}

        <TestDataModal
          isOpen={isTestDataOpen}
          onClose={() => setIsTestDataOpen(false)}
          database={database}
          table={table.name}
          onGenerated={() => {
            reloadGrid();
            onRefreshTable?.();
          }}
        />

        {/* Edit Column Modal */}
        {editingColumn && (
          <EditColumnModal
            isOpen={!!editingColumn}
            onClose={() => setEditingColumn(null)}
            database={database}
            table={table.name}
            column={editingColumn}
            onColumnUpdated={afterSchemaChange}
          />
        )}

        {/* Excel Import Stepper Wizard */}
        <ExcelImportModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          database={database}
          table={table.name}
          dbColumns={columns}
          onImportComplete={() => {
            // Imported rows: the open data grid must reload too.
            reloadGrid();
            fetchInspectorDetails();
            onRefreshTable?.();
          }}
        />
      </React.Suspense>

      {tableAdvisorReport && (
        <IndexAdvisorScriptModal
          isOpen={showAdvisorScript}
          onClose={() => setShowAdvisorScript(false)}
          report={tableAdvisorReport}
          scopeLabel={`tabla ${table.name}`}
          onOpenInEditor={(sql) =>
            openTab({
              id: `query-${uid()}`,
              title: `Índices ${table.name}`,
              type: "query",
              database,
              queryContent: sql,
            })
          }
        />
      )}

      <ConfirmModal
        isOpen={!!columnToDelete}
        title="Eliminar Columna"
        message={`¿Estás seguro de eliminar la columna '${columnToDelete}' de la tabla '${table.name}'?`}
        details="Esta acción ejecutará ALTER TABLE DROP COLUMN y borrará todos los datos almacenados en dicha columna."
        confirmText="Eliminar Columna"
        variant="danger"
        onConfirm={executeDeleteColumn}
        onClose={() => setColumnToDelete(null)}
      />
    </div>
  );
};
