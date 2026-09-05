import { useSyncExternalStore } from "react";
import { DEFAULT_APPEARANCE, validateAppearance, type Appearance } from "../../shared/appearance";
import { apiUrl } from "../utils/api";
export { DEFAULT_APPEARANCE, type Appearance };
type SyncState = "local" | "loading" | "saving" | "saved" | "error";
let account = "guest",
  epoch = 0,
  revision = 0;
let state: Appearance = { ...DEFAULT_APPEARANCE };
let syncState: SyncState = "local";
let pending = false,
  hydrated = false,
  saving = false,
  hydrating = false;
let dirtyKeys = new Set<keyof Appearance>();
let timer: ReturnType<typeof setTimeout> | undefined;
let controller = new AbortController();
const listeners = new Set<() => void>();
function read(): {
  appearance: Appearance;
  pending: boolean;
  exists: boolean;
  dirty?: Array<keyof Appearance>;
} {
  try {
    const cached = JSON.parse(localStorage.getItem(`rr:appearance:${account}`) ?? "null");
    if (!cached) return { appearance: { ...DEFAULT_APPEARANCE }, pending: false, exists: false };
    const { _pending, _dirty, ...appearance } = cached;
    return {
      appearance: validateAppearance(appearance),
      pending: Boolean(_pending),
      exists: true,
      dirty: Array.isArray(_dirty) ? _dirty : [],
    };
  } catch {
    return { appearance: { ...DEFAULT_APPEARANCE }, pending: false, exists: false };
  }
}
function persist() {
  try {
    localStorage.setItem(
      `rr:appearance:${account}`,
      JSON.stringify({ ...state, _pending: pending, _dirty: [...dirtyKeys] }),
    );
  } catch {
    /* The NAS remains the persistent store if browser storage is full. */
  }
}
function apply() {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.background = state.background;
  document.documentElement.style.setProperty(
    "--sidebar-opacity",
    String(1 - state.sidebarTransparency / 100),
  );
  document.documentElement.style.setProperty("--ah", String(state.hue));
  document.documentElement.style.setProperty("--ah-secondary", String((state.hue + 65) % 360));
  document.documentElement.style.setProperty("--ah-tertiary", String((state.hue + 180) % 360));
}
function notify() {
  apply();
  listeners.forEach((fn) => fn());
}
function scheduleSave() {
  clearTimeout(timer);
  timer = setTimeout(() => void save(), 650);
}
async function save() {
  if (account === "guest" || !hydrated || saving || !pending) return;
  const ownEpoch = epoch,
    ownRevision = revision,
    snapshot = state;
  saving = true;
  syncState = "saving";
  notify();
  try {
    const response = await fetch(apiUrl("/api/auth/appearance"), {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snapshot),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Save failed");
    if (epoch !== ownEpoch) return;
    pending = revision !== ownRevision;
    if (!pending) dirtyKeys.clear();
    syncState = pending ? "saving" : "saved";
    persist();
  } catch {
    if (epoch !== ownEpoch) return;
    syncState = "error";
    persist();
  } finally {
    if (epoch === ownEpoch) {
      saving = false;
      notify();
      if (pending && syncState !== "error") scheduleSave();
    }
  }
}
async function hydrate() {
  if (account === "guest" || saving || hydrating) return;
  hydrating = true;
  const ownEpoch = epoch,
    cached = read();
  syncState = "loading";
  notify();
  try {
    const response = await fetch(apiUrl("/api/auth/appearance"), {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Load failed");
    const data = await response.json();
    if (epoch !== ownEpoch) return;
    // Unsent local changes survive a failed connection and a later sign-in.
    if (data.appearance) {
      const remote = validateAppearance(data.appearance);
      const localPatch = Object.fromEntries([...dirtyKeys].map((key) => [key, state[key]]));
      state = validateAppearance({ ...remote, ...localPatch });
    } else if (cached.exists) pending = true;
    hydrated = true;
    syncState = pending ? "saving" : "saved";
    persist();
    notify();
    if (pending) scheduleSave();
  } catch {
    if (epoch === ownEpoch) {
      syncState = "error";
      notify();
    }
  } finally {
    if (epoch === ownEpoch) hydrating = false;
  }
}
export function setAppearanceAccount(email: string) {
  const next = email.toLowerCase();
  if (account === next) return;
  clearTimeout(timer);
  controller.abort();
  controller = new AbortController();
  account = next;
  ++epoch;
  revision = 0;
  saving = false;
  hydrated = false;
  hydrating = false;
  const cached = read();
  state = cached.appearance;
  pending = cached.pending;
  dirtyKeys = new Set(cached.dirty ?? []);
  syncState = account === "guest" ? "local" : "loading";
  notify();
  if (account !== "guest") void hydrate();
}
export function updateAppearance(patch: Partial<Appearance>) {
  state = validateAppearance({ ...state, ...patch });
  ++revision;
  for (const key of Object.keys(patch) as Array<keyof Appearance>) dirtyKeys.add(key);
  pending = account !== "guest";
  syncState = pending ? "saving" : "local";
  persist();
  notify();
  if (pending) {
    if (hydrated) scheduleSave();
    else void hydrate();
  }
}
export function retryAppearanceSync() {
  if (hydrated && pending) void save();
  else void hydrate();
}
if (typeof document !== "undefined") {
  state = read().appearance;
  apply();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && account !== "guest") {
      if (pending && hydrated) void save();
      else void hydrate();
    }
  });
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function useAppearance() {
  const appearance = useSyncExternalStore(
    subscribe,
    () => state,
    () => DEFAULT_APPEARANCE,
  );
  const syncStatus = useSyncExternalStore(
    subscribe,
    () => syncState,
    () => "local" as SyncState,
  );
  return { appearance, updateAppearance, syncStatus, retrySync: retryAppearanceSync };
}
