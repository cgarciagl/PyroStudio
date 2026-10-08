import React, { useState, useMemo } from "react";
import {
  X,
  Keyboard,
  Search,
} from "lucide-react";

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  category: "General & Navegación" | "Editor SQL" | "Pestañas & Workspace";
  action: string;
  description: string;
  keys: string[];
}

const SHORTCUT_REGISTRY: ShortcutItem[] = [
  // General & Navegación
  {
    category: "General & Navegación",
    action: "Paleta de Comandos Global",
    description: "Abrir buscador unificado de acciones, herramientas y objetos de base de datos",
    keys: ["Ctrl", "Shift", "P"],
  },
  {
    category: "General & Navegación",
    action: "Paleta de Comandos (Alternativo)",
    description: "Acceso rápido estilo VS Code / Sublime",
    keys: ["Ctrl", "P"],
  },
  {
    category: "General & Navegación",
    action: "Búsqueda Inteligente (Smart Search)",
    description: "Buscar tablas, columnas y esquemas semánticamente con IA",
    keys: ["Ctrl", "K"],
  },
  {
    category: "General & Navegación",
    action: "Reabrir Última Pestaña Cerrada",
    description: "Restaurar la pestaña más reciente del historial de cierre",
    keys: ["Ctrl", "Shift", "T"],
  },
  {
    category: "General & Navegación",
    action: "Configuración de Proveedores IA",
    description: "Configurar API Keys y modelos de OpenAI / Anthropic / Gemini / Local LLM",
    keys: ["Ctrl", "Shift", "A"],
  },
  {
    category: "General & Navegación",
    action: "Ver Atajos de Teclado",
    description: "Abrir este panel de ayuda de atajos y productividad",
    keys: ["F1"],
  },

  // Editor SQL
  {
    category: "Editor SQL",
    action: "Ejecutar Consulta",
    description: "Enviar la consulta SQL al motor MariaDB / MySQL",
    keys: ["Ctrl", "Enter"],
  },
  {
    category: "Editor SQL",
    action: "Plan de Ejecución (EXPLAIN)",
    description: "Analizar el rendimiento e índices con árbol visual",
    keys: ["Ctrl", "Shift", "Enter"],
  },
  {
    category: "Editor SQL",
    action: "Plan de Ejecución (Atajo Alternativo)",
    description: "Generar EXPLAIN directamente",
    keys: ["Alt", "X"],
  },
  {
    category: "Editor SQL",
    action: "Cancelar Consulta",
    description: "Detener la ejecución de la consulta activa de forma segura",
    keys: ["Esc"],
  },
  {
    category: "Editor SQL",
    action: "Historial de Consultas",
    description: "Ver y re-ejecutar consultas anteriores con filtros cronológicos",
    keys: ["Ctrl", "H"],
  },
  {
    category: "Editor SQL",
    action: "Favoritos & Snippets",
    description: "Guardar o insertar consultas frecuentes",
    keys: ["Ctrl", "S"],
  },

  // Pestañas & Workspace
  {
    category: "Pestañas & Workspace",
    action: "Cerrar Pestaña Activa",
    description: "Cerrar la pestaña actual",
    keys: ["Ctrl", "W"],
  },
  {
    category: "Pestañas & Workspace",
    action: "Cerrar con Clic Central",
    description: "Hacer clic con la rueda del ratón sobre cualquier pestaña",
    keys: ["Clic Central"],
  },
];

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [search, setSearch] = useState("");

  const filteredShortcuts = useMemo(() => {
    if (!search.trim()) return SHORTCUT_REGISTRY;
    const q = search.toLowerCase();
    return SHORTCUT_REGISTRY.filter(
      (s) =>
        s.action.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.keys.some((k) => k.toLowerCase().includes(q)),
    );
  }, [search]);

  const categories = useMemo(() => {
    const set = new Set(filteredShortcuts.map((s) => s.category));
    return Array.from(set);
  }, [filteredShortcuts]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[#11141c] border border-[#232a3c] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1f2535] bg-[#0e1017]">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400">
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide">
                Atajos de Teclado & Productividad
              </h2>
              <p className="text-[11px] text-neutral-400">
                Acelera tu flujo de trabajo con los comandos rápidos de PyroStudio
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-[#1a1f2c] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search Filter */}
        <div className="px-6 py-3 border-b border-[#1c2230] bg-[#0c0e14]">
          <div className="relative">
            <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar atajo (ej. explain, historial, cerrar, enter)..."
              autoFocus
              className="w-full pl-9 pr-4 py-1.5 text-xs bg-[#141824] border border-[#232a3c] rounded-md text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 transition-colors"
            />
          </div>
        </div>

        {/* Body / Categorized List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {categories.length === 0 ? (
            <div className="text-center py-8 text-neutral-500 text-xs">
              No se encontraron atajos que coincidan con &quot;{search}&quot;.
            </div>
          ) : (
            categories.map((category) => (
              <div key={category} className="space-y-2.5">
                <h3 className="text-[11px] font-bold text-orange-400/90 uppercase tracking-wider font-mono">
                  {category}
                </h3>

                <div className="space-y-1.5">
                  {filteredShortcuts
                    .filter((s) => s.category === category)
                    .map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2.5 rounded-lg bg-[#141824] border border-[#1f2535] hover:border-[#2a3449] transition-colors"
                      >
                        <div className="space-y-0.5 max-w-sm">
                          <div className="text-xs font-semibold text-neutral-200">
                            {item.action}
                          </div>
                          <div className="text-[11px] text-neutral-400 leading-snug">
                            {item.description}
                          </div>
                        </div>

                        <div className="flex items-center space-x-1 shrink-0 ml-3">
                          {item.keys.map((k, kIdx) => (
                            <React.Fragment key={kIdx}>
                              <kbd className="px-2 py-1 text-[10px] font-mono font-semibold text-neutral-200 bg-[#0d0f15] border border-[#2b3345] rounded shadow-xs">
                                {k}
                              </kbd>
                              {kIdx < item.keys.length - 1 && (
                                <span className="text-[10px] text-neutral-500 font-mono">
                                  +
                                </span>
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#1f2535] bg-[#0e1017] flex items-center justify-between text-[11px] text-neutral-400 font-mono">
          <span>Tip: Puedes abrir la Paleta de Comandos con <kbd className="px-1.5 py-0.5 bg-[#141824] rounded border border-neutral-700 text-white">Ctrl+Shift+P</kbd></span>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-[#1a1f2c] hover:bg-[#252c3e] text-neutral-200 rounded border border-[#2a3347] transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
