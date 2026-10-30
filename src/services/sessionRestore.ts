import { useConnectionStore } from "../stores/connectionStore";
import { useUIStore } from "../stores/uiStore";
import type { ConnectionConfig, ConnectionInfo, OpenTab } from "../types/database";

/**
 * Open tabs per connection, saved on this computer (they are not shared through
 * the workspace) and restored the next time the user connects. Query tabs keep
 * their SQL, so an unsaved draft survives a crash or an accidental close.
 * Restoring never connects by itself: it only runs after the user connected.
 */
const STORAGE_KEY = "pyro_session_tabs_v1";
const SAVE_DELAY_MS = 1000;
const MAX_TABS = 50;

interface SavedSession {
  tabs: OpenTab[];
  activeTabId: string | null;
  savedAt: number;
}

/**
 * Identifies a server (or SQLite file) and user. Built only from fields present both in
 * the config sent on connect and in the status read back after a window reload.
 */
export function sessionKey(config: ConnectionConfig | ConnectionInfo | undefined): string | null {
  if (!config) return null;
  const user = ("username" in config ? config.username : undefined) || config.user || "";
  return [config.engine ?? "mysql", config.file_path ?? "", config.host, config.port, user].join("|");
}

function readAll(): Record<string, SavedSession> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Record<string, SavedSession>;
  } catch {
    return {};
  }
}

function writeSession(key: string, session: SavedSession) {
  try {
    const all = readAll();
    all[key] = session;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (err) {
    // Quota or private mode: losing the session is not worth an error dialog.
    console.warn("No se pudo guardar la sesión:", err);
  }
}

/** Tabs worth reopening; pinned ones first, as the tab bar shows them. */
export function serializableTabs(tabs: OpenTab[]): OpenTab[] {
  return tabs.slice(0, MAX_TABS).map((t) => ({ ...t }));
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** Key whose session is on screen; null until it was restored (or found empty). */
let activeKey: string | null = null;

function saveNow() {
  timer = null;
  const { connectionStatus } = useConnectionStore.getState();
  const key = sessionKey(connectionStatus.config);
  // Only save the session that was restored for this connection, so a fresh
  // (still empty) tab bar never overwrites the saved one.
  if (!connectionStatus.is_connected || !key || key !== activeKey) return;
  const { tabs, activeTabId } = useUIStore.getState();
  writeSession(key, { tabs: serializableTabs(tabs), activeTabId, savedAt: Date.now() });
}

/** Starts saving tab changes (debounced). Returns the unsubscribe function. */
export function startSessionPersistence(): () => void {
  const unsubscribe = useUIStore.subscribe((state, prev) => {
    if (state.tabs === prev.tabs && state.activeTabId === prev.activeTabId) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(saveNow, SAVE_DELAY_MS);
  });
  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      saveNow();
    }
  };
  window.addEventListener("beforeunload", flush);
  return () => {
    unsubscribe();
    window.removeEventListener("beforeunload", flush);
    flush();
  };
}

/** Called before disconnecting: saves pending changes, then stops tracking. */
export function endSession() {
  if (timer) clearTimeout(timer);
  saveNow();
  activeKey = null;
}

/**
 * Reopens the saved tabs of the connection just established. Returns how many
 * tabs came back and how many of them hold unsaved query edits.
 */
export function restoreSession(config: ConnectionConfig | ConnectionInfo | undefined): { tabs: number; drafts: number } {
  const key = sessionKey(config);
  activeKey = key;
  if (!key) return { tabs: 0, drafts: 0 };
  const ui = useUIStore.getState();
  const saved = readAll()[key];
  if (!saved || saved.tabs.length === 0 || ui.tabs.length > 0) return { tabs: 0, drafts: 0 };

  const tabs = serializableTabs(saved.tabs);
  const activeTabId = tabs.some((t) => t.id === saved.activeTabId) ? saved.activeTabId : tabs[0].id;
  useUIStore.setState({ tabs, activeTabId });
  return {
    tabs: tabs.length,
    drafts: tabs.filter((t) => t.type === "query" && t.isModified).length,
  };
}
