import React, { useEffect, useState } from "react";
import { FlaskConical, RefreshCw } from "lucide-react";
import { dbService } from "../services/tauriDb";
import { useConnectionStore } from "../stores/connectionStore";
import { useUIStore } from "../stores/uiStore";
import type { ColumnPlan, TestDataGenerator, TestDataPlan } from "../types/database";
import { Modal, Spinner } from "./ui/Modal";
import { fieldLabel, ghostBtn, inputClass, mutedText, primaryBtn, secondaryBtn, selectClass } from "./ui/styles";

interface TestDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: string;
  table: string;
  /** Called after rows were inserted, to reload the grid. */
  onGenerated?: () => void;
}

type Kind = TestDataGenerator["kind"];

const KIND_LABELS: Record<Kind, string> = {
  skip: "Valor por defecto",
  null: "NULL",
  sequence: "Secuencia",
  integer: "Entero",
  decimal: "Decimal",
  boolean: "Booleano",
  text: "Texto",
  first_name: "Nombre",
  last_name: "Apellido",
  full_name: "Nombre completo",
  email: "Email",
  phone: "Teléfono",
  city: "Ciudad",
  country: "País",
  company: "Empresa",
  url: "URL",
  uuid: "UUID",
  date: "Fecha",
  date_time: "Fecha y hora",
  time: "Hora",
  year: "Año",
  json: "JSON",
  one_of: "Uno de la lista",
  foreign_key: "Clave foránea",
};

/** Generator for `kind`, reusing the suggested parameters when the kind matches. */
function generatorFor(kind: Kind, suggested: TestDataGenerator): TestDataGenerator {
  if (suggested.kind === kind) return suggested;
  switch (kind) {
    case "sequence":
      return { kind, start: 1 };
    case "integer":
      return { kind, min: 1, max: 1000 };
    case "decimal":
      return { kind, min: 0, max: 1000, scale: 2 };
    case "text":
      return { kind, max_len: 50 };
    case "one_of":
      return { kind, values: [] };
    case "foreign_key":
      return suggested;
    default:
      return { kind } as TestDataGenerator;
  }
}

const formatValue = (v: unknown) => (v === null || v === undefined ? "NULL" : String(v));

