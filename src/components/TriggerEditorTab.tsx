import React, { useState, useEffect, useCallback } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import {
  Save,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Code2,
  Zap,
  Table as TableIcon,
  Database,
  Layers,
} from "lucide-react";
import { dbService } from "../services/tauriDb";
import type { TriggerDetail } from "../types/database";

interface TriggerEditorTabProps {
  database: string;
  triggerName: string;
  onTriggerDeleted?: (name: string) => void;
}

export const TriggerEditorTab: React.FC<TriggerEditorTabProps> = ({
  database,
  triggerName,
  onTriggerDeleted,
}) => {
  const isNew = !triggerName || triggerName === "nuevo_trigger";
  const [name, setName] = useState(isNew ? "trg_nuevo_trigger" : triggerName);
  const [originalName, setOriginalName] = useState(isNew ? null : triggerName);
  const [tableName, setTableName] = useState("tabla_objetivo");
  const [timing, setTiming] = useState("BEFORE");
  const [event, setEvent] = useState("INSERT");
  const [code, setCode] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);

  const loadTrigger = useCallback(async () => {
    if (isNew) {
      setCode(
        `CREATE TRIGGER \`${database}\`.\`${name}\`\n${timing} ${event} ON \`${database}\`.\`${tableName}\`\nFOR EACH ROW\nBEGIN\n  -- Ejemplo de lógica con triggers\n  -- IF NEW.fecha_creacion IS NULL THEN\n  --   SET NEW.fecha_creacion = NOW();\n  -- END IF;\nEND`
      );
      return;
    }

    setIsLoading(true);
    setFeedback(null);
    try {
      const detail: TriggerDetail = await dbService.getTriggerDefinition(
        database,
        triggerName
      );
      setCode(detail.ddl || "");
      setTableName(detail.table_name || "");
      setTiming(detail.timing || "BEFORE");
      setEvent(detail.event || "INSERT");
      setName(detail.name);
      setOriginalName(detail.name);
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : (err as Error)?.message || "Error al cargar trigger";
      setFeedback({ success: false, message: msg });
    } finally {
      setIsLoading(false);
    }
  }, [database, triggerName, isNew, name, timing, event, tableName]);

  useEffect(() => {
    loadTrigger();
  }, [loadTrigger]);

  const handleSave = async () => {
    if (!code.trim()) {
      setFeedback({ success: false, message: "El código SQL no puede estar vacío." });
      return;
    }

    setIsSaving(true);
    setFeedback(null);
    try {
      await dbService.saveTrigger(database, originalName, code);
      setOriginalName(name);
      setFeedback({
        success: true,
        message: `¡Trigger guardado correctamente en ${database}!`,
      });
      setTimeout(() => setFeedback(null), 4000);
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : (err as Error)?.message || "Error al guardar trigger";
      setFeedback({ success: false, message: msg });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`¿Estás seguro de eliminar el trigger '${name}' de la base de datos '${database}'?`)) {
      return;
    }
    try {
      await dbService.dropTrigger(database, name);
      if (onTriggerDeleted) {
        onTriggerDeleted(name);
      }
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : (err as Error)?.message || "Error al eliminar trigger";
      setFeedback({ success: false, message: msg });
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#0b0d13] text-neutral-200 overflow-hidden font-sans">
      {/* Top Action Toolbar */}
      <div className="px-4 py-2.5 bg-[#121520] border-b border-[#1f2538] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Zap className="w-4 h-4" />
          </div>

          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-white font-mono">
                {name}
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 uppercase font-mono">
                {timing} {event}
              </span>
            </div>
            <div className="flex items-center space-x-2 text-[11px] text-neutral-400">
              <span className="flex items-center space-x-1">
                <Database className="w-3 h-3 text-neutral-500" />
                <span>{database}</span>
              </span>
              <span>•</span>
              <span className="flex items-center space-x-1">
                <TableIcon className="w-3 h-3 text-neutral-500" />
                <span>Tabla: <span className="font-mono text-neutral-300">{tableName}</span></span>
              </span>
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 text-xs font-semibold bg-orange-600 hover:bg-orange-500 text-white rounded transition-all shadow-xs disabled:opacity-50"
          >
            {isSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>Guardar Trigger en DB</span>
          </button>

          {!isNew && (
            <button
              type="button"
              onClick={handleDelete}
              title="Eliminar trigger de la base de datos"
              className="p-1.5 rounded hover:bg-red-950/50 border border-transparent hover:border-red-800/50 text-neutral-400 hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Feedback Alert Bar */}
      {feedback && (
        <div
          className={`px-4 py-2 border-b text-xs flex items-center space-x-2 ${
            feedback.success
              ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300"
              : "bg-red-950/40 border-red-800/50 text-red-300"
          }`}
        >
          {feedback.success ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          )}
          <span className="font-mono">{feedback.message}</span>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* SQL Editor Area */}
        <div className="flex-1 flex flex-col border-r border-[#1e2436] overflow-hidden">
          <div className="px-3 py-1.5 bg-[#0e1017] border-b border-[#181d2a] flex items-center justify-between text-[11px] text-neutral-400">
            <span className="flex items-center space-x-1.5">
              <Code2 className="w-3.5 h-3.5 text-amber-400" />
              <span>Definición SQL DDL (`CREATE TRIGGER`)</span>
            </span>
            <span className="font-mono text-neutral-500">MariaDB Trigger Syntax</span>
          </div>

          <div className="flex-1 overflow-auto bg-[#090a0f]">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-full space-y-2 text-neutral-500 text-xs">
                <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
                <span>Cargando definición del trigger...</span>
              </div>
            ) : (
              <CodeMirror
                value={code}
                height="100%"
                extensions={[sql()]}
                theme="dark"
                onChange={(value) => setCode(value)}
                className="text-xs font-mono h-full"
              />
            )}
          </div>
        </div>

        {/* Trigger Info & Inspector Sidebar */}
        <div className="w-72 bg-[#0c0e14] flex flex-col overflow-y-auto p-3 space-y-3 text-xs">
          <div>
            <span className="font-semibold text-neutral-300 flex items-center space-x-1.5">
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              <span>Detalles del Trigger</span>
            </span>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Configuración y eventos asociados
            </p>
          </div>

          <div className="space-y-2">
            <div className="p-2.5 bg-[#121520] border border-[#1c2232] rounded space-y-1 text-[11px]">
              <div className="text-neutral-400">Tabla Asociada:</div>
              <div className="font-mono font-semibold text-white">`{tableName}`</div>
            </div>

            <div className="p-2.5 bg-[#121520] border border-[#1c2232] rounded space-y-1 text-[11px]">
              <div className="text-neutral-400">Momento de Disparo (Timing):</div>
              <div className="font-mono font-semibold text-amber-400">{timing}</div>
            </div>

            <div className="p-2.5 bg-[#121520] border border-[#1c2232] rounded space-y-1 text-[11px]">
              <div className="text-neutral-400">Evento de Activación:</div>
              <div className="font-mono font-semibold text-sky-400">{event}</div>
            </div>
          </div>

          <div className="pt-2 border-t border-[#1a1f2e] text-[11px] text-neutral-400 space-y-1">
            <div className="font-semibold text-neutral-300">💡 Variables Especiales:</div>
            <ul className="list-disc list-inside space-y-1 text-neutral-400 text-[10px]">
              <li><code className="text-amber-400 font-mono">NEW.columna</code>: nuevo valor en INSERT/UPDATE.</li>
              <li><code className="text-amber-400 font-mono">OLD.columna</code>: valor anterior en UPDATE/DELETE.</li>
              <li>Soporta compatibilidad con túneles HTTP y conexiones remotas directas.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
