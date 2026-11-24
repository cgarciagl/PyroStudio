import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Database,
  Loader2,
  AlertCircle,
  Plus,
} from "lucide-react";
import { dbService } from "../services/tauriDb";
import { primaryBtn, secondaryBtn } from "./ui/styles";
import { Modal } from "./ui/Modal";
import { errorText } from "../utils/errors";

interface CreateDatabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDatabaseCreated: (dbName: string) => void;
}

const COMMON_CHARSETS_COLLATIONS: { charset: string; collation: string }[] = [
  { charset: "utf8mb4", collation: "utf8mb4_unicode_ci" },
  { charset: "utf8mb4", collation: "utf8mb4_general_ci" },
  { charset: "utf8mb4", collation: "utf8mb4_spanish_ci" },
  { charset: "utf8mb4", collation: "utf8mb4_spanish2_ci" },
  { charset: "utf8mb4", collation: "utf8mb4_bin" },
  { charset: "utf8mb4", collation: "utf8mb4_0900_ai_ci" },
  { charset: "utf8", collation: "utf8_general_ci" },
  { charset: "latin1", collation: "latin1_swedish_ci" },
];

export const CreateDatabaseModal: React.FC<CreateDatabaseModalProps> = ({
  isOpen,
  onClose,
  onDatabaseCreated,
}) => {
  const { t } = useTranslation("schema");
  const [dbName, setDbName] = useState("");
  const [selectedCollationIdx, setSelectedCollationIdx] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = dbName.trim();

    if (!cleanName) {
      setError(t("createDatabase.nameRequired"));
      return;
    }

    // Identificador válido en MySQL/MariaDB (letras, números, guiones bajos o medios)
    if (!/^[a-zA-Z0-9_\-]+$/.test(cleanName)) {
      setError(t("createDatabase.nameInvalid"));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const { charset, collation } = COMMON_CHARSETS_COLLATIONS[selectedCollationIdx];
    const sql = `CREATE DATABASE \`${cleanName}\` CHARACTER SET ${charset} COLLATE ${collation};`;

    try {
      await dbService.executeConfirmedQuery(sql);
      onDatabaseCreated(cleanName);
      setDbName("");
      onClose();
    } catch (err: unknown) {
      const msg = errorText(err, t("createDatabase.createError"));
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={<>{t("createDatabase.title")}</>}
      subtitle={<>{t("createDatabase.subtitle")}</>}
      icon={<Database className="w-5 h-5" />}
      size="sm"
      bodyClassName="flex flex-col overflow-hidden"
    >
      <form onSubmit={handleCreate} className="p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-lg border border-line text-danger text-xs flex items-start space-x-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <div className="font-mono">{error}</div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-fg">
              {t("createDatabase.nameLabel")} <span className="text-accent-text">*</span>
            </label>
            <input
              type="text"
              autoFocus
              value={dbName}
              onChange={(e) => setDbName(e.target.value)}
              placeholder={t("createDatabase.namePlaceholder")}
              className="w-full px-3 py-2 bg-canvas border border-line rounded-lg text-xs font-mono text-fg placeholder:text-fg-subtle focus:outline-hidden focus:border-accent transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-fg">
              {t("createDatabase.collationLabel")}
            </label>
            <select
              value={selectedCollationIdx}
              onChange={(e) => setSelectedCollationIdx(Number(e.target.value))}
              className="w-full px-3 py-2 bg-canvas border border-line rounded-lg text-xs font-mono text-fg focus:outline-hidden focus:border-accent transition-colors"
            >
              {COMMON_CHARSETS_COLLATIONS.map((item, idx) => (
                <option key={item.collation} value={idx}>
                  {t(`createDatabase.collations.${item.collation}`, { defaultValue: item.collation })}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-fg-subtle block">
              {t("createDatabase.charsetPrefix")}{" "}
              <span className="text-fg-muted font-mono">
                {COMMON_CHARSETS_COLLATIONS[selectedCollationIdx].charset}
              </span>{" "}
              | {t("createDatabase.collatePrefix")}{" "}
              <span className="text-fg-muted font-mono">
                {COMMON_CHARSETS_COLLATIONS[selectedCollationIdx].collation}
              </span>
            </span>
          </div>

          <div className="pt-2 flex items-center justify-end space-x-2 select-none">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className={secondaryBtn}
            >
              {t("createDatabase.cancel")}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !dbName.trim()}
              className={primaryBtn}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{t("createDatabase.creating")}</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t("createDatabase.submit")}</span>
                </>
              )}
            </button>
          </div>
        </form>
    </Modal>
  );
};