export const TestDataModal: React.FC<TestDataModalProps> = ({ isOpen, onClose, database, table, onGenerated }) => {
  const config = useConnectionStore((s) => s.connectionStatus.config);
  const blockedReason =
    config?.environment === "production"
      ? "Bloqueado en conexiones de producción."
      : config?.read_only
        ? "Bloqueado: la conexión es de solo lectura."
        : null;

  const [plan, setPlan] = useState<TestDataPlan | null>(null);
  const [columns, setColumns] = useState<ColumnPlan[]>([]);
  const [rows, setRows] = useState(100);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPlan = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const next = await dbService.planTestData(database, table);
      setPlan(next);
      setColumns(next.columns);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && !blockedReason) void loadPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, database, table]);

  const setKind = (index: number, kind: Kind) => {
    const suggested = plan?.columns[index].generator ?? { kind: "skip" };
    setColumns((cols) => cols.map((c, i) => (i === index ? { ...c, generator: generatorFor(kind, suggested) } : c)));
  };

  const setParam = (index: number, patch: Partial<Record<string, unknown>>) =>
    setColumns((cols) =>
      cols.map((c, i) => (i === index ? { ...c, generator: { ...c.generator, ...patch } as TestDataGenerator } : c)),
    );

  const generate = async () => {
    setIsGenerating(true);
    try {
      const summary = await dbService.generateTestData({ database, table, rows, columns });
      onGenerated?.();
      onClose();
      useUIStore.getState().showAlert({
        title: "Datos de prueba generados",
        message: `Se insertaron ${summary.inserted} filas en ${table} en ${(summary.elapsed_ms / 1000).toFixed(1)} s.`,
        variant: "info",
        icon: "info",
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Generar datos de prueba"
      subtitle={`${database}.${table}`}
      icon={<FlaskConical className="w-4 h-4 text-fg-muted" />}
      size="lg"
      footer={
        <>
          <button className={secondaryBtn} onClick={onClose}>
            Cancelar
          </button>
          <button
            className={primaryBtn}
            disabled={!!blockedReason || !plan || isGenerating || rows < 1 || rows > 100000}
            onClick={generate}
          >
            {isGenerating && <Spinner className="w-3.5 h-3.5" />}
            Insertar {rows} filas
          </button>
        </>
      }
    >
      {blockedReason ? (
        <p className="text-xs text-warning">{blockedReason}</p>
      ) : isLoading && !plan ? (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Spinner /> Analizando columnas…
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="w-36">
              <label className={fieldLabel}>Filas a insertar</label>
              <input
                type="number"
                min={1}
                max={100000}
                className={inputClass}
                value={rows}
                onChange={(e) => setRows(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
            <p className={`${mutedText} flex-1`}>
              Las claves foráneas toman valores existentes de la tabla referenciada. Se inserta por lotes en
              transacciones; todo pasa por el log de auditoría.
            </p>
            <button className={ghostBtn} onClick={loadPlan} disabled={isLoading}>
              <RefreshCw className="w-3.5 h-3.5" /> Restablecer
            </button>
          </div>

          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-fg-muted border-b border-line">
                <th className="py-1.5 pr-3 font-medium">Columna</th>
                <th className="py-1.5 pr-3 font-medium">Tipo</th>
                <th className="py-1.5 pr-3 font-medium">Generador</th>
                <th className="py-1.5 font-medium">Parámetros</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((c, i) => {
                const g = c.generator;
                return (
                  <tr key={c.column} className="border-b border-line">
                    <td className="py-1.5 pr-3 font-mono text-fg">{c.column}</td>
                    <td className="py-1.5 pr-3 font-mono text-fg-subtle">{c.column_type}</td>
                    <td className="py-1.5 pr-3 w-44">
                      <select
                        className={selectClass}
                        value={g.kind}
                        onChange={(e) => setKind(i, e.target.value as Kind)}
                      >
                        {(Object.keys(KIND_LABELS) as Kind[])
                          .filter((k) => k !== "foreign_key" || plan?.columns[i].generator.kind === "foreign_key")
                          .map((k) => (
                            <option key={k} value={k}>
                              {KIND_LABELS[k]}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="py-1.5">
                      {g.kind === "integer" || g.kind === "decimal" ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            className={`${inputClass} w-24`}
                            value={g.min}
                            onChange={(e) => setParam(i, { min: Number(e.target.value) })}
                          />
                          <span className="text-fg-subtle">a</span>
                          <input
                            type="number"
                            className={`${inputClass} w-24`}
                            value={g.max}
                            onChange={(e) => setParam(i, { max: Number(e.target.value) })}
                          />
                        </div>
                      ) : g.kind === "sequence" ? (
                        <input
                          type="number"
                          className={`${inputClass} w-24`}
                          value={g.start}
                          onChange={(e) => setParam(i, { start: Number(e.target.value) })}
                        />
                      ) : g.kind === "text" ? (
                        <span className="text-fg-muted">hasta {g.max_len} caracteres</span>
                      ) : g.kind === "one_of" ? (
                        <input
                          className={inputClass}
                          placeholder="valor1, valor2, …"
                          value={g.values.join(", ")}
                          onChange={(e) =>
                            setParam(i, {
                              values: e.target.value
                                .split(",")
                                .map((v) => v.trim())
                                .filter(Boolean),
                            })
                          }
                        />
                      ) : g.kind === "foreign_key" ? (
                        <span className="text-fg-muted font-mono">
                          {g.table}.{g.column}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {plan && plan.preview.length > 0 && (
            <div>
              <div className={`${fieldLabel} mb-1.5`}>Ejemplo con los generadores sugeridos</div>
              <div className="overflow-auto border border-line rounded-md">
                <table className="text-[11px] font-mono w-full">
                  <thead>
                    <tr className="text-left text-fg-muted bg-raised">
                      {plan.columns
                        .filter((c) => c.generator.kind !== "skip")
                        .map((c) => (
                          <th key={c.column} className="px-2 py-1 font-medium whitespace-nowrap">
                            {c.column}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plan.preview.map((row, r) => (
                      <tr key={r} className="border-t border-line">
                        {row.map((v, c) => (
                          <td key={c} className="px-2 py-1 whitespace-nowrap text-fg">
                            {formatValue(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      )}
    </Modal>
  );
};
