import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { ghostBtn } from "../ui/styles";
import type { ForeignKeyMetadata } from "../../types/database";
import { InspectorLoading } from "./InspectorLoading";

interface ForeignKeysPanelProps {
  tableName: string;
  isLoading: boolean;
  foreignKeys: ForeignKeyMetadata[];
  onAdd: () => void;
  onDrop: (constraintName: string) => void;
}

/** Foreign keys of a table, with add / drop actions. */
export function ForeignKeysPanel({ tableName, isLoading, foreignKeys, onAdd, onDrop }: ForeignKeysPanelProps) {
  const { t } = useTranslation("tableViewer");
  return (
  isLoading ? (
    <InspectorLoading label={t("foreignKeys.loading")} />
  ) : (
    <div className="space-y-3">
    <div className="flex items-center justify-between">
      <span className="text-xs text-fg-muted font-mono">
        {t("foreignKeys.header")} <strong className="text-fg">{tableName}</strong>
      </span>
      <button onClick={() => onAdd()} className={ghostBtn}>
        <Plus className="w-3.5 h-3.5" /> {t("foreignKeys.newRelation")}
      </button>
    </div>
  {foreignKeys.length === 0 ? (
    <div className="p-8 text-center text-fg-subtle font-mono text-xs bg-surface border border-line rounded-lg">
      {t("foreignKeys.empty")}
    </div>
  ) : (
    <div className="bg-surface border border-line rounded-lg overflow-hidden shadow-pop">
      <table className="w-full text-left text-xs border-collapse">
        <thead>
          <tr className="bg-raised text-fg-muted font-semibold border-b border-line text-[11px] font-mono">
            <th className="py-2.5 px-4">{t("foreignKeys.constraintName")}</th>
            <th className="py-2.5 px-4">{t("foreignKeys.sourceColumn")}</th>
            <th className="py-2.5 px-4">{t("foreignKeys.referencedTable")}</th>
            <th className="py-2.5 px-4">{t("foreignKeys.referencedColumn")}</th>
            <th className="py-2.5 px-4">ON UPDATE</th>
            <th className="py-2.5 px-4">ON DELETE</th>
            <th className="py-2.5 px-4 w-10"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {foreignKeys.map((fk, idx) => (
            <tr key={idx} className="hover:bg-hover transition-colors font-mono">
              <td className="py-2.5 px-4 font-semibold text-fg">{fk.name}</td>
              <td className="py-2.5 px-4 text-fg font-medium">{fk.column_name}</td>
              <td className="py-2.5 px-4 text-accent-text">{fk.referenced_table}</td>
              <td className="py-2.5 px-4 text-warning">{fk.referenced_column}</td>
              <td className="py-2.5 px-4 text-fg-muted text-[11px]">
                <span className="px-1.5 py-0.5 rounded bg-raised border border-line-strong">
                  {fk.update_rule}
                </span>
              </td>
              <td className="py-2.5 px-4 text-fg-muted text-[11px]">
                <span className="px-1.5 py-0.5 rounded bg-raised border border-line-strong">
                  {fk.delete_rule}
                </span>
              </td>
              <td className="py-2.5 px-2 text-right">
                {/* Composite keys have one row per column: one button per key. */}
                {foreignKeys.findIndex((other) => other.name === fk.name) === idx && (
                  <button
                    className={ghostBtn}
                    title={t("foreignKeys.dropTooltip")}
                    onClick={() => onDrop(fk.name)}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-danger" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )}
  </div>
  )
  );
}
