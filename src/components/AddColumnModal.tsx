import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus,
  Loader2,
  AlertCircle,
  Code2,
  Key,
} from "lucide-react";
import type { ColumnMetadata } from "../types/database";
import { dbService } from "../services/tauriDb";
import {
  useDdlBuilder,
  defaultLengthFor,
  synchronizeColumnAttributes,
  uniqueColumnName,
} from "../services/ddl";
import { useCapabilitiesStore } from "../stores/capabilitiesStore";
import { ghostBtn, primaryBtn, secondaryBtn } from "./ui/styles";
import { Modal } from "./ui/Modal";
import { errorText } from "../utils/errors";

interface AddColumnModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: string;
  table: string;
  existingColumns: ColumnMetadata[];
  onColumnAdded: () => void;
  initialPreset?: "auto_increment_pk" | "none";
}

const CHARACTER_SETS = [
  { name: "", key: "default" },
  { name: "utf8mb4", key: "utf8mb4" },
  { name: "utf8mb3", key: "utf8mb3" },
  { name: "latin1", key: "latin1" },
  { name: "ascii", key: "ascii" },
  { name: "binary", key: "binary" },
];

const COMMON_COLLATIONS = [
  { name: "", key: "default" },
  { name: "utf8mb4_unicode_ci", key: "utf8mb4_unicode_ci" },
  { name: "utf8mb4_general_ci", key: "utf8mb4_general_ci" },
  { name: "utf8mb4_spanish_ci", key: "utf8mb4_spanish_ci" },
  { name: "utf8mb4_spanish2_ci", key: "utf8mb4_spanish2_ci" },
  { name: "utf8mb4_bin", key: "utf8mb4_bin" },
  { name: "utf8mb4_0900_ai_ci", key: "utf8mb4_0900_ai_ci" },
  { name: "utf8_general_ci" },
  { name: "utf8_unicode_ci" },
  { name: "utf8_spanish_ci" },
  { name: "utf8_bin" },
  { name: "latin1_swedish_ci", key: "latin1_swedish_ci" },
  { name: "latin1_general_ci" },
  { name: "latin1_spanish_ci" },
  { name: "latin1_bin" },
  { name: "ascii_general_ci" },
  { name: "ascii_bin" },
  { name: "binary" },
];

