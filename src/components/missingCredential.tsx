import { useEffect, useState } from "react";
import { LockOpen } from "lucide-react";
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

export const MISSING_PASSWORD_HINT =
  "Sin contraseña guardada en este equipo. Edite la conexión para registrarla.";

export const MissingPasswordIcon: React.FC<{ className?: string }> = ({ className = "w-3 h-3" }) => (
  <span title={MISSING_PASSWORD_HINT} className="shrink-0 inline-flex">
    <LockOpen className={`${className} text-warning`} />
  </span>
);
