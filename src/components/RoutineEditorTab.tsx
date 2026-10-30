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
  } from "lucide-react";
import { dbService } from "../services/tauriDb";
import type { RoutineDetail, RoutineParam, QueryExecutionResult } from "../types/database";
import { useIsLightTheme } from "../stores/preferenceStore";
import { ConfirmModal } from "./ConfirmModal";
import { primaryBtn } from "./ui/styles";
import { Modal } from "./ui/Modal";

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
  const isLight = useIsLightTheme();
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
          `CREATE PROCEDURE \`${database}\`.\`${name}\`(\n IN p_param1 INT,\n OUT p_resultado VARCHAR(100)\n)\nBEGIN\n -- Escribe aquí la lógica de tu procedimiento almacenado\n SELECT 'Hola desde PyroStudio' INTO p_resultado;\nEND`
        );
        setParams([
          { mode: "IN", name: "p_param1", data_type: "INT" },
          { mode: "OUT", name: "p_resultado", data_type: "VARCHAR(100)" },
        ]);
      } else {
        setCode(
          `CREATE FUNCTION \`${database}\`.\`${name}\`(\n p_param1 INT\n)\nRETURNS VARCHAR(100) CHARSET utf8mb4\nDETERMINISTIC\nBEGIN\n DECLARE v_res VARCHAR(100);\n SET v_res = CONCAT('Valor: ', p_param1);\n RETURN v_res;\nEND`
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

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  const executeDelete = async () => {
    setShowDeleteConfirm(false);
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
    <div className="h-full flex flex-col bg-canvas text-fg overflow-hidden font-sans">
      {/* Top Action Toolbar */}
      <div className="px-4 py-2.5 bg-raised border-b border-line flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-accent-soft border border-accent/30 flex items-center justify-center text-accent-text">
            {currentType === "PROCEDURE" ? (
              <Settings className="w-4 h-4" />
            ) : (
              <FunctionSquare className="w-4 h-4" />
            )}
          </div>

          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-fg font-mono">
                {name}
              </span>
              <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-accent-soft text-accent-text border border-accent/30 font-mono">
                {currentType}
              </span>
              {returnType && (
                <span className="text-[11px] text-fg-muted font-mono">
                  ➔ {returnType}
                </span>
              )}
            </div>
            <div className="flex items-center space-x-2 text-[11px] text-fg-muted">
              <span className="flex items-center space-x-1">
                <Database className="w-3 h-3 text-fg-subtle" />
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
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold hover:bg-hover border border-line text-success rounded transition-all shadow-xs"
          >
            <Play className="w-3.5 h-3.5 fill-emerald-400" />
            <span>Probar / Ejecutar</span>
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className={primaryBtn}
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
              className="p-1.5 rounded hover:bg-hover border border-transparent text-fg-muted hover:text-danger transition-colors"
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
              ? "border-line text-success"
              : "border-line text-danger"
          }`}
        >
          {feedback.success ? (
            <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-danger shrink-0" />
          )}
          <span className="font-mono">{feedback.message}</span>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* SQL Editor Area */}
        <div className="flex-1 flex flex-col border-r border-line overflow-hidden">
          <div className="px-3 py-1.5 bg-surface border-b border-line flex items-center justify-between text-[11px] text-fg-muted">
            <span className="flex items-center space-x-1.5">
              <Code2 className="w-3.5 h-3.5 text-fg-muted" />
              <span>Definición SQL DDL (`CREATE {currentType}`)</span>
            </span>
            <span className="font-mono text-fg-subtle">MariaDB SQL Syntax</span>
          </div>

          <div className="flex-1 overflow-auto bg-canvas">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-full space-y-2 text-fg-subtle text-xs">
                <Loader2 className="w-5 h-5 animate-spin text-fg-muted" />
                <span>Cargando definición de la rutina...</span>
              </div>
            ) : (
              <CodeMirror
                value={code}
                height="100%"
                extensions={[sql()]}
                theme={isLight ? "light" : "dark"}
                onChange={(value) => setCode(value)}
                className="text-xs font-mono h-full"
              />
            )}
          </div>
        </div>

        {/* Parameters & Info Inspector Sidebar */}
        <div className="w-72 bg-canvas flex flex-col overflow-y-auto p-3 space-y-3 text-xs">
          <div>
            <span className="font-semibold text-fg flex items-center space-x-1.5">
              <Layers className="w-3.5 h-3.5 text-fg-muted" />
              <span>Parámetros ({params.length})</span>
            </span>
            <p className="text-[11px] text-fg-subtle mt-0.5">
              Estructura de entrada y salida
            </p>
          </div>

          <div className="space-y-1.5">
            {params.length === 0 ? (
              <div className="text-[11px] text-fg-subtle italic p-2 bg-raised rounded border border-line">
                Sin parámetros definidos
              </div>
            ) : (
              params.map((p, idx) => (
                <div
                  key={idx}
                  className="p-2 bg-raised border border-line rounded text-[11px] space-y-0.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-semibold text-accent-text">
                      {p.name}
                    </span>
                    <span
                      className={`text-[11px] font-bold px-1 rounded ${
                        p.mode === "IN"
                          ? "bg-raised text-fg-muted border border-line"
                          : p.mode === "OUT"
                          ? "text-warning border border-line"
                          : "bg-raised text-fg-muted border border-line"
                      }`}
                    >
                      {p.mode}
                    </span>
                  </div>
                  <div className="text-fg-muted font-mono text-[11px]">
                    {p.data_type}
                  </div>
                </div>
              ))
            )}
          </div>

          {returnType && (
            <div className="pt-2 border-t border-line">
              <span className="text-[11px] font-semibold text-fg">
                Tipo de Retorno (RETURNS):
              </span>
              <div className="mt-1 p-2 bg-raised border border-line rounded text-[11px] font-mono text-success">
                {returnType}
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-line text-[11px] text-fg-muted space-y-1">
            <div className="font-semibold text-fg">💡 Tips de MariaDB:</div>
            <ul className="list-disc list-inside space-y-1 text-fg-muted text-[11px]">
              <li>Los procedimientos se ejecutan con <code className="text-accent-text font-mono">CALL {name}()</code>.</li>
              <li>Las funciones se llaman en expresiones <code className="text-accent-text font-mono">SELECT {name}()</code>.</li>
              <li>PyroStudio soporta túnel HTTP y conexión directa sin restricciones.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Interactive Execution / Test Modal */}
      {isTestModalOpen && (
        <Modal
          isOpen={true}
          onClose={() => setIsTestModalOpen(false)}
          title={<>Ejecutar {currentType === "PROCEDURE" ? "Procedimiento" : "Función"}: <span className="font-mono">{name}</span></>}
          subtitle={<>Ingresa los argumentos de prueba para ejecutar en `{database}`</>}
          icon={<Play className="w-3.5 h-3.5" />}
          size="md"
          className="max-h-[85vh]"
          bodyClassName="flex flex-col overflow-hidden"
          closeOnBackdrop={false}
          closeOnEscape={false}
        >
          <form onSubmit={handleExecuteTest} className="flex-1 flex flex-col overflow-hidden">
              <div className="p-5 overflow-y-auto space-y-4 flex-1">
                {inParams.length === 0 ? (
                  <div className="text-xs text-fg-muted bg-surface p-3 rounded border border-line">
                    Esta rutina no requiere parámetros de entrada. Haz clic en "Ejecutar Ahora" para llamar la rutina directamente.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <label className="text-xs font-semibold text-fg">
                      Valores de los Parámetros de Entrada ({inParams.length}):
                    </label>
                    <div className="space-y-2">
                      {inParams.map((p) => (
                        <div
                          key={p.name}
                          className="grid grid-cols-3 gap-2 items-center bg-surface p-2.5 rounded-lg border border-line"
                        >
                          <div className="space-y-0.5">
                            <span className="text-xs font-mono font-bold text-accent-text">
                              {p.name}
                            </span>
                            <div className="text-[11px] text-fg-subtle font-mono">
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
                              className="w-full px-3 py-1.5 text-xs bg-raised border border-line rounded text-fg font-mono placeholder:text-fg-subtle focus:outline-none focus:border-accent"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Error Result */}
                {execError && (
                  <div className="p-3 border border-line rounded-lg text-xs text-danger flex items-start space-x-2">
                    <AlertCircle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
                    <span className="font-mono">{execError}</span>
                  </div>
                )}

                {/* Execution Success Result */}
                {execResult && (
                  <div className="space-y-2 pt-2 border-t border-line">
                    <div className="flex items-center justify-between text-xs text-success font-semibold">
                      <span className="flex items-center space-x-1">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Ejecución completada exitosamente</span>
                      </span>
                      <span className="text-fg-muted font-mono text-[11px] flex items-center space-x-1">
                        <Clock className="w-3 h-3" />
                        <span>{execResult.execution_time_ms} ms</span>
                      </span>
                    </div>

                    {execResult.rows && execResult.rows.length > 0 ? (
                      <div className="max-h-48 overflow-auto border border-line rounded-lg bg-surface">
                        <table className="w-full text-left text-xs font-mono border-collapse">
                          <thead>
                            <tr className="bg-raised border-b border-line text-fg">
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
                                className="border-b border-line hover:bg-hover"
                              >
                                {row.map((val, cIdx) => (
                                  <td key={cIdx} className="px-3 py-1 text-fg">
                                    {val === null ? (
                                      <span className="text-fg-subtle italic">NULL</span>
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
                      <div className="p-3 bg-surface rounded text-xs text-fg-muted font-mono">
                        {execResult.message || "Rutina ejecutada sin conjunto de resultados devuelto."}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="px-5 py-3 bg-raised border-t border-line flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsTestModalOpen(false)}
                  className="px-3.5 py-1.5 text-xs text-fg-muted hover:text-fg rounded hover:bg-hover"
                >
                  Cerrar
                </button>
                <button
                  type="submit"
                  disabled={isExecuting}
                  className="flex items-center space-x-1.5 px-4 py-1.5 text-xs font-semibold bg-accent hover:bg-accent-hover text-accent-fg rounded transition-all shadow-xs disabled:opacity-50"
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
        </Modal>
      )}

      <ConfirmModal
        isOpen={showDeleteConfirm}
        title={`Eliminar ${currentType === "PROCEDURE" ? "Procedimiento" : "Función"}`}
        message={`¿Estás seguro de eliminar ${
          currentType === "PROCEDURE" ? "el procedimiento" : "la función"
        } '${name}' de la base de datos '${database}'?`}
        details="Esta acción eliminará el código DDL de la rutina permanentemente."
        confirmText="Eliminar Rutina"
        variant="danger"
        onConfirm={executeDelete}
        onClose={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
};
