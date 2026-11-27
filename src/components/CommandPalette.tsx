import React, { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Command,
  Terminal,
  Table as TableIcon,
  Eye,
  Settings,
  FunctionSquare,
  Zap,
  LayoutDashboard,
  Lock,
  Activity,
  Flame,
  Sparkles,
  GitCompare,
  GitCompareArrows,
  ArrowLeftRight,
  Braces,
  Stethoscope,
  Network,
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
  ScrollText,
  Key,
  History,
  Server,
  Binary,
  Calendar,
  Info,
  Star,
} from "lucide-react";
import { INSERT_SNIPPET_EVENT, useSnippets } from "../services/snippetsStorage";
import { DiagnosticsModal } from "./DiagnosticsModal";
import { iconBtn } from "./ui/styles";
import { useUIStore } from "../stores/uiStore";
import { useSchemaStore } from "../stores/schemaStore";
import { usePreferenceStore } from "../stores/preferenceStore";
import { useConnectionStore } from "../stores/connectionStore";
import { useAiStore } from "../stores/aiStore";
import { useCapabilitiesStore } from "../stores/capabilitiesStore";
import { useSqlDialect } from "../services/sqlDialect";
import { queryHistoryStorage } from "../services/queryHistoryStorage";
import { connectionStorage } from "../services/connectionStorage";
import { favoritesStorage } from "../services/favoritesStorage";
import { openSavedQuery, useSavedQueriesVersion } from "./SavedQueriesFolder";
import { activeSavedConnectionId } from "../types/database";
import { uid } from "../utils/uid";
import { formatGeneratedSql } from "../services/generatedSql";

interface CommandItem {
  id: string;
  category: string;
  title: string;
  subtitle?: string;
  shortcut?: string;
  isTable?: boolean;
  sqlContent?: string;
  icon: React.ReactNode;
  action: () => void;
}


