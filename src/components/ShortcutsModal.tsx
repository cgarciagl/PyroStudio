import React, { useState, useMemo } from "react";
import {
  Keyboard,
  Search,
} from "lucide-react";
import { secondaryBtn } from "./ui/styles";
import { Modal } from "./ui/Modal";

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  category: "General y navegación" | "Editor SQL" | "Pestañas y espacio de trabajo";
  action: string;
  description: string;
  keys: string[];
}

const isMac = typeof navigator !== "undefined" && /macintosh|mac os x/i.test(navigator.userAgent);
const modKey = isMac ? "⌘" : "Ctrl";

const SHORTCUT_REGISTRY: ShortcutItem[] = [
  // General y navegación
  {
    category: "General y navegación",
    action: "Paleta de Comandos Global",
    description: "Abrir buscador unificado de acciones, herramientas y objetos de base de datos",
    keys: [modKey, "K"],
  },
  {
    category: "General y navegación",
    action: "Paleta de Comandos (Alternativo)",
    description: "Acceso rápido estilo VS Code / Sublime Text",
    keys: [modKey, "Shift", "P"],
  },
  {
    category: "General y navegación",
    action: "Búsqueda inteligente",
    description: "Buscar tablas, columnas y esquemas semánticamente con IA",
    keys: [modKey, "Shift", "K"],
  },

  {
    category: "General y navegación",
    action: "Reabrir Última Pestaña Cerrada",
    description: "Restaurar la pestaña más reciente del historial de cierre",
    keys: ["Ctrl", "Shift", "T"],
  },
  {
    category: "General y navegación",
    action: "Configuración y Preferencias",
    description: "Personalizar tablas sin PK, Modo Seguro, editor y fuentes",
    keys: ["Ctrl", ","],
  },
  {
    category: "General y navegación",
    action: "Configuración de Proveedores IA",
    description: "Configurar claves de API y modelos de OpenAI / Anthropic / Gemini / modelo local",
    keys: ["Ctrl", "Shift", "A"],
  },
  {
    category: "General y navegación",
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
    action: "Favoritos y fragmentos",
    description: "Guardar o insertar consultas frecuentes",
    keys: ["Ctrl", "S"],
  },

  // Pestañas y espacio de trabajo
  {
    category: "Pestañas y espacio de trabajo",
    action: "Cerrar Pestaña Activa",
    description: "Cerrar la pestaña actual",
    keys: ["Ctrl", "W"],
  },
  {
    category: "Pestañas y espacio de trabajo",
    action: "Cerrar con Clic Central",
    description: "Hacer clic con la rueda del ratón sobre cualquier pestaña",
    keys: ["Clic Central"],
  },
];

export const ShortcutsList: React.FC = () => {
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search Filter */}
      <div className="px-6 py-3 border-b border-line bg-canvas shrink-0">
        <div className="relative">
          <Search className="w-4 h-4 text-fg-subtle absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar atajo (ej. explain, historial, cerrar, enter)..."
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-raised border border-line rounded-md text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent transition-colors"
          />
        </div>
      </div>

      {/* Body / Categorized List */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {categories.length === 0 ? (
          <div className="text-center py-8 text-fg-subtle text-xs">
            No se encontraron atajos que coincidan con &quot;{search}&quot;.
          </div>
        ) : (
          categories.map((category) => (
            <div key={category} className="space-y-2.5">
              <h3 className="text-[11px] font-medium text-accent-text/90 font-mono">
                {category}
              </h3>

              <div className="space-y-1.5">
                {filteredShortcuts
                  .filter((s) => s.category === category)
                  .map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2.5 rounded-lg bg-raised border border-line hover:border-line-strong transition-colors"
                    >
                      <div className="space-y-0.5 max-w-sm">
                        <div className="text-xs font-semibold text-fg">
                          {item.action}
                        </div>
                        <div className="text-[11px] text-fg-muted leading-snug">
                          {item.description}
                        </div>
                      </div>

                      <div className="flex items-center space-x-1 shrink-0 ml-3">
                        {item.keys.map((k, kIdx) => (
                          <React.Fragment key={kIdx}>
                            <kbd className="px-2 py-1 text-[11px] font-mono font-semibold text-fg bg-surface border border-line-strong rounded shadow-xs">
                              {k}
                            </kbd>
                            {kIdx < item.keys.length - 1 && (
                              <span className="text-[11px] text-fg-subtle font-mono">
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
    </div>
  );
};

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({
  isOpen,
  onClose,
}) => {
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

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={<>Atajos de Teclado & Productividad</>}
      subtitle={<>Acelera tu flujo de trabajo con los comandos rápidos de PyroStudio</>}
      icon={<Keyboard className="w-5 h-5" />}
      size="md"
      className="max-h-[85vh]"
      bodyClassName="flex flex-col overflow-hidden"
    >
      <ShortcutsList />
<div className="px-6 py-3 border-t border-line bg-surface flex items-center justify-between text-[11px] text-fg-muted font-mono">
          <span>Tip: Puedes abrir la Paleta de Comandos con <kbd className="px-1.5 py-0.5 bg-raised rounded border border-line-strong text-fg">Ctrl+Shift+P</kbd></span>
          <button
            onClick={onClose}
            className={secondaryBtn}
          >
            Cerrar
          </button>
        </div>
    </Modal>
  );
};
