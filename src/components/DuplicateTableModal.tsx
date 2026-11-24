import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, CopyPlus, Loader2 } from "lucide-react";
import { dbService } from "../services/tauriDb";
import { Modal } from "./ui/Modal";
import { fieldLabel, inputClass, primaryBtn, secondaryBtn } from "./ui/styles";
import { errorText } from "../utils/errors";

interface DuplicateTableModalProps {
  /** Table to copy, or null when the dialog is closed. */
  target: { database: string; table: string } | null;
  /** Names already used in the database, to propose a free one. */
  existingNames?: string[];
  onClose: () => void;
  onDuplicated: (database: string, newName: string) => void;
}

/** First `<table>_copia`, `<table>_copia2`… not taken yet. */
export function suggestCopyName(table: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  let name = `${table}_copia`;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${table}_copia${n}`;
  return name;
}

export const DuplicateTableModal: React.FC<DuplicateTableModalProps> = ({ target, existingNames = [], onClose, onDuplicated }) => {
  const { t } = useTranslation("schema");
  const [newName, setNewName] = useState("");
  const [withData, setWithData] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNewName(target ? suggestCopyName(target.table, existingNames) : "");
    setError(null);
    // Only when a new table is targeted; the names list changes after the copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  if (!target) return null;

  const trimmed = newName.trim();
  const taken = existingNames.some((n) => n.toLowerCase() === trimmed.toLowerCase());
  const canRun = trimmed !== "" && !taken && !isRunning;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canRun) return;
    setIsRunning(true);
    setError(null);
    try {
      await dbService.duplicateTable(target.database, target.table, trimmed, withData);
      onDuplicated(target.database, trimmed);
      onClose();
    } catch (err: unknown) {
      setError(errorText(err, t("duplicateTable.error")));
    } finally {
      setIsRunning(false);
    }
  };

  const option = (value: boolean, title: string, hint: string) => (
    <label className="flex items-start gap-2 cursor-pointer">
      <input type="radio" name="duplicate-mode" checked={withData === value} onChange={() => setWithData(value)} className="mt-0.5 accent-[var(--color-accent)]" />
      <span>
        <span className="block text-xs text-fg">{title}</span>
        <span className="block text-[11px] text-fg-muted">{hint}</span>
      </span>
    </label>
  );

  return (
    <Modal
      isOpen
      onClose={isRunning ? () => {} : onClose}
      title={t("duplicateTable.title")}
      subtitle={`${target.database}.${target.table}`}
      icon={<CopyPlus className="w-4 h-4" />}
      size="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <label className={fieldLabel} htmlFor="duplicate-table-name">
            {t("duplicateTable.nameLabel")}
          </label>
          <input
            id="duplicate-table-name"
            autoFocus
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            className={`${inputClass} font-mono`}
          />
          {taken && <p className="text-[11px] text-danger">{t("duplicateTable.nameTaken")}</p>}
        </div>
        <div className="space-y-2">
          {option(true, t("duplicateTable.withDataTitle"), t("duplicateTable.withDataHint"))}
          {option(false, t("duplicateTable.structureOnlyTitle"), t("duplicateTable.structureOnlyHint"))}
        </div>
        {error && (
          <div className="flex items-start gap-2 text-xs text-danger">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={isRunning} className={secondaryBtn}>
            {t("duplicateTable.cancel")}
          </button>
          <button type="submit" disabled={!canRun} className={primaryBtn}>
            {isRunning && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {t("duplicateTable.submit")}
          </button>
        </div>
      </form>
    </Modal>
  );
};
