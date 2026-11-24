import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LockOpen } from "lucide-react";
import i18n from "../i18n";
import type { SavedConnection } from "../types/database";
import { connectionStorage } from "../services/connectionStorage";

/** Ids of the connections that have no password stored in this computer's vault. */
export function useMissingCredentials(connections: SavedConnection[]): Set<string> {
  const [missing, setMissing] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      connections.map(async (c) => ((await connectionStorage.hasMissingCredential(c)) ? c.id : null)),
    ).then((ids) => {
      if (!cancelled) setMissing(new Set(ids.filter((id): id is string => id !== null)));
    });
    return () => {
      cancelled = true;
    };
  }, [connections]);

  return missing;
}

export const getMissingPasswordHint = () => i18n.t("connection:messages.missingPasswordHint");

export const MissingPasswordIcon: React.FC<{ className?: string }> = ({ className = "w-3 h-3" }) => {
  const { t } = useTranslation("connection");
  return (
    <span title={t("messages.missingPasswordHint")} className="shrink-0 inline-flex">
      <LockOpen className={`${className} text-warning`} />
    </span>
  );
};
