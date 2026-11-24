import { useTranslation } from "react-i18next";
import {
  Database,
  FolderOpen,
  FilePlus2,
} from "lucide-react";
import { ghostBtn } from "../ui/styles";
import { monoInput, sectionTitle } from "./formConstants";
import type { ConnectionForm } from "./useConnectionForm";

/** Archivo SQLite local o en el servidor. */
export function SqliteFileSection({ filePath, setFilePath, isSqlite, transport, pickSqliteFile }: Pick<ConnectionForm, "filePath" | "setFilePath" | "isSqlite" | "transport" | "pickSqliteFile">) {
  const { t } = useTranslation("connection");

  return (
    <>
    {isSqlite && (
      <section className="space-y-2">
        <div className={sectionTitle}>
          {transport === "http" ? t("sqlite.titleHttp") : t("sqlite.titleLocal")}
        </div>
        <div className="flex items-center gap-2">
          <Database className="w-3.5 h-3.5 text-fg-muted shrink-0" />
          <input
            type="text"
            required
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            placeholder={
              transport === "http" ? "/var/data/app.sqlite3" : t("sqlite.placeholderLocal")
            }
            className={monoInput}
          />
          {transport !== "http" && (
            <>
              <button type="button" onClick={() => pickSqliteFile(false)} className={ghostBtn}>
                <FolderOpen className="w-3 h-3" />
                {t("sqlite.open")}
              </button>
              <button type="button" onClick={() => pickSqliteFile(true)} className={ghostBtn}>
                <FilePlus2 className="w-3 h-3" />
                {t("sqlite.new")}
              </button>
            </>
          )}
        </div>
      </section>
    )}
    </>
  );
}