export const CommandPalette: React.FC = () => {
  const { t } = useTranslation("shell");
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
    openAboutModal,
    openSettingsModal,
  } = useUIStore();

  const {
    databases,
    selectedDatabase,
    tables,
    routines,
    triggers,
    sequences,
    events,
    setSelectedDatabase,
    loadSchemaObjects,
  } = useSchemaStore();

  const { connectionStatus } = useConnectionStore();
  const activeConnectionId = activeSavedConnectionId(connectionStatus.config);
  const savedQueriesVersion = useSavedQueriesVersion();
  const {
    safeModeEnabled,
    toggleSafeMode,
    noPrimaryKeyMode,
    setNoPrimaryKeyMode,
  } = usePreferenceStore();
  const { openAiSettings, openReportsModal } = useAiStore();
  const { supportsFeature, capabilities } = useCapabilitiesStore();
  const dialect = useSqlDialect();

  const [query, setQuery] = useState("");
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const snippets = useSnippets();
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
      useAiStore.getState().closeSmartSearch();
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [isCommandPaletteOpen]);

  // Construct all available command items dynamically
  const allItems = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [];

    const catActions = t("palette.categories.actions");
    const catSnippets = t("palette.categories.snippets");

    // ─── 1. General & Navigation Actions ─────────────────────────────────────
    list.push({
      id: "action-new-query",
      category: catActions,
      title: t("palette.items.newQueryTitle"),
      subtitle: t("palette.items.newQuerySubtitle", { db: activeDb }),
      shortcut: `${modLabel}+N`,
      icon: <Terminal className="w-4 h-4 text-fg-muted" />,
      action: () => {
        const queryCount = tabs.filter((tab) => tab.type === "query").length + 1;
        openTab({
          id: `query-${uid()}`,
          title: t("palette.queryTabTitle", { n: queryCount }),
          type: "query",
          database: activeDb,
          queryContent: formatGeneratedSql(dialect.starterQuery),
        });
      },
    });

    list.push({
      id: "action-favorites",
      category: catActions,
      title: t("palette.items.favoritesTitle"),
      subtitle: t("palette.items.favoritesSubtitle"),
      icon: <Star className="w-4 h-4 text-fg-muted" />,
      action: () => {
        useUIStore.getState().openFavoritesModal();
      },
    });

    list.push({
      id: "action-history",
      category: catActions,
      title: t("palette.items.historyTitle"),
      subtitle: t("palette.items.historySubtitle"),
      shortcut: `${modLabel}+H`,
      icon: <History className="w-4 h-4 text-fg-muted" />,
      action: () => {
        useUIStore.getState().openHistoryModal();
      },
    });

    list.push({
      id: "action-audit-log",
      category: catActions,
      title: t("palette.items.auditLogTitle"),
      subtitle: t("palette.items.auditLogSubtitle"),
      icon: <ScrollText className="w-4 h-4 text-fg-muted" />,
      action: () => {
        useUIStore.getState().openAuditLog();
      },
    });

    list.push({
      id: "action-snippets",
      category: catActions,
      title: t("palette.items.snippetsTitle"),
      subtitle: t("palette.items.snippetsSubtitle"),
      icon: <Braces className="w-4 h-4 text-fg-muted" />,
      action: () => useUIStore.getState().openSnippetsModal(),
    });

    // Snippets can be inserted when the active tab is a query editor.
    if (tabs.find((tab) => tab.id === activeTabId)?.type === "query") {
      for (const snip of snippets) {
        list.push({
          id: `snippet-${snip.id}`,
          category: catSnippets,
          title: t("palette.items.insertSnippetTitle", { name: snip.name }),
          subtitle: snip.description || t("palette.items.snippetPrefixSubtitle", { prefix: snip.prefix }),
          sqlContent: snip.body,
          icon: <Braces className="w-4 h-4 text-fg-muted" />,
          action: () => {
            // After the palette closes, so the editor can take focus.
            setTimeout(() => window.dispatchEvent(new CustomEvent(INSERT_SNIPPET_EVENT, { detail: snip })), 0);
          },
        });
      }
    }

    list.push({
      id: "action-diagnostics",
      category: catActions,
      title: t("palette.items.diagnosticsTitle"),
      subtitle: t("palette.items.diagnosticsSubtitle"),
      icon: <Stethoscope className="w-4 h-4 text-fg-muted" />,
      action: () => setIsDiagnosticsOpen(true),
    });

    list.push({
      id: "action-open-demo",
      category: catActions,
      title: t("palette.items.demoTitle"),
      subtitle: t("palette.items.demoSubtitle"),
      icon: <Database className="w-4 h-4 text-fg-muted" />,
      action: () => useUIStore.getState().requestDemo(),
    });

    list.push({
      id: "action-shortcuts",
      category: catActions,
      title: t("palette.items.shortcutsTitle"),
      subtitle: t("palette.items.shortcutsSubtitle"),
      shortcut: "F1",
      icon: <Keyboard className="w-4 h-4 text-fg-muted" />,
      action: () => {
        openShortcutsModal();
      },
    });

    list.push({
      id: "action-about",
      category: catActions,
      title: t("palette.items.aboutTitle"),
      subtitle: t("palette.items.aboutSubtitle"),
      icon: <Info className="w-4 h-4 text-fg-muted" />,
      action: () => {
        openAboutModal();
      },
    });

    if (connectionStatus.is_connected) {
      if (supportsFeature("dashboard")) list.push({
        id: "action-open-dashboard",
        category: catActions,
        title: t("palette.items.dashboardTitle"),
        subtitle: t("palette.items.dashboardSubtitle", { db: activeDb }),
        icon: <LayoutDashboard className="w-4 h-4 text-fg-muted" />,
        action: () => {
          openTab({
            id: `dashboard-${activeDb}`,
            title: t("palette.items.dashboardTabTitle", { db: activeDb }),
            type: "dashboard",
            database: activeDb,
          });
        },
      });

      if (supportsFeature("healthMonitor")) list.push({
        id: "action-open-health",
        category: catActions,
        title: t("palette.items.healthTitle"),
        subtitle: t("palette.items.healthSubtitle", { db: activeDb }),
        icon: <Activity className="w-4 h-4 text-fg-muted" />,
        action: () => {
          openTab({
            id: `health-${activeDb}`,
            title: t("palette.items.healthTabTitle", { db: activeDb }),
            type: "health",
            database: activeDb,
          });
        },
      });

      if (supportsFeature("locksInspector")) list.push({
        id: "action-open-locks",
        category: catActions,
        title: t("palette.items.locksTitle"),
        subtitle: t("palette.items.locksSubtitle", { db: activeDb }),
        icon: <Lock className="w-4 h-4 text-fg-muted" />,
        action: () => {
          openTab({
            id: "locks",
            title: t("palette.items.locksTabTitle"),
            type: "locks",
            database: activeDb,
          });
        },
      });

      if (supportsFeature("slowQueryAnalyzer")) list.push({
        id: "action-open-slow-query",
        category: catActions,
        title: t("palette.items.slowQueryTitle"),
        subtitle: t("palette.items.slowQuerySubtitle"),
        shortcut: "Ctrl+Shift+Enter",
        icon: <Flame className="w-4 h-4 text-fg-muted" />,
        action: () => {
          openTab({
            id: `slow-query-${activeDb}-${uid()}`,
            title: t("palette.items.slowQueryTabTitle", { db: activeDb }),
            type: "slow_query",
            database: activeDb,
          });
        },
      });

      if (supportsFeature("indexAdvisor")) list.push({
        id: "action-open-advisor",
        category: catActions,
        title: t("palette.items.advisorTitle"),
        subtitle: t("palette.items.advisorSubtitle"),
        icon: <Sparkles className="w-4 h-4 text-fg-muted" />,
        action: () => {
          openTab({
            id: `advisor-${activeDb}`,
            title: t("palette.items.advisorTabTitle", { db: activeDb }),
            type: "advisor",
            database: activeDb,
          });
        },
      });

      list.push({
        id: "action-open-er",
        category: catActions,
        title: t("palette.items.erTitle"),
        subtitle: t("palette.items.erSubtitle", { db: activeDb }),
        icon: <Network className="w-4 h-4 text-fg-muted" />,
        action: () => {
          openTab({
            id: `er-${activeDb}`,
            title: t("palette.items.erTabTitle", { db: activeDb }),
            type: "er",
            database: activeDb,
          });
        },
      });

      list.push({
        id: "action-open-data-diff",
        category: catActions,
        title: t("palette.items.dataDiffTitle"),
        subtitle: t("palette.items.dataDiffSubtitle"),
        icon: <GitCompareArrows className="w-4 h-4 text-fg-muted" />,
        action: () => {
          openTab({
            id: `data-diff-${uid()}`,
            title: t("palette.items.dataDiffTabTitle"),
            type: "data_diff",
            database: activeDb,
          });
        },
      });

      list.push({
        id: "action-open-data-transfer",
        category: catActions,
        title: t("palette.items.dataTransferTitle"),
        subtitle: t("palette.items.dataTransferSubtitle"),
        icon: <ArrowLeftRight className="w-4 h-4 text-fg-muted" />,
        action: () => {
          openTab({
            id: `data-transfer-${uid()}`,
            title: t("palette.items.dataTransferTabTitle"),
            type: "data_transfer",
            database: activeDb,
          });
        },
      });

      if (supportsFeature("schemaDiff")) list.push({
        id: "action-open-diff",
        category: catActions,
        title: t("palette.items.schemaDiffTitle"),
        subtitle: t("palette.items.schemaDiffSubtitle"),
        icon: <GitCompare className="w-4 h-4 text-fg-muted" />,
        action: () => {
          openTab({
            id: `diff-${activeDb}-${uid()}`,
            title: t("palette.items.schemaDiffTabTitle"),
            type: "diff",
            database: activeDb,
          });
        },
      });

      if (supportsFeature("tableMaintenance")) list.push({
        id: "action-open-operations",
        category: catActions,
        title: t("palette.items.operationsTitle"),
        subtitle: t("palette.items.operationsSubtitle"),
        icon: <Wrench className="w-4 h-4 text-fg-muted" />,
        action: () => {
          openTab({
            id: `operations-${activeDb}`,
            title: t("palette.items.operationsTabTitle", { db: activeDb }),
            type: "operations",
            database: activeDb,
          });
        },
      });

      list.push({
        id: "action-open-backup-restore",
        category: catActions,
        title: t("palette.items.backupTitle"),
        subtitle: t("palette.items.backupSubtitle"),
        icon: <Archive className="w-4 h-4 text-fg-muted" />,
        action: () => {
          openBackupRestoreModal({ targetDatabase: activeDb });
        },
      });

      list.push({
        id: "action-open-create-table",
        category: catActions,
        title: t("palette.items.createTableTitle"),
        subtitle: t("palette.items.createTableSubtitle", { db: activeDb }),
        icon: <Plus className="w-4 h-4 text-fg-muted" />,
        action: () => {
          openCreateTableModal(activeDb);
        },
      });

      list.push({
        id: "action-open-import-excel",
        category: catActions,
        title: t("palette.items.importExcelTitle"),
        subtitle: t("palette.items.importExcelSubtitle"),
        icon: <FileSpreadsheet className="w-4 h-4 text-fg-muted" />,
        action: () => {
          openImportModal({ database: activeDb });
        },
      });

      list.push({
        id: "action-export-excel-quick",
        category: catActions,
        title: t("palette.items.exportQuickTitle"),
        subtitle: t("palette.items.exportQuickSubtitle"),
        icon: <FileSpreadsheet className="w-4 h-4 text-fg-muted" />,
        action: () => {
          openSqlExportModal({ database: activeDb });
        },
      });

      if (supportsFeature("sqlDump")) list.push({
        id: "action-open-sql-export",
        category: catActions,
        title: t("palette.items.exportSqlTitle"),
        subtitle: t("palette.items.exportSqlSubtitle"),
        icon: <FileCode2 className="w-4 h-4 text-fg-muted" />,
        action: () => {
          openSqlExportModal({ database: activeDb });
        },
      });

      if (supportsFeature("databaseAgent")) list.push({
        id: "action-open-agent",
        category: catActions,
        title: t("palette.items.agentTitle"),
        subtitle: t("palette.items.agentSubtitle"),
        icon: <Bot className="w-4 h-4 text-fg-muted" />,
        action: () => {
          openTab({
            id: `agent-${activeDb}`,
            title: t("palette.items.agentTabTitle", { db: activeDb }),
            type: "agent",
            database: activeDb,
          });
        },
      });

      if (supportsFeature("databaseReports")) list.push({
        id: "action-open-reports",
        category: catActions,
        title: t("palette.items.reportsTitle"),
        subtitle: t("palette.items.reportsSubtitle"),
        icon: <FileText className="w-4 h-4 text-fg-muted" />,
        action: () => {
          openReportsModal();
        },
      });

      list.push({
        id: "action-toggle-safe-mode",
        category: catActions,
        title: safeModeEnabled ? t("palette.items.disableSafeMode") : t("palette.items.enableSafeMode"),
        subtitle: safeModeEnabled
          ? t("palette.items.disableSafeModeSubtitle")
          : t("palette.items.enableSafeModeSubtitle"),
        icon: <Shield className="w-4 h-4 text-fg-muted" />,
        action: () => {
          toggleSafeMode();
        },
      });

      list.push({
        id: "action-toggle-no-pk-mode",
        category: catActions,
        title:
          noPrimaryKeyMode === "use_all_columns"
            ? t("palette.items.noPkToBlockTitle")
            : t("palette.items.noPkToFullRowTitle"),
        subtitle:
          noPrimaryKeyMode === "use_all_columns"
            ? t("palette.items.noPkToBlockSubtitle")
            : t("palette.items.noPkToFullRowSubtitle"),
        icon: <Key className="w-4 h-4 text-warning" />,
        action: () => {
          setNoPrimaryKeyMode(
            noPrimaryKeyMode === "use_all_columns" ? "block" : "use_all_columns",
          );
        },
      });
    }

    list.push({
      id: "action-connect-manage",
      category: catActions,
      title: t("palette.items.manageConnectionsTitle"),
      subtitle: t("palette.items.manageConnectionsSubtitle"),
      icon: <Database className="w-4 h-4 text-fg-muted" />,
      action: () => {
        openConnectModal();
      },
    });

    list.push({
      id: "action-ai-settings",
      category: catActions,
      title: t("palette.items.aiSettingsTitle"),
      subtitle: t("palette.items.aiSettingsSubtitle"),
      shortcut: "Ctrl+Shift+A",
      icon: <Sparkles className="w-4 h-4 text-fg-muted" />,
      action: () => {
        openAiSettings();
      },
    });

    list.push({
      id: "action-settings",
      category: catActions,
      title: t("palette.items.settingsTitle"),
      subtitle: t("palette.items.settingsSubtitle"),
      shortcut: "Ctrl+,",
      icon: <Settings className="w-4 h-4 text-fg" />,
      action: () => {
        openSettingsModal();
      },
    });

    // Tab Management commands
    if (activeTabId) {
      list.push({
        id: "action-close-tab",
        category: catActions,
        title: t("palette.items.closeTabTitle"),
        subtitle: t("palette.items.closeTabSubtitle"),
        shortcut: "Ctrl+W",
        icon: <X className="w-4 h-4 text-fg-muted" />,
        action: () => {
          closeTab(activeTabId);
        },
      });
    }

    if (tabs.length > 1 && activeTabId) {
      list.push({
        id: "action-close-other-tabs",
        category: catActions,
        title: t("palette.items.closeOtherTabsTitle"),
        subtitle: t("palette.items.closeOtherTabsSubtitle"),
        icon: <Layers className="w-4 h-4 text-fg-muted" />,
        action: () => {
          closeOtherTabs(activeTabId);
        },
      });
    }

    list.push({
      id: "action-reopen-tab",
      category: catActions,
      title: t("palette.items.reopenTabTitle"),
      subtitle: t("palette.items.reopenTabSubtitle"),
      shortcut: "Ctrl+Shift+T",
      icon: <RotateCcw className="w-4 h-4 text-fg-muted" />,
      action: () => {
        reopenLastClosedTab();
      },
    });

    if (tabs.length > 0) {
      list.push({
        id: "action-close-all-tabs",
        category: catActions,
        title: t("palette.items.closeAllTabsTitle"),
        subtitle: t("palette.items.closeAllTabsSubtitle"),
        icon: <X className="w-4 h-4 text-danger" />,
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
        category: t("palette.categories.openTabs"),
        title: tab.title,
        subtitle: `${tab.database}${tab.tableName ? ` • ${tab.tableName}` : ""} ${
          isCurrent ? t("palette.items.currentTabLabel") : t("palette.items.tabPositionLabel", { pos: index + 1 })
        }`,
        icon: <Layers className="w-4 h-4 text-fg-muted" />,
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
          category: t("palette.categories.connections"),
          title: conn.name,
          subtitle: `${conn.user}@${conn.host}:${conn.port} • ${conn.environment || "local"}${conn.database ? ` • db: ${conn.database}` : ""}`,
          icon: <Server className="w-4 h-4 text-fg-muted" />,
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
          category: t("palette.categories.recentQueries"),
          title: preview,
          subtitle: `${hist.database} • ${hist.durationMs} ms • ${new Date(hist.timestamp).toLocaleTimeString()}`,
          icon: <History className="w-4 h-4 text-fg-muted" />,
          action: () => {
            const queryCount = tabs.filter((tab) => tab.type === "query").length + 1;
            openTab({
              id: `query-hist-${uid()}`,
              title: t("palette.queryTabTitle", { n: queryCount }),
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
      dbTables.forEach((tbl) => {
        const isView = tbl.table_type === "VIEW";
        list.push({
          id: `obj-tbl-${db.name}-${tbl.name}`,
          category: t("palette.categories.tablesAndViews"),
          title: tbl.name,
          isTable: !isView,
          subtitle: `${db.name} • ${isView ? t("palette.items.viewLabel") : t("palette.items.tableLabel")}${
            tbl.rows_count !== undefined && tbl.rows_count !== null
              ? t("palette.items.approxRows", { count: tbl.rows_count.toLocaleString() as unknown as number })
              : ""
          }`,
          icon: isView ? (
            <Eye className="w-4 h-4 text-fg-muted" />
          ) : (
            <TableIcon className="w-4 h-4 text-fg-muted" />
          ),
          action: () => {
            setSelectedDatabase(db.name);
            loadSchemaObjects(db.name);
            openTab({
              id: `table-${db.name}-${tbl.name}`,
              title: tbl.name,
              type: "table",
              database: db.name,
              tableName: tbl.name,
            });
          },
        });
      });

      // Routines (Procedures & Functions)
      dbRoutines.forEach((r) => {
        const isFunc = r.routine_type === "FUNCTION";
        list.push({
          id: `obj-rtn-${db.name}-${r.name}`,
          category: t("palette.categories.routines"),
          title: r.name,
          subtitle: `${db.name} • ${isFunc ? t("palette.items.functionLabel") : t("palette.items.procedureLabel")}`,
          icon: isFunc ? (
            <FunctionSquare className="w-4 h-4 text-fg-muted" />
          ) : (
            <Settings className="w-4 h-4 text-fg-muted" />
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
          category: t("palette.categories.triggers"),
          title: tr.name,
          subtitle: `${db.name} • Trigger (${tr.timing} ${tr.event})`,
          icon: <Zap className="w-4 h-4 text-fg-muted" />,
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

      // Sequences
      const dbSequences = sequences[db.name] || [];
      dbSequences.forEach((seq) => {
        list.push({
          id: `obj-seq-${db.name}-${seq.name}`,
          category: t("palette.categories.sequences"),
          title: seq.name,
          subtitle: `${db.name} • ${t("palette.items.sequenceLabel")}`,
          icon: <Binary className="w-4 h-4 text-fg-muted" />,
          action: () => {
            setSelectedDatabase(db.name);
            const queryCount = tabs.filter((tab) => tab.type === "query").length + 1;
            openTab({
              id: `query-seq-${uid()}`,
              title: t("palette.queryTabTitle", { n: queryCount }),
              type: "query",
              database: db.name,
              queryContent: formatGeneratedSql(
                `SELECT NEXT VALUE FOR \`${db.name}\`.\`${seq.name}\` AS next_value;`,
              ),
            });
          },
        });
      });

      // Events
      const dbEvents = events[db.name] || [];
      dbEvents.forEach((ev) => {
        list.push({
          id: `obj-event-${db.name}-${ev.name}`,
          category: t("palette.categories.events"),
          title: ev.name,
          subtitle: `${db.name} • ${t("palette.items.eventLabel", { status: ev.status })}`,
          icon: <Calendar className="w-4 h-4 text-fg-muted" />,
          action: () => {
            setSelectedDatabase(db.name);
            const queryCount = tabs.filter((tab) => tab.type === "query").length + 1;
            openTab({
              id: `query-event-${uid()}`,
              title: t("palette.queryTabTitle", { n: queryCount }),
              type: "query",
              database: db.name,
              queryContent: formatGeneratedSql(`SHOW CREATE EVENT \`${db.name}\`.\`${ev.name}\`;`),
            });
          },
        });
      });
    });

    // ─── 6. Saved Queries ──────────────────────────────────────────────────
    const engine = connectionStatus.config?.engine;
    const savedQueries = favoritesStorage.getFavorites().filter((q) => {
      if (q.connectionId && activeConnectionId && q.connectionId !== activeConnectionId) return false;
      if (engine && !favoritesStorage.fitsActiveEngine(q, engine)) return false;
      return true;
    });
    savedQueries.forEach((q) => {
      list.push({
        id: `saved-query-${q.id}`,
        category: t("palette.categories.savedQueries"),
        title: q.title,
        subtitle: [q.database || activeDb, q.folder, q.description].filter(Boolean).join(" • ") || t("palette.items.savedQueryFallback"),
        sqlContent: q.sql,
        icon: <FileCode2 className="w-4 h-4 text-fg-muted" />,
        action: () => openSavedQuery(q, q.database || activeDb),
      });
    });

    return list;
  }, [
    t,
    snippets,
    activeDb,
    activeConnectionId,
    savedQueriesVersion,
    supportsFeature,
    capabilities,
    dialect,
    connectionStatus.is_connected,
    connectionStatus.config?.engine,
    databases,
    tables,
    routines,
    triggers,
    sequences,
    events,
    tabs,
    activeTabId,
    safeModeEnabled,
    noPrimaryKeyMode,
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

  // Filter items matching query with tiered priority:
  // Tier 3: Tables (active DB first)
  // Tier 2: All other items matching by title/subtitle/category (views, routines, saved query titles, commands...)
  // Tier 1: Items matching ONLY by SQL content (always last)
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
        let nameScore = Math.max(titleScore, subScore, catScore);

        if (nameScore > 0) {
          const tier = item.isTable ? 3 : 2;
          if (item.isTable && item.subtitle?.startsWith(`${activeDb} `)) {
            nameScore += 20;
          }
          return { item, tier, score: nameScore };
        }

        if (item.sqlContent && item.sqlContent.toLowerCase().includes(term)) {
          return { item, tier: 1, score: 10 };
        }

        return { item, tier: 0, score: 0 };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => (b.tier - a.tier) || (b.score - a.score));

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

  const diagnosticsModal = (
    <DiagnosticsModal isOpen={isDiagnosticsOpen} onClose={() => setIsDiagnosticsOpen(false)} />
  );

  if (!isCommandPaletteOpen) return diagnosticsModal;

  const selectedItem = filteredItems[selectedIndex];

  return (
    <>
    {diagnosticsModal}
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/60 animate-in fade-in duration-150 pt-16 select-none"
      onClick={closeCommandPalette}
    >
      <div
        className="bg-surface border border-line rounded-xl shadow-modal w-full max-w-2xl flex flex-col overflow-hidden text-fg"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Command Palette Header */}
        <div className="p-3.5 bg-raised border-b border-line flex items-center space-x-3">
          <Command className="w-4 h-4 shrink-0 text-fg-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder={t("palette.placeholder")}
            className="flex-1 bg-transparent text-sm text-fg placeholder:text-fg-subtle focus:outline-none font-mono"
          />
          <span className="text-[11px] text-fg-muted font-mono px-1.5 py-0.5 rounded bg-elevated border border-line-strong">
            ESC
          </span>
          <button
            type="button"
            onClick={closeCommandPalette}
            className={iconBtn}
            aria-label={t("palette.closeAria")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filtered Items List */}
        <div
          ref={listRef}
          className="max-h-[55vh] overflow-y-auto p-2 space-y-1 text-xs font-mono"
        >
          {filteredItems.length === 0 ? (
            <div className="py-12 text-center text-fg-subtle font-mono text-xs">
              {t("palette.emptySearch", { query })}
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
                      ? "bg-accent-soft text-fg border border-accent/40"
                      : "text-fg hover:bg-hover border border-transparent"
                  }`}
                >
                  <div className="flex items-center space-x-3 truncate mr-2">
                    <div
                      className={`p-1.5 rounded shrink-0 ${
                        isSelected ? "bg-accent-soft" : "bg-raised"
                      }`}
                    >
                      {item.icon}
                    </div>
                    <div className="truncate">
                      <div className="font-semibold text-xs text-fg truncate flex items-center space-x-2">
                        <span>{item.title}</span>
                      </div>
                      {item.subtitle && (
                        <div className="text-[11px] text-fg-muted truncate">
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-raised text-fg-muted border border-line">
                      {item.category}
                    </span>
                    {item.shortcut && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-elevated text-accent-text font-bold border border-line-strong">
                        {item.shortcut}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* SQL preview for selected query / snippet */}
        {selectedItem?.sqlContent && (
          <div className="px-3.5 py-2 bg-canvas border-t border-line max-h-20 overflow-hidden">
            <pre className="text-[11px] font-mono text-fg-muted whitespace-pre-wrap line-clamp-3">
              {selectedItem.sqlContent}
            </pre>
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-2 bg-raised border-t border-line flex items-center justify-between text-[11px] text-fg-subtle font-mono">
          <div className="flex items-center space-x-3">
            <span>{t("palette.footerNavigate")}</span>
            <span>{t("palette.footerSelect")}</span>
            <span>{t("palette.footerClose")}</span>
          </div>
          <span>{t("palette.footerCount", { count: filteredItems.length })}</span>
        </div>
      </div>
    </div>
    </>
  );
};
