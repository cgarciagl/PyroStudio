import React, { useState, useEffect, useCallback } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import {
  Save,
  Play,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Code2,
  Layers,
  Database,
  Clock,
  Settings,
  FunctionSquare,
  X,
} from "lucide-react";
import { dbService } from "../services/tauriDb";
import type { RoutineDetail, RoutineParam, QueryExecutionResult } from "../types/database";

interface RoutineEditorTabProps {
  database: string;
  routineName: string;
  routineType: "PROCEDURE" | "FUNCTION";
  onRoutineDeleted?: (name: string) => void;
}

export const RoutineEditorTab: React.FC<RoutineEditorTabProps> = ({
  database,
  routineName,
  routineType,
  onRoutineDeleted,
}) => {
  const isNew = !routineName || routineName === "nuevo_procedimiento" || routineName === "nueva_funcion";
  const [name, setName] = useState(isNew ? (routineType === "PROCEDURE" ? "sp_nuevo_procedimiento" : "fn_nueva_funcion") : routineName);
  const [originalName, setOriginalName] = useState(isNew ? null : routineName);
  const currentType = routineType;
  const [code, setCode] = useState("");
  const [params, setParams] = useState<RoutineParam[]>([]);
  const [returnType, setReturnType] = useState<string | undefined>(undefined);

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);

  // Test / Execution Modal State
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [testParamValues, setTestParamValues] = useState<Record<string, string>>({});
  const [isExecuting, setIsExecuting] = useState(false);
  const [execResult, setExecResult] = useState<QueryExecutionResult | null>(null);
  const [execError, setExecError] = useState<string | null>(null);

  const loadRoutine = useCallback(async () => {
    if (isNew) {
      // Default template
      if (currentType === "PROCEDURE") {
        setCode(
          `CREATE PROCEDURE \`${database}\`.\`${name}\`(\n  IN p_param1 INT,\n  OUT p_resultado VARCHAR(100)\n)\nBEGIN\n  -- Escribe aquí la lógica de tu procedimiento almacenado\n  SELECT 'Hola desde PyroStudio' INTO p_resultado;\nEND`
        );
        setParams([
          { mode: "IN", name: "p_param1", data_type: "INT" },
          { mode: "OUT", name: "p_resultado", data_type: "VARCHAR(100)" },
        ]);
      } else {
        setCode(
          `CREATE FUNCTION \`${database}\`.\`${name}\`(\n  p_param1 INT\n)\nRETURNS VARCHAR(100) CHARSET utf8mb4\nDETERMINISTIC\nBEGIN\n  DECLARE v_res VARCHAR(100);\n  SET v_res = CONCAT('Valor: ', p_param1);\n  RETURN v_res;\nEND`
        );
        setParams([{ mode: "IN", name: "p_param1", data_type: "INT" }]);
        setReturnType("VARCHAR(100)");
      }
      return;
    }

    setIsLoading(true);
    setFeedback(null);
    try {
      const detail: RoutineDetail = await dbService.getRoutineDefinition(
        database,
        routineName,
        currentType
      );
      setCode(detail.ddl || "");
      setParams(detail.params || []);
      setReturnType(detail.return_type);
      setName(detail.name);
      setOriginalName(detail.name);
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : (err as Error)?.message || "Error al cargar rutina";
      setFeedback({ success: false, message: msg });
    } finally {
      setIsLoading(false);
    }
  }, [database, routineName, currentType, isNew, name]);

  useEffect(() => {
    loadRoutine();
  }, [loadRoutine]);

  const handleSave = async () => {
    if (!code.trim()) {
      setFeedback({ success: false, message: "El código SQL no puede estar vacío." });
      return;
    }

    setIsSaving(true);
    setFeedback(null);
    try {
      await dbService.saveRoutine(database, originalName, currentType, code);
      setOriginalName(name);
      setFeedback({
        success: true,
        message: `¡${currentType === "PROCEDURE" ? "Procedimiento" : "Función"} guardado(a) correctamente en ${database}!`,
      });
      setTimeout(() => setFeedback(null), 4000);
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : (err as Error)?.message || "Error al guardar rutina";
      setFeedback({ success: false, message: msg });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`¿Estás seguro de eliminar ${currentType === "PROCEDURE" ? "el procedimiento" : "la función"} '${name}' de la base de datos '${database}'?`)) {
      return;
    }
    try {
      await dbService.dropRoutine(database, name, currentType);
      if (onRoutineDeleted) {
        onRoutineDeleted(name);
      }
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : (err as Error)?.message || "Error al eliminar rutina";
      setFeedback({ success: false, message: msg });
    }
  };

  const handleOpenTestModal = () => {
    const initialVals: Record<string, string> = {};
    params
      .filter((p) => p.mode === "IN" || p.mode === "INOUT")
      .forEach((p) => {
        initialVals[p.name] = "";
      });
    setTestParamValues(initialVals);
    setExecResult(null);
    setExecError(null);
    setIsTestModalOpen(true);
  };

  const handleExecuteTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsExecuting(true);
    setExecResult(null);
    setExecError(null);

    const inParams = params.filter((p) => p.mode === "IN" || p.mode === "INOUT");
    const argsArray = inParams.map((p) => {
      const rawVal = testParamValues[p.name];
      if (rawVal === undefined || rawVal === "") return null;
      if (p.data_type.toUpperCase().includes("INT") || p.data_type.toUpperCase().includes("DECIMAL") || p.data_type.toUpperCase().includes("FLOAT")) {
        const n = Number(rawVal);
        return isNaN(n) ? rawVal : n;
      }
      return rawVal;
    });

    try {
      const result = await dbService.executeRoutine(
        database,
        name,
        currentType,
        argsArray
      );
      setExecResult(result);
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : (err as Error)?.message || "Error en la ejecución";
      setExecError(msg);
    } finally {
      setIsExecuting(false);
    }
  };

  const inParams = params.filter((p) => p.mode === "IN" || p.mode === "INOUT");

  return (
    <div className="h-full flex flex-col bg-[#0b0d13] text-neutral-200 overflow-hidden font-sans">
      {/* Top Action Toolbar */}
      <div className="px-4 py-2.5 bg-[#121520] border-b border-[#1f2538] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-orange-500/10 border border-orange-500/30 flex items-center justify-center text-orange-400">
            {currentType === "PROCEDURE" ? (
              <Settings className="w-4 h-4" />
            ) : (
              <FunctionSquare className="w-4 h-4" />
            )}
          </div>

          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-white font-mono">
                {name}
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30 uppercase font-mono">
                {currentType}
              </span>
              {returnType && (
                <span className="text-[10px] text-neutral-400 font-mono">
                  ➔ {returnType}
                </span>
              )}
            </div>
            <div className="flex items-center space-x-2 text-[11px] text-neutral-400">
              <span className="flex items-center space-x-1">
                <Database className="w-3 h-3 text-neutral-500" />
                <span>{database}</span>
              </span>
              <span>•</span>
              <span>{params.length} parámetro(s)</span>
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={handleOpenTestModal}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 rounded transition-all shadow-xs"
          >
            <Play className="w-3.5 h-3.5 fill-emerald-400" />
            <span>Probar / Ejecutar</span>
          </button>

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
            <span>Guardar en DB</span>
          </button>

          {!isNew && (
            <button
              type="button"
              onClick={handleDelete}
              title="Eliminar rutina de la base de datos"
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
              <Code2 className="w-3.5 h-3.5 text-orange-400" />
              <span>Definición SQL DDL (`CREATE {currentType}`)</span>
            </span>
            <span className="font-mono text-neutral-500">MariaDB SQL Syntax</span>
          </div>

          <div className="flex-1 overflow-auto bg-[#090a0f]">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-full space-y-2 text-neutral-500 text-xs">
                <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
                <span>Cargando definición de la rutina...</span>
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

        {/* Parameters & Info Inspector Sidebar */}
        <div className="w-72 bg-[#0c0e14] flex flex-col overflow-y-auto p-3 space-y-3 text-xs">
          <div>
            <span className="font-semibold text-neutral-300 flex items-center space-x-1.5">
              <Layers className="w-3.5 h-3.5 text-orange-400" />
              <span>Parámetros ({params.length})</span>
            </span>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Estructura de entrada y salida
            </p>
          </div>

          <div className="space-y-1.5">
            {params.length === 0 ? (
              <div className="text-[11px] text-neutral-500 italic p-2 bg-[#121520] rounded border border-[#1b202e]">
                Sin parámetros definidos
              </div>
            ) : (
              params.map((p, idx) => (
                <div
                  key={idx}
                  className="p-2 bg-[#121520] border border-[#1c2232] rounded text-[11px] space-y-0.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-semibold text-orange-300">
                      {p.name}
                    </span>
                    <span
                      className={`text-[9px] font-bold px-1 rounded uppercase ${
                        p.mode === "IN"
                          ? "bg-sky-950 text-sky-400 border border-sky-800/40"
                          : p.mode === "OUT"
                          ? "bg-amber-950 text-amber-400 border border-amber-800/40"
                          : "bg-purple-950 text-purple-400 border border-purple-800/40"
                      }`}
                    >
                      {p.mode}
                    </span>
                  </div>
                  <div className="text-neutral-400 font-mono text-[10px]">
                    {p.data_type}
                  </div>
                </div>
              ))
            )}
          </div>

          {returnType && (
            <div className="pt-2 border-t border-[#1a1f2e]">
              <span className="text-[11px] font-semibold text-neutral-300">
                Tipo de Retorno (RETURNS):
              </span>
              <div className="mt-1 p-2 bg-[#121520] border border-[#1c2232] rounded text-[11px] font-mono text-emerald-400">
                {returnType}
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-[#1a1f2e] text-[11px] text-neutral-400 space-y-1">
            <div className="font-semibold text-neutral-300">💡 Tips de MariaDB:</div>
            <ul className="list-disc list-inside space-y-1 text-neutral-400 text-[10px]">
              <li>Los procedimientos se ejecutan con <code className="text-orange-400 font-mono">CALL {name}()</code>.</li>
              <li>Las funciones se llaman en expresiones <code className="text-orange-400 font-mono">SELECT {name}()</code>.</li>
              <li>PyroStudio soporta túnel HTTP y conexión directa sin restricciones.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Interactive Execution / Test Modal */}
      {isTestModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-2xl max-h-[85vh] bg-[#10131a] border border-[#242b3d] rounded-xl shadow-2xl flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 bg-[#141824] border-b border-[#202738] flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-7 h-7 rounded bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <Play className="w-3.5 h-3.5 fill-emerald-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Ejecutar {currentType === "PROCEDURE" ? "Procedimiento" : "Función"}: <span className="font-mono text-emerald-300">{name}</span>
                  </h3>
                  <p className="text-xs text-neutral-400">
                    Ingresa los argumentos de prueba para ejecutar en `{database}`
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsTestModalOpen(false)}
                className="text-neutral-400 hover:text-white p-1 rounded hover:bg-neutral-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleExecuteTest} className="flex-1 flex flex-col overflow-hidden">
              <div className="p-5 overflow-y-auto space-y-4 flex-1">
                {inParams.length === 0 ? (
                  <div className="text-xs text-neutral-400 bg-[#0d0f15] p-3 rounded border border-[#1e2333]">
                    Esta rutina no requiere parámetros de entrada. Haz clic en "Ejecutar Ahora" para llamar la rutina directamente.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <label className="text-xs font-semibold text-neutral-300">
                      Valores de los Parámetros de Entrada ({inParams.length}):
                    </label>
                    <div className="space-y-2">
                      {inParams.map((p) => (
                        <div
                          key={p.name}
                          className="grid grid-cols-3 gap-2 items-center bg-[#0d0f15] p-2.5 rounded-lg border border-[#1e2333]"
                        >
                          <div className="space-y-0.5">
                            <span className="text-xs font-mono font-bold text-orange-400">
                              {p.name}
                            </span>
                            <div className="text-[10px] text-neutral-500 font-mono">
                              {p.data_type} ({p.mode})
                            </div>
                          </div>
                          <div className="col-span-2">
                            <input
                              type="text"
                              value={testParamValues[p.name] ?? ""}
                              onChange={(e) =>
                                setTestParamValues((prev) => ({
                                  ...prev,
                                  [p.name]: e.target.value,
                                }))
                              }
                              placeholder={`Ingresa valor para ${p.name}`}
                              className="w-full px-3 py-1.5 text-xs bg-[#131622] border border-[#242c3e] rounded text-white font-mono placeholder-neutral-500 focus:outline-none focus:border-orange-500"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Error Result */}
                {execError && (
                  <div className="p-3 bg-red-950/40 border border-red-800/50 rounded-lg text-xs text-red-300 flex items-start space-x-2">
                    <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                    <span className="font-mono">{execError}</span>
                  </div>
                )}

                {/* Execution Success Result */}
                {execResult && (
                  <div className="space-y-2 pt-2 border-t border-[#1e2333]">
                    <div className="flex items-center justify-between text-xs text-emerald-400 font-semibold">
                      <span className="flex items-center space-x-1">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Ejecución completada exitosamente</span>
                      </span>
                      <span className="text-neutral-400 font-mono text-[11px] flex items-center space-x-1">
                        <Clock className="w-3 h-3" />
                        <span>{execResult.execution_time_ms} ms</span>
                      </span>
                    </div>

                    {execResult.rows && execResult.rows.length > 0 ? (
                      <div className="max-h-48 overflow-auto border border-[#262e42] rounded-lg bg-[#0d0f15]">
                        <table className="w-full text-left text-xs font-mono border-collapse">
                          <thead>
                            <tr className="bg-[#151926] border-b border-[#262e42] text-neutral-300">
                              {execResult.columns.map((col, i) => (
                                <th key={i} className="px-3 py-1.5 font-semibold">
                                  {col}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {execResult.rows.map((row, rIdx) => (
                              <tr
                                key={rIdx}
                                className="border-b border-[#1c2232] hover:bg-[#151926]"
                              >
                                {row.map((val, cIdx) => (
                                  <td key={cIdx} className="px-3 py-1 text-white">
                                    {val === null ? (
                                      <span className="text-neutral-500 italic">NULL</span>
                                    ) : typeof val === "object" ? (
                                      JSON.stringify(val)
                                    ) : (
                                      String(val)
                                    )}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="p-3 bg-[#0e111a] rounded text-xs text-neutral-400 font-mono">
                        {execResult.message || "Rutina ejecutada sin conjunto de resultados devuelto."}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="px-5 py-3 bg-[#131622] border-t border-[#1e2436] flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsTestModalOpen(false)}
                  className="px-3.5 py-1.5 text-xs text-neutral-400 hover:text-white rounded hover:bg-neutral-800"
                >
                  Cerrar
                </button>
                <button
                  type="submit"
                  disabled={isExecuting}
                  className="flex items-center space-x-1.5 px-4 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-all shadow-xs disabled:opacity-50"
                >
                  {isExecuting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-white" />
                  )}
                  <span>Ejecutar Ahora</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
