import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Braces, Plus, Search, Trash2 } from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import {
  describeSnippetBody,
  INSERT_SNIPPET_EVENT,
  newSnippetId,
  snippetsStorage,
  useSnippets,
  type SqlSnippet,
} from "../services/snippetsStorage";
import { useUIStore } from "../stores/uiStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useIsLightTheme } from "../stores/preferenceStore";
import { Modal, EmptyState } from "./ui/Modal";
import {
  dangerGhostBtn,
  fieldLabel,
  ghostBtn,
  inputClass,
  mutedText,
  primaryBtn,
  secondaryBtn,
} from "./ui/styles";

interface SnippetsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const emptyDraft = (): SqlSnippet => ({ id: newSnippetId(), prefix: "", name: "", body: "" });

export const SnippetsModal: React.FC<SnippetsModalProps> = ({ isOpen, onClose }) => {
  const snippets = useSnippets();
  const isLight = useIsLightTheme();
  const isFolderMode = useWorkspaceStore((s) => s.isFolderMode());
  const hasActiveQueryTab = useUIStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.type === "query");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SqlSnippet>(emptyDraft);
  const [filter, setFilter] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showMobileEditor, setShowMobileEditor] = useState(false);

  const selected = snippets.find((s) => s.id === selectedId);
  const isNew = !selected;
  const isDirty = isNew
    ? Boolean(draft.prefix || draft.name || draft.body)
    : JSON.stringify(selected) !== JSON.stringify(draft);

  useEffect(() => {
    if (!isOpen) return;
    setShowMobileEditor(false);
    void snippetsStorage.load(true).catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    setDraft(selected ? { ...selected } : emptyDraft());
    // Only when the selection changes; edits to `selected` from elsewhere don't clobber the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const prefixTaken = snippets.some(
    (s) => s.id !== draft.id && s.prefix.toLowerCase() === draft.prefix.trim().toLowerCase(),
  );
  const validationError = !draft.prefix.trim()
    ? "Indique un prefijo."
    : /\s/.test(draft.prefix.trim())
      ? "El prefijo no puede tener espacios."
      : prefixTaken
        ? "Ya existe un snippet con ese prefijo."
        : !draft.name.trim()
          ? "Indique un nombre."
          : !draft.body.trim()
            ? "El cuerpo está vacío."
            : null;

  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const list = [...snippets].sort((a, b) => a.prefix.localeCompare(b.prefix));
    return term
      ? list.filter((s) =>
          `${s.prefix} ${s.name} ${s.description ?? ""} ${s.body}`.toLowerCase().includes(term),
        )
      : list;
  }, [snippets, filter]);

  const reportError = (title: string, err: unknown) =>
    useUIStore.getState().showAlert({
      title,
      message: err instanceof Error ? err.message : String(err),
      variant: "warning",
      icon: "alert",
    });

  const save = async () => {
    if (validationError) return;
    setIsSaving(true);
    const next: SqlSnippet = {
      ...draft,
      prefix: draft.prefix.trim(),
      name: draft.name.trim(),
      description: draft.description?.trim() || undefined,
    };
    try {
      await snippetsStorage.update((list) =>
        list.some((s) => s.id === next.id) ? list.map((s) => (s.id === next.id ? next : s)) : [...list, next],
      );
      setSelectedId(next.id);
    } catch (err) {
      reportError("No se pudo guardar el snippet", err);
    } finally {
      setIsSaving(false);
    }
  };

  const remove = (snippet: SqlSnippet) => {
    useUIStore.getState().showConfirm({
      title: "Eliminar snippet",
      message: `¿Eliminar el snippet «${snippet.name}» (${snippet.prefix})?`,
      confirmText: "Eliminar",
      variant: "danger",
      icon: "trash",
      onConfirm: async () => {
        try {
          await snippetsStorage.update((list) => list.filter((s) => s.id !== snippet.id));
          if (selectedId === snippet.id) {
            setSelectedId(null);
            setShowMobileEditor(false);
          }
        } catch (err) {
          reportError("No se pudo eliminar el snippet", err);
        }
      },
    });
  };

  const insertSelected = () => {
    if (!selected) return;
    onClose();
    setTimeout(() => window.dispatchEvent(new CustomEvent(INSERT_SNIPPET_EVENT, { detail: selected })), 0);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Snippets SQL"
      subtitle={
        isFolderMode
          ? "Compartidos en el workspace (snippets/snippets.json)"
          : "Guardados en este equipo"
      }
      icon={<Braces className="w-4 h-4 text-fg-muted" />}
      size="lg"
      bodyClassName="p-0"
      footer={
        <>
          {hasActiveQueryTab && selected && !isDirty && (
            <button type="button" className={`${ghostBtn} mr-auto`} onClick={insertSelected}>
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>Insertar en editor</span>
            </button>
          )}
          <button type="button" className={secondaryBtn} onClick={onClose}>
            Cerrar
          </button>
          <button type="button" className={primaryBtn} onClick={save} disabled={!isDirty || !!validationError || isSaving}>
            {isNew ? "Crear snippet" : "Guardar cambios"}
          </button>
        </>
      }
    >
      <div className="@container flex h-[480px] min-h-0">
        {/* Sidebar list */}
        <div
          className={`${
            showMobileEditor ? "hidden @xl:flex" : "flex flex-1 @xl:flex-initial"
          } w-full @xl:w-64 shrink-0 border-r border-line bg-canvas flex-col min-h-0`}
        >
          <div className="p-2.5 space-y-2 border-b border-line bg-surface">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none" />
              <input
                type="search"
                className={`${inputClass} pl-8`}
                placeholder="Buscar prefijo, nombre o SQL…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <button
              type="button"
              className={`${ghostBtn} w-full justify-center`}
              onClick={() => {
                setSelectedId(null);
                setShowMobileEditor(true);
              }}
            >
              <Plus className="w-3.5 h-3.5" /> Nuevo snippet
            </button>
          </div>
          <div className="flex-1 overflow-auto py-1">
            {visible.map((s) => (
              <div
                key={s.id}
                onClick={() => {
                  setSelectedId(s.id);
                  setShowMobileEditor(true);
                }}
                className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs ${
                  s.id === selectedId ? "bg-accent-soft text-fg" : "text-fg hover:bg-hover"
                }`}
              >
                <code className="font-mono text-accent-text shrink-0">{s.prefix}</code>
                <span className="truncate text-fg-muted">{s.name}</span>
                <button
                  type="button"
                  className={`${dangerGhostBtn} ml-auto opacity-0 group-hover:opacity-100`}
                  title="Eliminar"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(s);
                  }}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
            {visible.length === 0 && (
              <EmptyState
                icon={<Braces className="w-6 h-6" />}
                title={filter.trim() ? "Sin coincidencias" : "Sin snippets"}
                description={filter.trim() ? "Prueba otro término de búsqueda." : undefined}
              />
            )}
          </div>
        </div>

        {/* Editor pane */}
        <div
          className={`${
            showMobileEditor ? "flex" : "hidden @xl:flex"
          } flex-1 min-w-0 p-4 flex-col gap-3 bg-surface overflow-y-auto`}
        >
          <div className="flex items-center justify-between @xl:hidden">
            <button type="button" className={ghostBtn} onClick={() => setShowMobileEditor(false)}>
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Lista de snippets</span>
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={fieldLabel}>Prefijo</label>
              <input
                className={`${inputClass} font-mono`}
                placeholder="sel"
                value={draft.prefix}
                onChange={(e) => setDraft({ ...draft, prefix: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <label className={fieldLabel}>Nombre</label>
              <input
                className={inputClass}
                placeholder="SELECT con filtro"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className={fieldLabel}>Descripción (opcional)</label>
            <input
              className={inputClass}
              value={draft.description ?? ""}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </div>
          <div className="flex-1 min-h-[160px] flex flex-col">
            <label className={fieldLabel}>Cuerpo</label>
            <div className="flex-1 min-h-0 border border-line rounded-md overflow-hidden bg-canvas">
              <CodeMirror
                value={draft.body}
                height="100%"
                className="h-full text-xs"
                theme={isLight ? "light" : "dark"}
                extensions={[sql()]}
                onChange={(body) => setDraft((d) => ({ ...d, body }))}
              />
            </div>
          </div>
          <p className={mutedText}>
            Escriba el prefijo en el editor y elíjalo en el autocompletado. <code>{"${campo}"}</code> marca
            un hueco que se recorre con Tab; <code>:variable</code> pide el valor al ejecutar.
            {draft.body && describeSnippetBody(draft.body) && <> Huecos y variables: {describeSnippetBody(draft.body)}.</>}
          </p>
          {isDirty && validationError && <p className="text-[11px] text-warning">{validationError}</p>}
        </div>
      </div>
    </Modal>
  );
};