export const AddColumnModal: React.FC<AddColumnModalProps> = ({
  isOpen,
  onClose,
  database,
  table,
  existingColumns,
  onColumnAdded,
  initialPreset = "none",
}) => {
  const { t } = useTranslation("schema");
  const ddl = useDdlBuilder();
  const supportsFeature = useCapabilitiesStore((state) => state.supportsFeature);
  const isPkPresetRequested = initialPreset === "auto_increment_pk";
  const hasExistingPk = existingColumns.some((c) => c.column_key === "PRI");
  const hasExistingAutoIncrement = existingColumns.some((c) =>
    c.extra?.toLowerCase().includes("auto_increment"),
  );
  // SQLite cannot add key columns with ALTER TABLE, and MySQL allows one
  // primary key and one auto-increment column per table.
  const canAddKey = ddl.engine !== "sqlite" && !hasExistingPk;
  const canAddAutoIncrement = canAddKey && !hasExistingAutoIncrement;
  const presetName = uniqueColumnName("id", existingColumns.map((c) => c.name));
  const isPkPreset = isPkPresetRequested && canAddAutoIncrement;

  const [columnName, setColumnName] = useState(isPkPreset ? presetName : "");
  const [dataType, setDataType] = useState(
    isPkPreset ? "BIGINT" : "VARCHAR",
  );
  const [length, setLength] = useState(
    isPkPreset ? "20" : "255",
  );
  const [characterSet, setCharacterSet] = useState("");
  const [collation, setCollation] = useState("");
  const [isNullable, setIsNullable] = useState(isPkPreset ? false : true);
  const [defaultValue, setDefaultValue] = useState("");
  const [isPrimaryKey, setIsPrimaryKey] = useState(isPkPreset ? true : false);
  const [isAutoIncrement, setIsAutoIncrement] = useState(isPkPreset ? true : false);
  const [isUnique, setIsUnique] = useState(false);
  const [position, setPosition] = useState<"END" | "FIRST" | string>(
    isPkPreset ? "FIRST" : "END",
  );
  const [comment, setComment] = useState(
    isPkPreset ? t("addColumn.pkComment") : "",
  );

  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApplyPkPreset = () => {
    setColumnName(presetName);
    setDataType(ddl.engine === "sqlite" ? "INTEGER" : "BIGINT");
    setLength(ddl.engine === "sqlite" ? "" : "20");
    setIsPrimaryKey(true);
    setIsAutoIncrement(true);
    setIsNullable(false);
    setPosition("FIRST");
    setComment(t("addColumn.pkComment"));
  };

  // Same rules as the create-table editor, with the existing table as context.
  const applyChange = (changed: {
    dataType?: string;
    length?: string;
    isPrimaryKey?: boolean;
    isAutoIncrement?: boolean;
  }) => {
    const next = synchronizeColumnAttributes(
      { dataType, length, isPrimaryKey, isAutoIncrement, isNullable },
      changed,
      ddl.engine,
      { otherPrimaryKeys: hasExistingPk ? 1 : 0, otherAutoIncrement: hasExistingAutoIncrement },
    );
    setDataType(next.dataType);
    setLength(next.length ?? "");
    setIsPrimaryKey(!!next.isPrimaryKey);
    setIsAutoIncrement(!!next.isAutoIncrement);
    setIsNullable(!!next.isNullable);
  };

  const handleDataTypeChange = (newType: string) =>
    applyChange({ dataType: newType, length: defaultLengthFor(newType) });

  const handlePrimaryKeyChange = (checked: boolean) => applyChange({ isPrimaryKey: checked });

  const handleAutoIncrementChange = (checked: boolean) =>
    applyChange({ isAutoIncrement: checked });

  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isTextType = [
    "VARCHAR",
    "CHAR",
    "TEXT",
    "MEDIUMTEXT",
    "LONGTEXT",
    "TINYTEXT",
    "ENUM",
    "SET",
  ].includes(dataType.toUpperCase());

  // Build the ALTER TABLE SQL statement dynamically
  const buildSql = () =>
    ddl.addColumn({
      database,
      table,
      column: {
        name: columnName.trim() || "nueva_columna",
        dataType,
        length,
        nullable: isNullable,
        defaultValue,
        autoIncrement: isAutoIncrement,
        primaryKey: isPrimaryKey,
        unique: isUnique,
        charset: characterSet,
        collation,
        comment,
      },
      position,
    });

  /** Live preview; an engine restriction is shown instead of the SQL. */
  const previewSql = () => {
    try {
      return buildSql();
    } catch (err) {
      return `-- ${(err as Error).message}`;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!columnName.trim()) {
      setError(t("addColumn.nameRequired"));
      return;
    }

    setIsExecuting(true);
    setError(null);

    try {
      await dbService.executeConfirmedQuery(buildSql(), database);
      onColumnAdded();
      onClose();
    } catch (err: unknown) {
      const msg =
        errorText(err, t("addColumn.addError"));
      setError(msg);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={<>{t("addColumn.title")}</>}
      subtitle={<>{database}.{table}</>}
      icon={<Plus className="w-4 h-4" />}
      size="md"
      bodyClassName="flex flex-col overflow-hidden"
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Helper banner when table has no Primary Key */}
          {canAddAutoIncrement && !isPrimaryKey && (
            <div className="p-3 rounded-lg border border-line bg-raised flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center space-x-2">
                <Key className="w-4 h-4 text-warning shrink-0" />
                <span className="text-fg-muted">
                  {t("addColumn.noPkBanner")} <strong className="text-fg">AUTO_INCREMENT PRIMARY KEY</strong>?
                </span>
              </div>
              <button
                type="button"
                onClick={handleApplyPkPreset}
                className={ghostBtn}
              >
                {t("addColumn.applyId")}
              </button>
            </div>
          )}

          {/* Column Name & Data Type */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <label className="text-xs font-medium text-fg">
                {t("addColumn.colName")} <span className="text-accent-text">*</span>
              </label>
              <input
                type="text"
                required
                autoFocus
                value={columnName}
                onChange={(e) => setColumnName(e.target.value)}
                placeholder={t("addColumn.colNamePlaceholder")}
                className="w-full px-3 py-2 text-xs bg-canvas border border-line rounded-md text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent font-mono transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg">
                {t("addColumn.dataType")}
              </label>
              <select
                value={dataType}
                onChange={(e) => handleDataTypeChange(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-canvas border border-line rounded-md text-fg focus:outline-none focus:border-accent font-mono transition-colors"
              >
                {ddl.dataTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Length & Default Value */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg">
                {t("addColumn.lengthValues")}
              </label>
              <input
                type="text"
                value={length}
                onChange={(e) => setLength(e.target.value)}
                placeholder={t("addColumn.lengthPlaceholder")}
                className="w-full px-3 py-2 text-xs bg-canvas border border-line rounded-md text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent font-mono transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg">
                {t("addColumn.defaultValue")}
              </label>
              <input
                type="text"
                value={defaultValue}
                onChange={(e) => setDefaultValue(e.target.value)}
                placeholder={t("addColumn.defaultPlaceholder")}
                className="w-full px-3 py-2 text-xs bg-canvas border border-line rounded-md text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent font-mono transition-colors"
              />
            </div>
          </div>

          {/* Charset & Collation (Active for text/string types) */}
          {supportsFeature("collations") && (
          <div className={`grid grid-cols-2 gap-3 p-3 rounded-lg border transition-opacity ${isTextType ? "bg-surface border-line opacity-100" : "bg-canvas border-line opacity-50 pointer-events-none"}`}>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg flex items-center justify-between">
                <span>{t("addColumn.charset")}</span>
                {!isTextType && <span className="text-[11px] text-fg-subtle">{t("addColumn.textOnly")}</span>}
              </label>
              <select
                disabled={!isTextType}
                value={characterSet}
                onChange={(e) => {
                  const val = e.target.value;
                  setCharacterSet(val);
                  if (val === "utf8mb4" && !collation) setCollation("utf8mb4_unicode_ci");
                  else if (val === "utf8mb3" && !collation) setCollation("utf8_general_ci");
                  else if (val === "latin1" && !collation) setCollation("latin1_swedish_ci");
                }}
                className="w-full px-2.5 py-1.5 text-xs bg-canvas border border-line rounded-md text-fg focus:outline-none focus:border-accent font-mono text-[11px] transition-colors"
              >
                {CHARACTER_SETS.map((cs) => (
                  <option key={cs.name} value={cs.name}>
                    {t(`charsets.${cs.key}`, { defaultValue: cs.name })}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg">
                {t("addColumn.collation")}
              </label>
              <select
                disabled={!isTextType}
                value={collation}
                onChange={(e) => setCollation(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-canvas border border-line rounded-md text-fg focus:outline-none focus:border-accent font-mono text-[11px] transition-colors"
              >
                {COMMON_COLLATIONS.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.key ? t(`collations.${c.key}`, { defaultValue: c.name }) : c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          )}

          {/* Flags & Options Checkboxes */}
          <div className="p-3 bg-canvas border border-line rounded-lg grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <label className={`flex items-center space-x-2 text-fg ${isPrimaryKey || isAutoIncrement ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
              <input
                type="checkbox"
                checked={isNullable}
                disabled={isPrimaryKey || isAutoIncrement}
                onChange={(e) => setIsNullable(e.target.checked)}
                className="rounded border-line-strong text-accent-text focus:ring-0 bg-raised"
              />
              <span>{t("addColumn.nullable")}</span>
            </label>

            <label
              className={`flex items-center space-x-2 text-fg ${canAddKey ? "cursor-pointer" : "opacity-40 cursor-not-allowed"}`}
              title={canAddKey ? undefined : ddl.engine === "sqlite" ? t("addColumn.pkSqliteDisabled") : t("addColumn.pkExistsDisabled")}
            >
              <input
                type="checkbox"
                checked={isPrimaryKey}
                disabled={!canAddKey}
                onChange={(e) => handlePrimaryKeyChange(e.target.checked)}
                className="rounded border-line-strong text-warning focus:ring-0 bg-raised"
              />
              <span className="text-warning font-medium">{t("addColumn.primaryKey")}</span>
            </label>

            <label
              className={`flex items-center space-x-2 text-fg ${canAddAutoIncrement ? "cursor-pointer" : "opacity-40 cursor-not-allowed"}`}
              title={canAddAutoIncrement ? undefined : t("addColumn.aiDisabled")}
            >
              <input
                type="checkbox"
                checked={isAutoIncrement}
                disabled={!canAddAutoIncrement}
                onChange={(e) => handleAutoIncrementChange(e.target.checked)}
                className="rounded border-line-strong text-accent-text focus:ring-0 bg-raised"
              />
              <span>{t("addColumn.autoIncrement")}</span>
            </label>

            <label className="flex items-center space-x-2 cursor-pointer text-fg hover:text-fg">
              <input
                type="checkbox"
                checked={isUnique}
                onChange={(e) => setIsUnique(e.target.checked)}
                className="rounded border-line-strong text-accent-text focus:ring-0 bg-raised"
              />
              <span>{t("addColumn.unique")}</span>
            </label>
          </div>

          {/* Position & Comment */}
          <div className="grid grid-cols-3 gap-3">
            {supportsFeature("columnPosition") && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg">
                {t("addColumn.position")}
              </label>
              <select
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-canvas border border-line rounded-md text-fg focus:outline-none focus:border-accent font-mono transition-colors"
              >
                <option value="END">{t("addColumn.posEnd")}</option>
                <option value="FIRST">{t("addColumn.posFirst")}</option>
                {existingColumns.map((col) => (
                  <option key={col.name} value={col.name}>
                    {t("addColumn.posAfter", { col: col.name })}
                  </option>
                ))}
              </select>
            </div>
            )}

            {supportsFeature("comments") && (
            <div className="col-span-2 space-y-1.5">
              <label className="text-xs font-medium text-fg">
                {t("addColumn.comment")}
              </label>
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t("addColumn.commentPlaceholder")}
                className="w-full px-3 py-2 text-xs bg-canvas border border-line rounded-md text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent transition-colors"
              />
            </div>
            )}
          </div>

          {/* Live SQL Preview */}
          <div className="space-y-1.5">
            <div className="flex items-center space-x-1.5 text-xs text-fg-muted font-mono">
              <Code2 className="w-3.5 h-3.5 text-fg-muted" />
              <span>{t("addColumn.generatedSql")}</span>
            </div>
            <pre className="p-3 bg-canvas border border-line rounded text-accent-text font-mono text-[11px] whitespace-pre-wrap select-all">
              {previewSql()}
            </pre>
          </div>

          {/* Error alert */}
          {error && (
            <div className="p-3 rounded-lg border border-line text-danger text-xs flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Modal Footer */}
          <div className="pt-3 flex items-center justify-end space-x-2 border-t border-line">
            <button
              type="button"
              onClick={onClose}
              className={secondaryBtn}
            >
              {t("addColumn.cancel")}
            </button>
            <button
              type="submit"
              disabled={isExecuting || !columnName.trim()}
              className={primaryBtn}
            >
              {isExecuting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{t("addColumn.adding")}</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t("addColumn.submit")}</span>
                </>
              )}
            </button>
          </div>
        </form>
    </Modal>
  );
};
