import React from "react";
import { Filter, PanelRight, Pin, Plus, RefreshCw, Search, X } from "lucide-react";
import type { TableDataResult } from "../../types/database";
import { iconBtn } from "../ui/styles";
import type { FilterRule } from "../VisualFilterBuilder";
import { SmartCopyMenu } from "./SmartCopyMenu";
import type { SmartCopyFormat } from "./copyFormats";

export interface GridToolbarActionsProps {
  dataResult: TableDataResult | null;
  displayRows: any[][];
  extraToolbarActions: React.ReactNode;
  filterRules: FilterRule[];
  freezeColumnsCount: number;
  getSelectedDataMatrix: () => { columns: string[]; rows: any[][] };
  handleClearServerFilter: () => void;
  handleSmartCopy: (format: SmartCopyFormat) => void;
  hasSelectionRange: boolean;
  isCopyMenuOpen: boolean;
  isEditingAllowed: boolean;
  isFilterBuilderOpen: boolean;
  isLoading: boolean;
  isRecordPanelOpen: boolean;
  isServerFilterActive: boolean;
  isWideLayout: boolean;
  loadData: (offset: number, limit: number) => void;
  pageOffset: number;
  pageSize: number;
  searchTerm: string;
  serverFilter: string;
  setIsCopyMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsFilterBuilderOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsNewRecordModalOpen: (open: boolean) => void;
  setIsRecordPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSearchTerm: (term: string) => void;
  totalRowsLabel: string;
}

/** Left side of the grid toolbar: reload, search, filters, new record, copy and stats. */
export const GridToolbarActions: React.FC<GridToolbarActionsProps> = ({
  dataResult,
  displayRows,
  extraToolbarActions,
  filterRules,
  freezeColumnsCount,
  getSelectedDataMatrix,
  handleClearServerFilter,
  handleSmartCopy,
  hasSelectionRange,
  isCopyMenuOpen,
  isEditingAllowed,
  isFilterBuilderOpen,
  isLoading,
  isRecordPanelOpen,
  isServerFilterActive,
  isWideLayout,
  loadData,
  pageOffset,
  pageSize,
  searchTerm,
  serverFilter,
  setIsCopyMenuOpen,
  setIsFilterBuilderOpen,
  setIsNewRecordModalOpen,
  setIsRecordPanelOpen,
  setSearchTerm,
  totalRowsLabel,
}) => (
  <div className="flex items-center space-x-2 flex-1 min-w-0">
    {/* Refresh button */}
    <button
      onClick={() => loadData(pageOffset, pageSize)}
      disabled={isLoading}
      title="Recargar datos de la tabla"
      className="p-1.5 rounded text-fg-muted hover:text-fg hover:bg-hover disabled:opacity-50 transition-colors"
    >
      <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-accent-text" : ""}`} />
    </button>

    {/* Search Input (Local batch) */}
    <div className="relative flex-1 max-w-[190px] 2xl:max-w-xs" title="Filtrado rápido en el lote de filas cargadas en memoria">
      <Search className="w-3.5 h-3.5 text-fg-subtle absolute left-2.5 top-1/2 -translate-y-1/2" />
      <input
        type="text"
        placeholder="Buscar en lote..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="w-full pl-8 pr-3 py-1 bg-surface border border-line rounded text-fg placeholder:text-fg-subtle text-xs font-mono focus:outline-none focus:border-accent transition-colors"
      />
    </div>

    {/* Visual Filter Button */}
    <button
      type="button"
      onClick={() => setIsFilterBuilderOpen((prev) => !prev)}
      title="Abrir constructor visual de filtros (condiciones múltiples, operadores y ordenación)"
      className={`flex items-center space-x-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all border ${
        isFilterBuilderOpen
          ? "bg-accent/25 text-accent-text border-accent/60 font-semibold shadow-xs"
          : isServerFilterActive
          ? "text-accent-text border-accent/40"
          : "border-transparent text-fg-muted hover:text-fg hover:bg-hover"
      }`}
    >
      <Filter className={`w-3.5 h-3.5 ${isServerFilterActive ? "text-accent-text" : "text-fg-muted"}`} />
      <span>Filtro</span>
      {isServerFilterActive && (
        <span className="px-1.5 py-0.2 rounded-full text-[11px] font-mono font-bold bg-accent text-accent-fg">
          {filterRules.filter((r) => r.enabled).length || 1}
        </span>
      )}
    </button>

    {/* Quick Active Filter Pill */}
    {isServerFilterActive && serverFilter && (
      <div
        className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono border max-w-[200px] 2xl:max-w-sm truncate bg-accent-soft border-accent/30 text-accent-text`}
        title={`Filtro activo: WHERE ${serverFilter}`}
      >
        <span className="truncate cursor-pointer" onClick={() => setIsFilterBuilderOpen(true)}>
          {serverFilter}
        </span>
        <button
          type="button"
          onClick={handleClearServerFilter}
          className="text-fg-muted hover:text-danger transition-colors"
          title="Quitar filtro"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    )}

    {/* Create New Record Button */}
    {isEditingAllowed && (
      <button
        onClick={() => setIsNewRecordModalOpen(true)}
        title="Registrar un nuevo registro"
        className="flex items-center space-x-1.5 px-2.5 py-1 rounded text-xs text-fg hover:text-fg hover:bg-hover transition-colors"
      >
        <Plus className="w-3.5 h-3.5 text-fg-muted" />
        <span>Nuevo</span>
      </button>
    )}

    {/* Smart Multi-Format Copy Dropdown (Only visible when a range of cells, rows, or columns is selected) */}
    {hasSelectionRange && (
      <SmartCopyMenu
        isOpen={isCopyMenuOpen}
        onToggle={() => setIsCopyMenuOpen((prev) => !prev)}
        getRowCount={() => getSelectedDataMatrix().rows.length}
        onCopy={handleSmartCopy}
      />
    )}

    {/* Extra toolbar actions */}
    {extraToolbarActions}

    {isWideLayout && dataResult && (
      <button
        onClick={() => setIsRecordPanelOpen((v) => !v)}
        className={`${iconBtn} ${isRecordPanelOpen ? "text-accent-text" : ""}`}
        title={isRecordPanelOpen ? "Ocultar detalle del registro" : "Mostrar detalle del registro junto al grid"}
      >
        <PanelRight className="w-3.5 h-3.5" />
      </button>
    )}

    {dataResult && (
      <div className="hidden sm:flex items-center space-x-2 text-fg-muted font-mono text-[11px]">
        <span>{dataResult.execution_time_ms} ms</span>
        <span>•</span>
        <span>
          {displayRows.length} de {totalRowsLabel} filas
        </span>
        {searchTerm && (
          <span className="text-warning/80">· lote filtrado</span>
        )}
        {isServerFilterActive && (
          <span className="text-accent-text/80">· filtro activo</span>
        )}
        {freezeColumnsCount > 0 && (
          <span className="flex items-center gap-1">
            · <Pin className="w-2.5 h-2.5" /> {freezeColumnsCount}
          </span>
        )}
      </div>
    )}
  </div>
);
