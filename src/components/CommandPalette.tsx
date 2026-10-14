import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Search,
  Terminal,
  Table as TableIcon,
  Eye,
  Settings,
  FunctionSquare,
  Zap,
  LayoutDashboard,
  Activity,
  Flame,
  Sparkles,
  GitCompare,
  Wrench,
  Archive,
  FileSpreadsheet,
  FileCode2,
  Plus,
  Shield,
  Bot,
  FileText,
  X,
  RotateCcw,
  Database,
  Layers,
  Keyboard,
  Key,
  History,
  Server,
} from "lucide-react";
import { useUIStore } from "../stores/uiStore";
import { useSchemaStore } from "../stores/schemaStore";
import { usePreferenceStore } from "../stores/preferenceStore";
import { useConnectionStore } from "../stores/connectionStore";
import { useAiStore } from "../stores/aiStore";
import { queryHistoryStorage } from "../services/queryHistoryStorage";
import { connectionStorage } from "../services/connectionStorage";

interface CommandItem {
  id: string;
  category: "Acciones" | "Pestañas Abiertas" | "Conexiones" | "Consultas Recientes" | "Tablas y Vistas" | "Rutinas" | "Triggers";
  title: string;
  subtitle?: string;
  shortcut?: string;
  icon: React.ReactNode;
  action: () => void;
}


