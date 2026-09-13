import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * One back model for everything that replaces the screen: Customer 360, every
 * ds/Modal dialog and the fullscreen map.
 *
 * Opening a layer pushes one history entry; the browser's (or the phone's) Back
 * pops it and closes the layer; closing the layer from inside (X, Escape,
 * Cancel) steps back over its own entry, so the entry never outlives what it
 * stands for. Layers nest: a dialog over Customer 360 sits one entry above it.
 *
 * Why onClose gets a reason: the hook only calls it when something OUTSIDE the
 * component closed the layer — a Back ("back"), a navigation to another page
 * ("navigate"), or the layer underneath closing ("parent"). A close the
 * component asked for itself (open → false) never calls onClose again.
 *
 * The stack is module state, not React state, because a Back press has to
 * close exactly the top layer no matter which component tree it lives in, and
 * the navbar's phone back arrow reads it through useTopHistoryLayer().
 */
export type HistoryLayerCloseReason = "back" | "navigate" | "parent";

export interface HistoryLayerOptions {
  /**
   * Names the layer's history entry. A Back/Forward that lands on an entry with
   * this key again — or a reload, which keeps history.state — adopts that entry
   * instead of pushing a second one. Layers without a key always push.
   */
  key?: string;
  /** URL of the pushed entry. Defaults to the current URL. */
  url?: () => string;
  /**
   * URL of the entry underneath. When the layer opens straight from an address
   * that already describes it (a deep link, a pasted URL), the current entry is
   * first rewritten to this, so closing the layer steps back onto the page and
   * not out of the app.
   */
  baseUrl?: () => string;
}

export interface HistoryLayerSnapshot {
  id: number;
  key: string | null;
}

interface LayerEntry {
  id: number;
  key: string | null;
  depth: number;
}

interface Layer extends LayerEntry {
  /** location.hash when the layer opened; another hash means the page changed under it. */
  hash: string;
  closed: boolean;
  /** Set by the effect cleanup, cleared by a StrictMode re-run of the same effect. */
  releasePending: boolean;
  onClose: { current: (reason: HistoryLayerCloseReason) => void };
}

const STATE_KEY = "rrLayer";

const stack: Layer[] = [];
const listeners = new Set<() => void>();
let snapshot: HistoryLayerSnapshot | null = null;
let nextId = 1;
let installed = false;
// history.back()/go() are asynchronous; until their popstate arrives,
// history.state still describes the entry being left.
let pendingTraversals = 0;
let expectedDepth = 0;
// Releases in one tick (a workspace and the dialog unmounting with it) are
// folded into ONE traversal: two back() calls in a row are not reliably two
// steps in every browser.
let traversalTarget: number | null = null;

function entryOf(state: unknown): LayerEntry | null {
  if (!state || typeof state !== "object") return null;
  const entry = (state as Record<string, unknown>)[STATE_KEY];
  if (!entry || typeof entry !== "object") return null;
  const { id, key, depth } = entry as Partial<LayerEntry>;
  if (typeof depth !== "number" || depth < 1) return null;
  return { id: typeof id === "number" ? id : 0, key: typeof key === "string" ? key : null, depth };
}

function currentDepth(): number {
  if (traversalTarget !== null) return traversalTarget;
  return pendingTraversals > 0 ? expectedDepth : (entryOf(history.state)?.depth ?? 0);
}

function runTraversal() {
  const target = traversalTarget;
  traversalTarget = null;
  if (target === null) return;
  const steps = (entryOf(history.state)?.depth ?? 0) - target;
  if (steps <= 0) return;
  pendingTraversals += 1;
  expectedDepth = target;
  if (steps === 1) history.back();
  else history.go(-steps);
}

function emit() {
  const top = stack[stack.length - 1];
  snapshot = top ? { id: top.id, key: top.key } : null;
  listeners.forEach((listener) => listener());
}

/** Closes every layer above `depth`, top first, and tells each owner why. */
function closeAbove(depth: number, reason: HistoryLayerCloseReason) {
  const removed: Layer[] = [];
  while (stack.length > 0 && stack[stack.length - 1].depth > depth) {
    const layer = stack.pop()!;
    layer.closed = true;
    removed.push(layer);
  }
  if (removed.length === 0) return;
  emit();
  removed.forEach((layer) => layer.onClose.current(reason));
}

