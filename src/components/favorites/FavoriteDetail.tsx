import React, { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, Copy, FolderInput, MoreHorizontal, Pencil, Play, SquarePlus, Trash2 } from "lucide-react";
import type { SqlFavorite } from "../../types/database";
import { ghostBtn, iconBtn, inputClass, menuIcon, menuItem, menuPanel, menuSeparator, primaryBtn, secondaryBtn } from "../ui/styles";
import { reportError } from "../../utils/errors";

interface FavoriteDetailProps {
  fav: SqlFavorite;
  /** Where it lives: category, database, built-in… */
  meta: string[];
  /** File in the workspace, when it is one. */
  filePath?: string;
  canDelete: boolean;
  /** Category names for the rename suggestions. */
  categories: string[];
  onRun: () => void;
  onRunInNewTab: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRename: (title: string, category: string) => Promise<void> | void;
}

/** Selected query: full SQL, one primary action and the rest in a menu. */
export function FavoriteDetail({
  fav,
  meta,
  filePath,
  canDelete,
  categories,
  onRun,
  onRunInNewTab,
  onOpen,
  onEdit,
  onDelete,
  onRename,
}: FavoriteDetailProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [renaming, setRenaming] = useState<{ title: string; category: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // A different query is shown: drop the transient UI of the previous one.
  useEffect(() => {
    setRenaming(null);
    setMenuOpen(false);
    setCopied(false);
  }, [fav.id]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const copy = () => {
    navigator.clipboard.writeText(fav.sql).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      (err) => reportError("No se pudo copiar el SQL", err),
    );
  };

  // Escape closes the open menu first.
  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && menuOpen) {
      e.preventDefault();
      setMenuOpen(false);
    }
  };

  const menuAction = (fn: () => void) => () => {
    setMenuOpen(false);
    fn();
  };

  return (
    <div data-favorite-detail className="flex-1 flex flex-col min-h-0">
      <div className="px-4 pt-3 pb-2 space-y-1">
        {renaming ? (
          <form
            className="flex flex-wrap items-center gap-1.5"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!renaming.title.trim()) return;
              await onRename(renaming.title, renaming.category);
              setRenaming(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                // Close the rename only, not the whole panel.
                e.preventDefault();
                setRenaming(null);
              }
            }}
          >
            <input
              autoFocus
              value={renaming.title}
              onChange={(e) => setRenaming({ ...renaming, title: e.target.value })}
              aria-label="Título"
              className={`${inputClass} flex-1 min-w-[10rem] w-auto`}
            />
            <input
              list="fav-categories"
              value={renaming.category}
              onChange={(e) => setRenaming({ ...renaming, category: e.target.value })}
              aria-label="Categoría o carpeta"
              placeholder="Categoría"
              className={`${inputClass} w-36`}
            />
            <datalist id="fav-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <button type="submit" className={secondaryBtn}>
              Guardar
            </button>
            <button type="button" onClick={() => setRenaming(null)} className={ghostBtn}>
              Cancelar
            </button>
          </form>
        ) : (
          <h3 className="text-sm font-semibold text-fg break-words">{fav.title}</h3>
        )}
        <p className="text-[11px] text-fg-muted flex flex-wrap gap-x-1.5">
          {meta.map((m, i) => (
            <React.Fragment key={m}>
              {i > 0 && <span aria-hidden className="text-fg-subtle">·</span>}
              <span className="truncate max-w-full">{m}</span>
            </React.Fragment>
          ))}
          {filePath && (
            <>
              <span aria-hidden className="text-fg-subtle">·</span>
              <span className="font-mono truncate max-w-full" title="Archivo en el espacio de trabajo">
                {filePath}
              </span>
            </>
          )}
        </p>
        {fav.description && <p className="text-xs text-fg-muted leading-relaxed">{fav.description}</p>}
      </div>

      {/* Sized to the SQL (short queries no longer leave an empty box); scrolls when long. */}
      <div className="flex-1 min-h-0 px-4">
        <pre
          aria-label="SQL de la consulta"
          className="max-h-full overflow-auto rounded-md border border-line bg-canvas p-3 font-mono text-[11px] leading-relaxed text-fg whitespace-pre-wrap select-text"
        >
          {fav.sql}
        </pre>
      </div>

      <div className="px-4 py-3 flex items-center gap-2">
        <div className="relative" ref={menuRef} onKeyDown={onMenuKey}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Más acciones"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Más acciones"
            className={iconBtn}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {menuOpen && (
            <div role="menu" className={`${menuPanel} left-0 right-auto bottom-full mb-1 mt-0`}>
              <button role="menuitem" className={menuItem} onClick={menuAction(copy)}>
                <Copy className={menuIcon} /> Copiar SQL
              </button>
              <button
                role="menuitem"
                className={menuItem}
                onClick={menuAction(() => setRenaming({ title: fav.title, category: fav.category }))}
              >
                <FolderInput className={menuIcon} /> Renombrar o mover
              </button>
              <button role="menuitem" className={menuItem} onClick={menuAction(onEdit)}>
                <Pencil className={menuIcon} /> Editar SQL y detalles
              </button>
              {canDelete && (
                <>
                  <div className={menuSeparator} />
                  <button role="menuitem" className={menuItem.replace("text-fg", "text-danger")} onClick={menuAction(onDelete)}>
                    <Trash2 className="w-3.5 h-3.5 shrink-0" /> Eliminar
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {copied && (
          <span role="status" className="flex items-center gap-1 text-[11px] text-fg-muted">
            <Check className="w-3 h-3 text-success" /> Copiado
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpen}
            title="Abrir en su pestaña para editarla (Ctrl+S guarda los cambios)"
            className={ghostBtn}
          >
            <ArrowUpRight className="w-3.5 h-3.5" /> Abrir
          </button>
          <button type="button" onClick={onRunInNewTab} title="Ejecutar en una pestaña nueva (Ctrl+Enter)" className={secondaryBtn}>
            <SquarePlus className="w-3.5 h-3.5" /> Nueva pestaña
          </button>
          <button type="button" onClick={onRun} title="Ejecutar en esta pestaña (Enter)" className={primaryBtn}>
            <Play className="w-3.5 h-3.5 fill-current" /> Ejecutar
          </button>
        </div>
      </div>
    </div>
  );
}
