import { useTranslation } from "react-i18next";
import { Key, Pencil, Lock } from "lucide-react";
interface EditTargetBarProps {
  database: string;
  columns: string[];
  availableTables: string[];
  tableOverride: string;
  detectedTable: string | null;
  targetTable: string;
  pkOverride: string;
  /** Key reported by the database for the target table. */
  tablePkColumns: string[];
  hasPrimaryKey: boolean;
  canEdit: boolean;
  readOnly: boolean;
  onTableChange: (table: string) => void;
  onPkChange: (pk: string) => void;
}

/** Target table / key of an editable result, and why it is or is not editable. */
export function EditTargetBar({
  database,
  columns,
  availableTables,
  tableOverride,
  detectedTable,
  targetTable,
  pkOverride,
  tablePkColumns,
  hasPrimaryKey,
  canEdit: canEditResult,
  readOnly: connectionReadOnly,
  onTableChange,
  onPkChange,
}: EditTargetBarProps) {
  const { t } = useTranslation("queryEditor");

  return (
    <>
    <label className="flex items-center gap-1" title={t("editTarget.tableTooltip")}>
      <span>{t("editTarget.tableLabel")}</span>
      <input
        type="text"
        list={`tables-list-${database}`}
        value={tableOverride || detectedTable || ""}
        onChange={(e) => onTableChange(e.target.value)}
        placeholder="—"
        className="bg-transparent text-fg w-28 px-1 py-0.5 rounded border border-transparent hover:border-line focus:border-accent focus:outline-none"
      />
      {availableTables.length > 0 && (
        <datalist id={`tables-list-${database}`}>
          {availableTables.map((tbl) => (
            <option key={tbl} value={tbl} />
          ))}
        </datalist>
      )}
    </label>

    {columns.length > 0 && (
      <label className="flex items-center gap-1" title={t("editTarget.pkTooltip")}>
        <Key className="w-3 h-3" />
        <select
          value={pkOverride || (tablePkColumns.length > 0 ? tablePkColumns.join(",") : "")}
          onChange={(e) => onPkChange(e.target.value)}
          className="bg-transparent text-fg focus:outline-none cursor-pointer max-w-[170px] truncate rounded hover:bg-hover"
        >
          {tablePkColumns.length > 0 && (
            <option value={tablePkColumns.join(",")} className="bg-raised">
              {t("editTarget.pkAuto", { cols: tablePkColumns.join(", ") })}
            </option>
          )}
          <option value="" className="bg-raised">
            {t("editTarget.pkPlaceholder")}
          </option>
          {columns.map((c) => (
            <option key={c} value={c} className="bg-raised">
              {c}
            </option>
          ))}
        </select>
      </label>
    )}

    <span
      className={`flex items-center gap-1 ${canEditResult ? "" : "text-warning"}`}
      title={
        canEditResult
          ? t("editTarget.editableTooltip")
          : connectionReadOnly
          ? t("editTarget.readonlyConnTooltip")
          : !targetTable
          ? t("editTarget.noTableTooltip")
          : !hasPrimaryKey
          ? t("editTarget.noPkTooltip")
          : t("editTarget.missingPkColsTooltip")
      }
    >
      {canEditResult ? <Pencil className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
      {canEditResult ? t("editTarget.editable") : t("editTarget.readonly")}
    </span>
    </>
  );
}
