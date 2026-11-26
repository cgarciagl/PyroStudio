import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
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
  category: string;
  action: string;
  description: string;
  keys: string[];
}

const isMac = typeof navigator !== "undefined" && /macintosh|mac os x/i.test(navigator.userAgent);
const modKey = isMac ? "⌘" : "Ctrl";

export const ShortcutsList: React.FC = () => {
  const { t } = useTranslation("settings");
  const [search, setSearch] = useState("");

  const shortcutRegistry: ShortcutItem[] = useMemo(() => {
    const generalCat = t("shortcuts.categories.general");
    const editorCat = t("shortcuts.categories.editor");
    const tabsCat = t("shortcuts.categories.tabs");
    return [
      {
        category: generalCat,
        action: t("shortcuts.items.globalPalette.action"),
        description: t("shortcuts.items.globalPalette.description"),
        keys: [modKey, "K"],
      },
      {
        category: generalCat,
        action: t("shortcuts.items.altPalette.action"),
        description: t("shortcuts.items.altPalette.description"),
        keys: [modKey, "Shift", "P"],
      },
      {
        category: generalCat,
        action: t("shortcuts.items.smartSearch.action"),
        description: t("shortcuts.items.smartSearch.description"),
        keys: [modKey, "Shift", "K"],
      },
      {
        category: generalCat,
        action: t("shortcuts.items.reopenTab.action"),
        description: t("shortcuts.items.reopenTab.description"),
        keys: ["Ctrl", "Shift", "T"],
      },
      {
        category: generalCat,
        action: t("shortcuts.items.settings.action"),
        description: t("shortcuts.items.settings.description"),
        keys: ["Ctrl", ","],
      },
      {
        category: generalCat,
        action: t("shortcuts.items.aiSettings.action"),
        description: t("shortcuts.items.aiSettings.description"),
        keys: ["Ctrl", "Shift", "A"],
      },
      {
        category: generalCat,
        action: t("shortcuts.items.viewShortcuts.action"),
        description: t("shortcuts.items.viewShortcuts.description"),
        keys: ["F1"],
      },
      {
        category: editorCat,
        action: t("shortcuts.items.runQuery.action"),
        description: t("shortcuts.items.runQuery.description"),
        keys: ["Ctrl", "Enter"],
      },
      {
        category: editorCat,
        action: t("shortcuts.items.explainPlan.action"),
        description: t("shortcuts.items.explainPlan.description"),
        keys: ["Ctrl", "Shift", "Enter"],
      },
      {
        category: editorCat,
        action: t("shortcuts.items.explainPlanAlt.action"),
        description: t("shortcuts.items.explainPlanAlt.description"),
        keys: ["Alt", "X"],
      },
      {
        category: editorCat,
        action: t("shortcuts.items.cancelQuery.action"),
        description: t("shortcuts.items.cancelQuery.description"),
        keys: ["Esc"],
      },
      {
        category: editorCat,
        action: t("shortcuts.items.queryHistory.action"),
        description: t("shortcuts.items.queryHistory.description"),
        keys: ["Ctrl", "H"],
      },
      {
        category: editorCat,
        action: t("shortcuts.items.favorites.action"),
        description: t("shortcuts.items.favorites.description"),
        keys: ["Ctrl", "S"],
      },
      {
        category: editorCat,
        action: t("shortcuts.items.fontZoom.action"),
        description: t("shortcuts.items.fontZoom.description"),
        keys: ["Ctrl", "+ / − / 0"],
      },
      {
        category: tabsCat,
        action: t("shortcuts.items.closeTab.action"),
        description: t("shortcuts.items.closeTab.description"),
        keys: ["Ctrl", "W"],
      },
      {
        category: tabsCat,
        action: t("shortcuts.items.middleClickClose.action"),
        description: t("shortcuts.items.middleClickClose.description"),
        keys: [t("shortcuts.keys.middleClick")],
      },
    ];
  }, [t]);

  const filteredShortcuts = useMemo(() => {
    if (!search.trim()) return shortcutRegistry;
    const q = search.toLowerCase();
    return shortcutRegistry.filter(
      (s) =>
        s.action.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.keys.some((k) => k.toLowerCase().includes(q)),
    );
  }, [search, shortcutRegistry]);

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
            placeholder={t("shortcuts.searchPlaceholder")}
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-raised border border-line rounded-md text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent transition-colors"
          />
        </div>
      </div>

      {/* Body / Categorized List */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {categories.length === 0 ? (
          <div className="text-center py-8 text-fg-subtle text-xs">
            {t("shortcuts.emptySearch", { query: search })}
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
  const { t } = useTranslation("settings");

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
      title={<>{t("shortcuts.modalTitle")}</>}
      subtitle={<>{t("shortcuts.modalSubtitle")}</>}
      icon={<Keyboard className="w-5 h-5" />}
      size="md"
      className="max-h-[85vh]"
      bodyClassName="flex flex-col overflow-hidden"
    >
      <ShortcutsList />
      <div className="px-6 py-3 border-t border-line bg-surface flex items-center justify-between text-[11px] text-fg-muted font-mono">
        <span>{t("shortcuts.tipBefore")} <kbd className="px-1.5 py-0.5 bg-raised rounded border border-line-strong text-fg">Ctrl+Shift+P</kbd></span>
        <button
          onClick={onClose}
          className={secondaryBtn}
        >
          {t("shortcuts.close")}
        </button>
      </div>
    </Modal>
  );
};