export const CommandPalette: React.FC = () => {
  const {
    isCommandPaletteOpen,
    closeCommandPalette,
    tabs,
    activeTabId,
    closeTab,
    closeOtherTabs,
    clearTabs,
    reopenLastClosedTab,
    openTab,
    openConnectModal,
    openCreateTableModal,
    openImportModal,
    openSqlExportModal,
    openBackupRestoreModal,
    openShortcutsModal,
    openSettingsModal,
  } = useUIStore();

  const {
    databases,
    selectedDatabase,
    tables,
    routines,
    triggers,
    setSelectedDatabase,
    loadSchemaObjects,
  } = useSchemaStore();

  const { connectionStatus } = useConnectionStore();
  const {
    safeModeEnabled,
    toggleSafeMode,
    noPrimaryKeyMode,
    setNoPrimaryKeyMode,
  } = usePreferenceStore();
  const { openAiSettings, openReportsModal } = useAiStore();

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const activeDb =
    selectedDatabase || (databases.length > 0 ? databases[0].name : "test");

  const isMac = typeof navigator !== "undefined" && /macintosh|mac os x/i.test(navigator.userAgent);
  const modLabel = isMac ? "⌘" : "Ctrl";

  // Focus input whenever opened

  useEffect(() => {
    if (isCommandPaletteOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [isCommandPaletteOpen]);

  // Construct all available command items dynamically
  const allItems = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [];

    // ─── 1. General & Navigation Actions ─────────────────────────────────────
    list.push({
      id: "action-new-query",
      category: "Acciones",
      title: "Nueva Consulta SQL",
      subtitle: `Abrir editor de consulta en '${activeDb}'`,
      shortcut: `${modLabel}+N`,
      icon: <Terminal className="w-4 h-4 text-sky-400" />,
      action: () => {
        const queryCount = tabs.filter((t) => t.type === "query").length + 1;
        openTab({
          id: `query-${Date.now()}`,
          title: `Consulta ${queryCount}`,
          type: "query",
          database: activeDb,
          queryContent: `SELECT * FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() LIMIT 100;`,
        });
      },
    });

    list.push({
      id: "action-shortcuts",
      category: "Acciones",
      title: "Ver Atajos de Teclado & Productividad",
      subtitle: "Consultar lista interactiva de comandos rápidos",
      shortcut: "F1",
      icon: <Keyboard className="w-4 h-4 text-amber-400" />,
      action: () => {
        openShortcutsModal();
      },
    });

    if (connectionStatus.is_connected) {
      list.push({
        id: "action-open-dashboard",
        category: "Acciones",
        title: "Abrir Resumen (Dashboard)",
        subtitle: `Métricas, almacenamiento y QPS de '${activeDb}'`,
        icon: <LayoutDashboard className="w-4 h-4 text-emerald-400" />,
        action: () => {
          openTab({
            id: `dashboard-${activeDb}`,
            title: `Dashboard (${activeDb})`,
            type: "dashboard",
            database: activeDb,
          });
        },
      });

      list.push({
        id: "action-open-health",
        category: "Acciones",
        title: "Monitor de Salud de la BD",
        subtitle: `Auditoría y puntuación de optimización en '${activeDb}'`,
        icon: <Activity className="w-4 h-4 text-emerald-400" />,
        action: () => {
          openTab({
            id: `health-${activeDb}`,
            title: `Salud (${activeDb})`,
            type: "health",
            database: activeDb,
          });
        },
      });

      list.push({
        id: "action-open-slow-query",
        category: "Acciones",
        title: "Slow Query & EXPLAIN Visual",
        subtitle: `Analizador de cuellos de botella y visualizador de planes`,
        shortcut: "Ctrl+Shift+Enter",
        icon: <Flame className="w-4 h-4 text-orange-400" />,
        action: () => {
          openTab({
            id: `slow-query-${activeDb}-${Date.now()}`,
            title: `Slow Query (${activeDb})`,
            type: "slow_query",
            database: activeDb,
          });
        },
      });

      list.push({
        id: "action-open-advisor",
        category: "Acciones",
        title: "Asesor de Índices (Index Advisor)",
        subtitle: `Detección de índices redundantes y FKs sin indexar`,
        icon: <Sparkles className="w-4 h-4 text-amber-400" />,
        action: () => {
          openTab({
            id: `advisor-${activeDb}`,
            title: `Index Advisor (${activeDb})`,
            type: "advisor",
            database: activeDb,
          });
        },
      });

      list.push({
        id: "action-open-diff",
        category: "Acciones",
        title: "Schema Diff & Migraciones",
        subtitle: `Comparar dos esquemas y generar scripts de migración`,
        icon: <GitCompare className="w-4 h-4 text-indigo-400" />,
        action: () => {
          openTab({
            id: `diff-${activeDb}-${Date.now()}`,
            title: `Schema Diff`,
            type: "diff",
            database: activeDb,
          });
        },
      });

      list.push({
        id: "action-open-operations",
        category: "Acciones",
        title: "Operaciones de Mantenimiento",
        subtitle: `OPTIMIZE, ANALYZE, CHECK y REPAIR de tablas`,
        icon: <Wrench className="w-4 h-4 text-cyan-400" />,
        action: () => {
          openTab({
            id: `operations-${activeDb}`,
            title: `Mantenimiento (${activeDb})`,
            type: "operations",
            database: activeDb,
          });
        },
      });

      list.push({
        id: "action-open-backup-restore",
        category: "Acciones",
        title: "Backup & Restore de Base de Datos",
        subtitle: `Exportación completa .sql Dump y restauración`,
        icon: <Archive className="w-4 h-4 text-orange-400" />,
        action: () => {
          openBackupRestoreModal({ targetDatabase: activeDb });
        },
      });

      list.push({
        id: "action-open-create-table",
        category: "Acciones",
        title: "Crear Nueva Tabla...",
        subtitle: `Asistente visual de creación de tabla en '${activeDb}'`,
        icon: <Plus className="w-4 h-4 text-orange-400" />,
        action: () => {
          openCreateTableModal(activeDb);
        },
      });

      list.push({
        id: "action-open-import-excel",
        category: "Acciones",
        title: "Importar Archivo Excel...",
        subtitle: `Cargar datos desde hoja de cálculo .xlsx / .xls`,
        icon: <FileSpreadsheet className="w-4 h-4 text-emerald-400" />,
        action: () => {
          openImportModal({ database: activeDb });
        },
      });

      list.push({
        id: "action-export-excel-quick",
        category: "Acciones",
        title: "Exportar Resultados a Excel (.xlsx)...",
        subtitle: "Exportar datos actuales a archivo Excel nativo",
        icon: <FileSpreadsheet className="w-4 h-4 text-orange-400" />,
        action: () => {
          openSqlExportModal({ database: activeDb });
        },
      });

      list.push({
        id: "action-open-sql-export",
        category: "Acciones",
        title: "Exportar Base de Datos a SQL...",
        subtitle: `Generar archivo .sql con DDL e INSERTs`,
        icon: <FileCode2 className="w-4 h-4 text-rose-400" />,
        action: () => {
          openSqlExportModal({ database: activeDb });
        },
      });

      list.push({
        id: "action-open-agent",
        category: "Acciones",
        title: "Agente de Base de Datos (IA)",
        subtitle: `Diagnóstico y optimización autónoma con LLM`,
        icon: <Bot className="w-4 h-4 text-purple-400" />,
        action: () => {
          openTab({
            id: `agent-${activeDb}`,
            title: `Agente BD (${activeDb})`,
            type: "agent",
            database: activeDb,
          });
        },
      });

      list.push({
        id: "action-open-reports",
        category: "Acciones",
        title: "Generador de Informes & Diccionario",
        subtitle: `Documentación de esquema y reporte de auditoría`,
        icon: <FileText className="w-4 h-4 text-sky-400" />,
        action: () => {
          openReportsModal();
        },
      });

      list.push({
        id: "action-toggle-safe-mode",
        category: "Acciones",
        title: safeModeEnabled ? "Desactivar Modo Seguro" : "Activar Modo Seguro",
        subtitle: safeModeEnabled
          ? "Permitir sentencias destructivas sin confirmación"
          : "Bloquear DROP, TRUNCATE y DELETE/UPDATE sin WHERE",
        icon: <Shield className="w-4 h-4 text-emerald-400" />,
        action: () => {
          toggleSafeMode();
        },
      });

      list.push({
        id: "action-toggle-no-pk-mode",
        category: "Acciones",
        title:
          noPrimaryKeyMode === "use_all_columns"
            ? "Tablas sin PK: Cambiar a Bloquear Operaciones"
            : "Tablas sin PK: Cambiar a Usar Todos los Campos (Fila Completa)",
        subtitle:
          noPrimaryKeyMode === "use_all_columns"
            ? "Actualmente trata todos los campos de la fila como clave única"
            : "Actualmente bloquea edición/eliminación si no hay clave primaria",
        icon: <Key className="w-4 h-4 text-amber-400" />,
        action: () => {
          setNoPrimaryKeyMode(
            noPrimaryKeyMode === "use_all_columns" ? "block" : "use_all_columns",
          );
        },
      });
    }

    list.push({
      id: "action-connect-manage",
      category: "Acciones",
      title: "Administrar Conexiones a Servidor",
      subtitle: "Crear, editar o conectar perfiles MariaDB/MySQL",
      icon: <Database className="w-4 h-4 text-orange-400" />,
      action: () => {
        openConnectModal();
      },
    });

    list.push({
      id: "action-ai-settings",
      category: "Acciones",
      title: "Ajustes de Inteligencia Artificial (IA)",
      subtitle: "Configurar API Keys, modelos y Modo de Privacidad",
      shortcut: "Ctrl+Shift+A",
      icon: <Sparkles className="w-4 h-4 text-purple-400" />,
      action: () => {
        openAiSettings();
      },
    });

    list.push({
      id: "action-settings",
      category: "Acciones",
      title: "Configuración y Preferencias del Sistema",
      subtitle: "Personalizar modo sin PK, Modo Seguro, fuentes y paginación",
      shortcut: "Ctrl+,",
      icon: <Settings className="w-4 h-4 text-neutral-300" />,
      action: () => {
        openSettingsModal();
      },
    });

    // Tab Management commands
    if (activeTabId) {
      list.push({
        id: "action-close-tab",
        category: "Acciones",
        title: "Cerrar Pestaña Activa",
        subtitle: "Cierra la pestaña que se está visualizando",
        shortcut: "Ctrl+W",
        icon: <X className="w-4 h-4 text-neutral-400" />,
        action: () => {
          closeTab(activeTabId);
        },
      });
    }

    if (tabs.length > 1 && activeTabId) {
      list.push({
        id: "action-close-other-tabs",
        category: "Acciones",
        title: "Cerrar las Demás Pestañas",
        subtitle: "Mantiene solo la pestaña activa (y las fijadas)",
        icon: <Layers className="w-4 h-4 text-neutral-400" />,
        action: () => {
          closeOtherTabs(activeTabId);
        },
      });
    }

    list.push({
      id: "action-reopen-tab",
      category: "Acciones",
      title: "Reabrir Última Pestaña Cerrada",
      subtitle: "Restaura la pestaña cerrada más recientemente",
      shortcut: "Ctrl+Shift+T",
      icon: <RotateCcw className="w-4 h-4 text-emerald-400" />,
      action: () => {
        reopenLastClosedTab();
      },
    });

    if (tabs.length > 0) {
      list.push({
        id: "action-close-all-tabs",
        category: "Acciones",
        title: "Cerrar Todas las Pestañas",
        subtitle: "Limpia el espacio de trabajo",
        icon: <X className="w-4 h-4 text-red-400" />,
        action: () => {
          clearTabs();
        },
      });
    }

    // ─── 2. Open Tabs (Quick Switcher) ───────────────────────────────────────
    tabs.forEach((tab, index) => {
      const isCurrent = tab.id === activeTabId;
      list.push({
        id: `tab-switch-${tab.id}`,
        category: "Pestañas Abiertas",
        title: tab.title,
        subtitle: `${tab.database}${tab.tableName ? ` • ${tab.tableName}` : ""} ${isCurrent ? "• (Pestaña actual)" : `• Posición #${index + 1}`}`,
        icon: <Layers className="w-4 h-4 text-orange-400" />,
        action: () => {
          useUIStore.getState().setActiveTabId(tab.id);
        },
      });
    });

    // ─── 3. Saved Connections ────────────────────────────────────────────────
    try {
      const savedConns = connectionStorage.getSavedConnections();
      savedConns.forEach((conn) => {
        list.push({
          id: `conn-profile-${conn.id}`,
          category: "Conexiones",
          title: conn.name,
          subtitle: `${conn.user}@${conn.host}:${conn.port} • ${conn.environment || "local"}${conn.database ? ` • db: ${conn.database}` : ""}`,
          icon: <Server className="w-4 h-4 text-sky-400" />,
          action: () => {
            openConnectModal(conn);
          },
        });
      });
    } catch {
      // Ignored if storage is inaccessible
    }

    // ─── 4. Recent Queries ───────────────────────────────────────────────────
    try {
      const recentHistory = queryHistoryStorage.getHistory().slice(0, 10);
      recentHistory.forEach((hist, hIdx) => {
        const preview = hist.sql.trim().replace(/\s+/g, " ").slice(0, 80);
        list.push({
          id: `recent-query-${hist.id || hIdx}`,
          category: "Consultas Recientes",
          title: preview,
          subtitle: `${hist.database} • ${hist.durationMs} ms • ${new Date(hist.timestamp).toLocaleTimeString()}`,
          icon: <History className="w-4 h-4 text-amber-400" />,
          action: () => {
            const queryCount = tabs.filter((t) => t.type === "query").length + 1;
            openTab({
              id: `query-hist-${Date.now()}`,
              title: `Consulta ${queryCount}`,
              type: "query",
              database: hist.database || activeDb,
              queryContent: hist.sql,
            });
          },
        });
      });
    } catch {
      // Ignored
    }

    // ─── 5. Database Schema Objects ──────────────────────────────────────────

    databases.forEach((db) => {
      const dbTables = tables[db.name] || [];
      const dbRoutines = routines[db.name] || [];
      const dbTriggers = triggers[db.name] || [];

      // Tables & Views
      dbTables.forEach((t) => {
        const isView = t.table_type === "VIEW";
        list.push({
          id: `obj-tbl-${db.name}-${t.name}`,
          category: "Tablas y Vistas",
          title: t.name,
          subtitle: `${db.name} • ${isView ? "Vista" : "Tabla"}${
            t.rows_count !== undefined && t.rows_count !== null
              ? ` • ~${t.rows_count.toLocaleString()} filas`
              : ""
          }`,
          icon: isView ? (
            <Eye className="w-4 h-4 text-sky-400" />
          ) : (
            <TableIcon className="w-4 h-4 text-amber-500" />
          ),
          action: () => {
            setSelectedDatabase(db.name);
            loadSchemaObjects(db.name);
            openTab({
              id: `table-${db.name}-${t.name}`,
              title: t.name,
              type: "table",
              database: db.name,
              tableName: t.name,
            });
          },
        });
      });

      // Routines (Procedures & Functions)
      dbRoutines.forEach((r) => {
        const isFunc = r.routine_type === "FUNCTION";
        list.push({
          id: `obj-rtn-${db.name}-${r.name}`,
          category: "Rutinas",
          title: r.name,
          subtitle: `${db.name} • ${isFunc ? "Función" : "Procedimiento"}`,
          icon: isFunc ? (
            <FunctionSquare className="w-4 h-4 text-purple-400" />
          ) : (
            <Settings className="w-4 h-4 text-orange-400" />
          ),
          action: () => {
            setSelectedDatabase(db.name);
            loadSchemaObjects(db.name);
            openTab({
              id: `routine-${db.name}-${r.name}`,
              title: r.name,
              type: "routine",
              database: db.name,
              routineName: r.name,
              routineType: r.routine_type,
            });
          },
        });
      });

      // Triggers
      dbTriggers.forEach((tr) => {
        list.push({
          id: `obj-trg-${db.name}-${tr.name}`,
          category: "Triggers",
          title: tr.name,
          subtitle: `${db.name} • Trigger (${tr.timing} ${tr.event})`,
          icon: <Zap className="w-4 h-4 text-amber-400" />,
          action: () => {
            setSelectedDatabase(db.name);
            loadSchemaObjects(db.name);
            openTab({
              id: `trigger-${db.name}-${tr.name}`,
              title: tr.name,
              type: "trigger",
              database: db.name,
              triggerName: tr.name,
            });
          },
        });
      });
    });

    return list;
  }, [
    activeDb,
    connectionStatus.is_connected,
    databases,
    tables,
    routines,
    triggers,
    tabs,
    activeTabId,
    safeModeEnabled,
    openTab,
    closeTab,
    closeOtherTabs,
    clearTabs,
    reopenLastClosedTab,
    openConnectModal,
    openCreateTableModal,
    openImportModal,
    openSqlExportModal,
    openBackupRestoreModal,
    openAiSettings,
    openReportsModal,
    toggleSafeMode,
    setSelectedDatabase,
    loadSchemaObjects,
  ]);

  // Filter items matching query with intelligent fuzzy scoring and database prioritization
  const filteredItems = useMemo(() => {
    if (!query.trim()) return allItems.slice(0, 40);

    const term = query.toLowerCase().trim();

    const fuzzyScore = (target: string, q: string): number => {
      const t = target.toLowerCase();
      if (t === q) return 100;
      if (t.startsWith(q)) return 80 + (q.length / t.length) * 15;
      if (t.includes(q)) return 60 + (q.length / t.length) * 10;

      let qIdx = 0;
      let score = 0;
      for (let i = 0; i < t.length && qIdx < q.length; i++) {
        if (t[i] === q[qIdx]) {
          qIdx++;
          score += 4;
        }
      }
      return qIdx === q.length ? score : 0;
    };

    const scored = allItems
      .map((item) => {
        const titleScore = fuzzyScore(item.title, term);
        const subScore = item.subtitle ? fuzzyScore(item.subtitle, term) * 0.7 : 0;
        const catScore = fuzzyScore(item.category, term) * 0.5;
        let total = Math.max(titleScore, subScore, catScore);

        // Boost active database tables
        if (total > 0 && item.category === "Tablas y Vistas" && item.subtitle?.includes(activeDb)) {
          total += 20;
        }

        return { item, score: total };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, 50).map((entry) => entry.item);
  }, [allItems, query, activeDb]);

  // Handle Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev < filteredItems.length - 1 ? prev + 1 : 0
      );
      scrollItemIntoView(selectedIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : filteredItems.length - 1
      );
      scrollItemIntoView(selectedIndex - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        filteredItems[selectedIndex].action();
        closeCommandPalette();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeCommandPalette();
    }
  };

  const scrollItemIntoView = (index: number) => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-palette-item]");
    const target = items[index] as HTMLElement;
    if (target) {
      target.scrollIntoView({ block: "nearest" });
    }
  };

  if (!isCommandPaletteOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 backdrop-blur-xs p-4 pt-16 animate-in fade-in duration-100 select-none"
      onClick={closeCommandPalette}
    >
      <div
        className="bg-[#10131c] border border-[#232a3c] rounded-xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden text-neutral-200"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Header */}
        <div className="p-3.5 bg-[#141824] border-b border-[#202738] flex items-center space-x-3">
          <Search className="w-5 h-5 text-orange-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Escribe un comando o busca una tabla / rutina..."
            className="flex-1 bg-transparent text-sm text-white placeholder-neutral-500 focus:outline-none font-mono"
          />
          <span className="text-[10px] text-neutral-400 font-mono px-1.5 py-0.5 rounded bg-[#1c2232] border border-[#2a344c]">
            ESC para salir
          </span>
          <button
            onClick={closeCommandPalette}
            className="p-1 rounded hover:bg-neutral-800 text-neutral-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filtered Items List */}
        <div
          ref={listRef}
          className="max-h-[60vh] overflow-y-auto p-2 space-y-1 text-xs font-mono"
        >
          {filteredItems.length === 0 ? (
            <div className="py-12 text-center text-neutral-500 font-mono text-xs">
              No se encontraron comandos ni objetos que coincidan con "{query}".
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  data-palette-item
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    item.action();
                    closeCommandPalette();
                  }}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-orange-600/20 text-white border border-orange-500/40"
                      : "text-neutral-300 hover:bg-[#141824] border border-transparent"
                  }`}
                >
                  <div className="flex items-center space-x-3 truncate mr-2">
                    <div
                      className={`p-1.5 rounded shrink-0 ${
                        isSelected ? "bg-orange-500/20" : "bg-[#141824]"
                      }`}
                    >
                      {item.icon}
                    </div>
                    <div className="truncate">
                      <div className="font-semibold text-xs text-white truncate flex items-center space-x-2">
                        <span>{item.title}</span>
                      </div>
                      {item.subtitle && (
                        <div className="text-[10px] text-neutral-400 truncate">
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#161a26] text-neutral-400 border border-[#242c40]">
                      {item.category}
                    </span>
                    {item.shortcut && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1f2638] text-orange-300 font-bold border border-[#2c364e]">
                        {item.shortcut}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-[#121520] border-t border-[#1f2638] flex items-center justify-between text-[10px] text-neutral-500 font-mono">
          <div className="flex items-center space-x-3">
            <span>↑↓ Navegar</span>
            <span>↵ Seleccionar</span>
            <span>ESC Cerrar</span>
          </div>
          <span>{filteredItems.length} resultado(s)</span>
        </div>
      </div>
    </div>
  );
};
