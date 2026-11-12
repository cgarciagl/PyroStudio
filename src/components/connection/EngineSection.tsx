import { ENGINE_OPTIONS, sectionTitle } from "./formConstants";
import type { ConnectionForm } from "./useConnectionForm";

/** Motor de base de datos (MariaDB/MySQL o SQLite). */
export function EngineSection({ engine, selectEngine }: Pick<ConnectionForm, "engine" | "selectEngine">) {
  return (
    <>
    <section className="space-y-2.5">
      <div className={sectionTitle}>Motor</div>
      <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-canvas border border-line">
        {ENGINE_OPTIONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => selectEngine(id)}
            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs transition-colors ${
              engine === id
                ? "bg-surface text-fg font-medium shadow-sm border border-line"
                : "text-fg-muted hover:text-fg border border-transparent"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>
    </section>
    </>
  );
}
