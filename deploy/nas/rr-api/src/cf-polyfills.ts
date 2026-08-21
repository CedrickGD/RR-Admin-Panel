// Workers-runtime globals the unchanged worker code touches but Node does not provide.
// Only `caches.default` (the edge cache used by the /media proxy) is needed; on the NAS there is
// no edge cache in front of the origin process, so it is a pass-through that never stores.

interface CacheLike {
  match(request: Request | string): Promise<Response | undefined>;
  put(request: Request | string, response: Response): Promise<void>;
  delete(request: Request | string): Promise<boolean>;
}

interface CacheStorageLike {
  default: CacheLike;
  open(name: string): Promise<CacheLike>;
}

const noopCache: CacheLike = {
  async match() {
    return undefined;
  },
  async put(_request, response) {
    // Drain the clone the worker hands over so its stream does not leak.
    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }
  },
  async delete() {
    return false;
  },
};

/** Installs a no-op `caches` global once; idempotent and never overrides a real implementation. */
export function installWorkersGlobals(): void {
  const globalRef = globalThis as typeof globalThis & { caches?: CacheStorageLike };
  if (globalRef.caches && typeof globalRef.caches === "object" && "default" in globalRef.caches) {
    return;
  }
  const storage: CacheStorageLike = {
    default: noopCache,
    async open() {
      return noopCache;
    },
  };
  Object.defineProperty(globalRef, "caches", {
    value: storage,
    configurable: true,
    writable: true,
    enumerable: false,
  });
}
