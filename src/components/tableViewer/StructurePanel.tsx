import { useTranslation } from "react-i18next";
import { InspectorLoading } from "./InspectorLoading";
import { Edit3, Key, Trash2 } from "lucide-react";
import { secondaryBtn } from "../ui/styles";
import type { ColumnMetadata } from "../../types/database";

interface StructurePanelProps {
  columns: ColumnMetadata[];
  isLoading: boolean;
  primaryKeyColumns: string[];
  /** Whether the engine can add a primary key in place (not SQLite). */
  canOfferPrimaryKey: boolean;
  onAddPrimaryKey: () => void;
  onEditColumn: (col: ColumnMetadata) => void;
  onDeleteColumn: (name: string) => void;
}

/** Column list of a table, with edit / drop per column. */
export function StructurePanel({
  columns,
  isLoading,
  primaryKeyColumns,
  canOfferPrimaryKey,
  onAddPrimaryKey,
  onEditColumn,
  onDeleteColumn,
}: StructurePanelProps) {
  const { t } = useTranslation("tableViewer");
  return (
  isLoading ? (
    <InspectorLoading label={t("structure.loading")} />
  ) : (
    <div className="space-y-4">
      {primaryKeyColumns.length === 0 && columns.length > 0 && canOfferPrimaryKey && (
        <div className="p-3.5 rounded-lg border border-line bg-raised flex items-center justify-between gap-4 text-xs">
          <div className="flex items-center space-x-2.5">
            <Key className="w-4 h-4 text-warning shrink-0" />
            <div>
              <span className="font-semibold text-fg">{t("structure.noPkTitle")}</span>
              <p className="text-[11px] text-fg-muted mt-0.5">
                {t("structure.noPkDesc")}
              </p>
            </div>
          </div>
          <button
            onClick={onAddPrimaryKey}
            className={secondaryBtn}
          >
            <Key className="w-3.5 h-3.5 text-warning" />
            <span>{t("structure.addPkBtn")}</span>
          </button>
        </div>
      )}
      <div
        className={`rounded-lg overflow-hidden shadow-xl border bg-surface border-line`}
      >
      <table className="w-full text-left text-xs border-collapse">
        <thead>
          <tr
          className={`font-semibold border-b select-none text-[11px] font-mono bg-raised text-fg-muted border-line`}
          >
            <th className="py-2.5 px-3 w-10 text-center">#</th>
            <th className="py-2.5 px-4">{t("structure.colName")}</th>
            <th className="py-2.5 px-4">{t("structure.colType")}</th>
            <th className="py-2.5 px-3">{t("structure.collation")}</th>
            <th className="py-2.5 px-4">{t("structure.key")}</th>
            <th className="py-2.5 px-4">{t("structure.nullable")}</th>
            <th className="py-2.5 px-4">{t("structure.defaultVal")}</th>
            <th className="py-2.5 px-4">{t("structure.extra")}</th>
            <th className="py-2.5 px-4">{t("structure.comment")}</th>
            <th className="py-2.5 px-3 w-24 text-center">{t("structure.actions")}</th>
          </tr>
        </thead>
        <tbody
        className={`divide-y divide-line`}
        >
          {columns.map((col) => {
            const isPK = col.column_key === "PRI";
            const isUnique = col.column_key === "UNI";

            return (
              <tr
                key={col.name}
                className={`transition-colors hover:bg-hover`}
              >
                <td
                className={`py-2.5 px-3 text-center font-mono text-[11px] text-fg-subtle`}
                >
                  {col.ordinal_position}
                </td>
                <td
                className={`py-2.5 px-4 font-mono font-medium flex items-center space-x-2 text-fg`}
                >
                  {isPK && (
                    <span title={t("structure.pkTooltip")}>
                      <Key className="w-3.5 h-3.5 text-warning shrink-0" />
                    </span>
                  )}
                  <span>{col.name}</span>
                </td>
                <td
                className={`py-2.5 px-4 font-mono text-accent-text`}
                >
                  {col.column_type}
                </td>
                <td className="py-2.5 px-3 font-mono text-xs">
                  {col.collation ? (
                    <span
                    className={`text-[11px] px-2 py-0.5 rounded border font-mono bg-elevated text-accent-text/90 border-line-strong`}
                    >
                      {col.collation}
                    </span>
                  ) : col.character_set ? (
                    <span
                    className={`text-[11px] font-mono text-fg-muted`}
                    >
                      {col.character_set}
                    </span>
                  ) : (
                    <span
                    className={`font-mono text-fg-subtle`}
                    >
                      —
                    </span>
                  )}
                </td>
                <td className="py-2.5 px-4">
                  {isPK && (
                    <span className="px-1.5 py-0.5 rounded text-[11px] font-bold text-warning border border-line">
                      PRIMARY
                    </span>
                  )}
                  {isUnique && (
                    <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-raised text-fg-muted border border-line">
                      UNIQUE
                    </span>
                  )}
                  {col.column_key === "MUL" && (
                    <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-raised text-fg-muted border border-line">
                      INDEX
                    </span>
                  )}
                </td>
                <td className="py-2.5 px-4">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[11px] font-mono ${
                      col.is_nullable
                        ? "text-success"
                        : "text-fg-subtle bg-surface/40"
                    }`}
                  >
                    {col.is_nullable ? "YES" : "NO"}
                  </span>
                </td>
                <td className="py-2.5 px-4 font-mono text-fg-muted">
                  {col.column_default !== null &&
                  col.column_default !== undefined ? (
                    <span className="text-fg">
                      {col.column_default}
                    </span>
                  ) : (
                    <span className="text-fg-subtle italic">NULL</span>
                  )}
                </td>
                <td className="py-2.5 px-4 font-mono text-[11px] text-fg-muted">
                  {col.extra || "—"}
                </td>
                <td className="py-2.5 px-4 text-fg-muted text-xs">
                  {col.comment || "—"}
                </td>
                <td className="py-2.5 px-3 text-center">
                  <div className="flex items-center justify-center space-x-1.5">
                    <button
                      type="button"
                      onClick={() => onEditColumn(col)}
                      title={t("structure.editColTitle")}
                      className="p-1 rounded text-fg-muted hover:text-accent-text hover:bg-hover transition-colors"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteColumn(col.name)}
                      title={t("structure.dropColTitle")}
                      className="p-1 rounded text-fg-muted hover:text-danger hover:bg-hover transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </div>
  )
  );
}
