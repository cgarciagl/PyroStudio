import React, { useEffect, useState } from "react";
import { AlertCircle, Loader2, PenLine } from "lucide-react";
import { dbService } from "../services/tauriDb";
import { Modal } from "./ui/Modal";
import { inputClass, primaryBtn, secondaryBtn } from "./ui/styles";

interface RenameTableModalProps {
  /** Table to rename, or null when the dialog is closed. */
  target: { database: string; table: string } | null;
  onClose: () => void;
  onRenamed: (database: string, oldName: string, newName: string) => void;
}

export const RenameTableModal: React.FC<RenameTableModalProps> = ({ target, onClose, onRenamed }) => {
  const [newName, setNewName] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNewName(target?.table ?? "");
    setError(null);
  }, [target]);

  if (!target) return null;

  const trimmed = newName.trim();
  const canRename = trimmed !== "" && trimmed !== target.table && !isRenaming;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canRename) return;
    setIsRenaming(true);
    setError(null);
    try {
      await dbService.renameTable(target.database, target.table, trimmed);
      onRenamed(target.database, target.table, trimmed);
      onClose();
    } catch (err: unknown) {
      setError(typeof err === "string" ? err : (err as Error)?.message || "No se pudo renombrar la tabla");
    } finally {
      setIsRenaming(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Renombrar tabla"
      subtitle={`${target.database}.${target.table}`}
      icon={<PenLine className="w-4 h-4" />}
      size="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          autoFocus
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          className={`${inputClass} font-mono`}
          aria-label="Nuevo nombre de la tabla"
        />
        {error && (
          <div className="flex items-start gap-2 text-xs text-danger">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryBtn}>
            Cancelar
          </button>
          <button type="submit" disabled={!canRename} className={primaryBtn}>
            {isRenaming && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Renombrar
          </button>
        </div>
      </form>
    </Modal>
  );
};