function onPopState() {
  if (pendingTraversals > 0) pendingTraversals -= 1;
  closeAbove(entryOf(history.state)?.depth ?? 0, "back");
}

/**
 * A navigation to another page (sidebar link, typed hash) while a layer is
 * open: the new page's entry is already pushed, so the layer closes without
 * stepping back — which would undo that navigation. Its entry stays below the
 * new page, so Back from there returns to it.
 */
function onHashChange() {
  const removed: Layer[] = [];
  while (stack.length > 0 && stack[stack.length - 1].hash !== location.hash) {
    const layer = stack.pop()!;
    layer.closed = true;
    removed.push(layer);
  }
  if (removed.length === 0) return;
  emit();
  removed.forEach((layer) => layer.onClose.current("navigate"));
}

function install() {
  if (installed) return;
  installed = true;
  window.addEventListener("popstate", onPopState);
  window.addEventListener("hashchange", onHashChange);
}

function plainState(): Record<string, unknown> {
  const state = history.state;
  if (!state || typeof state !== "object") return {};
  const { [STATE_KEY]: _layer, ...rest } = state as Record<string, unknown>;
  return rest;
}

function openLayer(options: HistoryLayerOptions, onClose: Layer["onClose"]): Layer {
  install();
  const key = options.key ?? null;
  const top = stack[stack.length - 1];
  const current = entryOf(history.state);
  const adopt =
    key !== null &&
    pendingTraversals === 0 &&
    current !== null &&
    current.key === key &&
    current.depth > (top?.depth ?? 0);
  let depth: number;
  let id = nextId++;
  if (adopt) {
    depth = current.depth;
    id = current.id || id;
  } else {
    depth = currentDepth() + 1;
    const target = options.url?.() ?? location.href;
    const base = options.baseUrl?.();
    if (base !== undefined && base !== location.href) history.replaceState(history.state, "", base);
    history.pushState({ ...plainState(), [STATE_KEY]: { id, key, depth } }, "", target);
  }
  const layer: Layer = {
    id,
    key,
    depth,
    hash: location.hash,
    closed: false,
    releasePending: false,
    onClose,
  };
  const at = stack.findIndex((other) => other.depth > depth);
  if (at < 0) stack.push(layer);
  else stack.splice(at, 0, layer);
  emit();
  return layer;
}

/** The component closed its own layer: drop it (and anything above) and step back over its entry. */
function releaseLayer(layer: Layer) {
  if (layer.closed) return;
  const index = stack.indexOf(layer);
  const removed = index >= 0 ? stack.splice(index) : [layer];
  removed.forEach((entry) => {
    entry.closed = true;
  });
  emit();
  removed.forEach((entry) => {
    if (entry !== layer) entry.onClose.current("parent");
  });
  // A lower depth means the entry is already gone (a Back or a navigation took it).
  if (currentDepth() < layer.depth) return;
  const schedule = traversalTarget === null;
  traversalTarget = Math.min(traversalTarget ?? layer.depth - 1, layer.depth - 1);
  if (schedule) queueMicrotask(runTraversal);
}

/**
 * Ties `open` to one history entry. `onClose` runs when the layer is closed
 * from outside (see HistoryLayerCloseReason); the caller must then set `open`
 * to false.
 */
export function useHistoryLayer(
  open: boolean,
  onClose: (reason: HistoryLayerCloseReason) => void,
  options: HistoryLayerOptions = {},
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const layerRef = useRef<Layer | null>(null);

  useEffect(() => {
    if (!open) return;
    let layer = layerRef.current;
    if (layer && !layer.closed && layer.releasePending) {
      // StrictMode runs cleanup + effect back to back: the same layer carries on.
      layer.releasePending = false;
    } else if (!layer || layer.closed) {
      layer = openLayer(optionsRef.current, onCloseRef);
      layerRef.current = layer;
    }
    const owned = layer;
    return () => {
      owned.releasePending = true;
      queueMicrotask(() => {
        if (!owned.releasePending) return;
        owned.releasePending = false;
        releaseLayer(owned);
      });
    };
  }, [open]);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The layer a Back press would close, or null. Drives the navbar's phone back arrow. */
export function useTopHistoryLayer(): HistoryLayerSnapshot | null {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => null,
  );
}

/** Test seam: forget every layer and pending traversal. */
export function resetHistoryLayers() {
  stack.splice(0);
  pendingTraversals = 0;
  expectedDepth = 0;
  traversalTarget = null;
  emit();
}
