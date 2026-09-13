import { StrictMode, act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "../src/components/ds/Modal";
import {
  navigateOverLayers,
  resetHistoryLayers,
  useHistoryLayer,
  useTopHistoryLayer,
  type HistoryLayerCloseReason,
  type HistoryLayerOptions,
} from "../src/hooks/useHistoryLayer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * A synchronous stand-in for the session history. jsdom's own traversal is
 * asynchronous and cannot be observed entry by entry, so pushState/replaceState/
 * back/go and history.state are replaced by an array the tests can inspect.
 * `browserBack()` is the user pressing Back: it moves through the same entries
 * but does not count as a call the hook made.
 */
function fakeHistory() {
  const entries: Array<{ state: unknown; url: string }> = [{ state: null, url: location.href }];
  let index = 0;
  const traverse = (delta: number) => {
    index = Math.max(0, Math.min(entries.length - 1, index + delta));
    window.dispatchEvent(new PopStateEvent("popstate", { state: entries[index].state }));
  };
  Object.defineProperty(history, "state", {
    configurable: true,
    get: () => entries[index].state,
  });
  const pushState = vi
    .spyOn(history, "pushState")
    .mockImplementation((state: unknown, _title: string, url?: string | URL | null) => {
      entries.splice(index + 1);
      entries.push({ state, url: String(url ?? entries[index].url) });
      index += 1;
    });
  const replaceState = vi
    .spyOn(history, "replaceState")
    .mockImplementation((state: unknown, _title: string, url?: string | URL | null) => {
      entries[index] = { state, url: String(url ?? entries[index].url) };
    });
  const back = vi.spyOn(history, "back").mockImplementation(() => traverse(-1));
  const go = vi.spyOn(history, "go").mockImplementation((delta?: number) => traverse(delta ?? 0));
  return {
    entries,
    index: () => index,
    pushState,
    replaceState,
    back,
    go,
    browserBack: () => traverse(-1),
    browserForward: () => traverse(1),
    browserGo: (delta: number) => traverse(delta),
  };
}

let root: Root;
let container: HTMLDivElement;
let fake: ReturnType<typeof fakeHistory>;

beforeEach(() => {
  resetHistoryLayers();
  fake = fakeHistory();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  delete (history as { state?: unknown }).state;
  resetHistoryLayers();
});

/** Flushes effects and the microtask a close is released on. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

type Control = { setOpen: (open: boolean) => void };

/** A layer owned the way real callers own one: state flips false on onClose. */
function Layer({
  name,
  initial = true,
  options,
  control,
  closes,
  children,
}: {
  name: string;
  initial?: boolean;
  options?: HistoryLayerOptions;
  control: Record<string, Control>;
  closes: Array<[string, HistoryLayerCloseReason]>;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(initial);
  control[name] = { setOpen };
  useHistoryLayer(
    open,
    (reason) => {
      closes.push([name, reason]);
      setOpen(false);
    },
    options,
  );
  return open ? <>{children}</> : null;
}

/** The rrLayer depth of every recorded entry, oldest first. */
function depths() {
  return fake.entries.map(
    (entry) => (entry.state as { rrLayer?: { depth: number } } | null)?.rrLayer?.depth ?? 0,
  );
}

function buttonNamed(name: string): HTMLButtonElement | null {
  return (
    [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === name,
    ) ?? null
  );
}

/** A form dialog with unsaved edits, owned like CustomerAccessDialog owns its Modal. */
function DirtyDialog({
  control,
  onClosed,
}: {
  control: Record<string, Control>;
  onClosed: () => void;
}) {
  const [open, setOpen] = useState(false);
  control.dialog = { setOpen };
  return (
    <Modal
      open={open}
      onClose={() => {
        onClosed();
        setOpen(false);
      }}
      isDirty={() => true}
      title="Edit access"
    >
      <input defaultValue="typed, not saved" />
    </Modal>
  );
}

function TopProbe({ seen }: { seen: Array<string | null> }) {
  const top = useTopHistoryLayer();
  seen.push(top ? String(top.key ?? top.id) : null);
  return null;
}

describe("useHistoryLayer", () => {
  it("pushes one entry when a layer opens and exposes it as the top layer", async () => {
    const control: Record<string, Control> = {};
    const closes: Array<[string, HistoryLayerCloseReason]> = [];
    const seen: Array<string | null> = [];
    await act(async () =>
      root.render(
        <>
          <Layer name="dialog" options={{ key: "dialog" }} control={control} closes={closes} />
          <TopProbe seen={seen} />
        </>,
      ),
    );
    await flush();
    expect(fake.pushState).toHaveBeenCalledTimes(1);
    expect(fake.entries[1].state).toMatchObject({ rrLayer: { key: "dialog", depth: 1 } });
    expect(seen.at(-1)).toBe("dialog");
    expect(closes).toEqual([]);
  });

  it("steps back exactly once when the component closes its own layer (X, Escape)", async () => {
    const control: Record<string, Control> = {};
    const closes: Array<[string, HistoryLayerCloseReason]> = [];
    const seen: Array<string | null> = [];
    await act(async () =>
      root.render(
        <>
          <Layer name="dialog" control={control} closes={closes} />
          <TopProbe seen={seen} />
        </>,
      ),
    );
    await flush();
    await act(async () => control.dialog.setOpen(false));
    await flush();
    expect(fake.back).toHaveBeenCalledTimes(1);
    expect(fake.go).not.toHaveBeenCalled();
    expect(fake.index()).toBe(0);
    // The component asked for the close itself, so it is not told again.
    expect(closes).toEqual([]);
    expect(seen.at(-1)).toBeNull();
  });

  it("closes the layer once on Back and never pushes its entry again", async () => {
    const control: Record<string, Control> = {};
    const closes: Array<[string, HistoryLayerCloseReason]> = [];
    await act(async () => root.render(<Layer name="dialog" control={control} closes={closes} />));
    await flush();
    await act(async () => fake.browserBack());
    await flush();
    expect(closes).toEqual([["dialog", "back"]]);
    expect(fake.pushState).toHaveBeenCalledTimes(1);
    // The entry is already gone: closing must not step back a second time.
    expect(fake.back).not.toHaveBeenCalled();
    expect(fake.index()).toBe(0);
  });

  it("does not step back when the layer unmounts after a Back already closed it", async () => {
    function Host({ mounted, onBack }: { mounted: boolean; onBack: () => void }) {
      return mounted ? <Unowned onBack={onBack} /> : null;
    }
    // A caller that ignores onClose and is simply unmounted afterwards.
    function Unowned({ onBack }: { onBack: () => void }) {
      useHistoryLayer(true, onBack);
      return null;
    }
    const onBack = vi.fn();
    await act(async () => root.render(<Host mounted onBack={onBack} />));
    await flush();
    await act(async () => fake.browserBack());
    expect(onBack).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<Host mounted={false} onBack={onBack} />));
    await flush();
    expect(fake.back).not.toHaveBeenCalled();
    expect(fake.go).not.toHaveBeenCalled();
    expect(fake.index()).toBe(0);
  });

  it("nests: Back closes only the top layer, closing a parent takes the layer above along", async () => {
    const control: Record<string, Control> = {};
    const closes: Array<[string, HistoryLayerCloseReason]> = [];
    const seen: Array<string | null> = [];
    // Siblings, not parent/child: the dialog is a portal-like layer that is NOT
    // unmounted with the workspace, so it has to hear "parent" from the hook.
    await act(async () =>
      root.render(
        <>
          <Layer
            name="workspace"
            options={{ key: "workspace" }}
            control={control}
            closes={closes}
          />
          <Layer
            name="dialog"
            initial={false}
            options={{ key: "dialog" }}
            control={control}
            closes={closes}
          />
          <TopProbe seen={seen} />
        </>,
      ),
    );
    await flush();
    await act(async () => control.dialog.setOpen(true));
    await flush();
    expect(
      fake.entries.map(
        (entry) => (entry.state as { rrLayer?: { depth: number } } | null)?.rrLayer?.depth ?? 0,
      ),
    ).toEqual([0, 1, 2]);
    expect(seen.at(-1)).toBe("dialog");

    await act(async () => fake.browserBack());
    await flush();
    expect(closes).toEqual([["dialog", "back"]]);
    expect(seen.at(-1)).toBe("workspace");

    // Reopen the dialog, then close the workspace underneath it from inside.
    await act(async () => control.dialog.setOpen(true));
    await flush();
    expect(fake.index()).toBe(2);
    await act(async () => control.workspace.setOpen(false));
    await flush();
    expect(closes).toEqual([
      ["dialog", "back"],
      ["dialog", "parent"],
    ]);
    // One traversal over both entries, not two racing back() calls.
    expect(fake.go).toHaveBeenCalledTimes(1);
    expect(fake.go).toHaveBeenCalledWith(-2);
    expect(fake.back).not.toHaveBeenCalled();
    expect(fake.index()).toBe(0);
    expect(seen.at(-1)).toBeNull();
  });

  it("closes on a hash change to another page without stepping back over that navigation", async () => {
    const control: Record<string, Control> = {};
    const closes: Array<[string, HistoryLayerCloseReason]> = [];
    location.hash = "#/customers";
    await act(async () =>
      root.render(<Layer name="workspace" control={control} closes={closes} />),
    );
    await flush();
    location.hash = "#/licenses";
    await act(async () => window.dispatchEvent(new HashChangeEvent("hashchange")));
    await flush();
    expect(closes).toEqual([["workspace", "navigate"]]);
    expect(fake.back).not.toHaveBeenCalled();
    expect(fake.go).not.toHaveBeenCalled();
    location.hash = "";
  });

  it("pushes once under StrictMode and still steps back once on close", async () => {
    const control: Record<string, Control> = {};
    const closes: Array<[string, HistoryLayerCloseReason]> = [];
    await act(async () =>
      root.render(
        <StrictMode>
          <Layer name="dialog" control={control} closes={closes} />
        </StrictMode>,
      ),
    );
    await flush();
    expect(fake.pushState).toHaveBeenCalledTimes(1);
    expect(fake.back).not.toHaveBeenCalled();
    await act(async () => control.dialog.setOpen(false));
    await flush();
    expect(fake.back).toHaveBeenCalledTimes(1);
    expect(closes).toEqual([]);
  });

  it("adopts its own entry when Back/Forward lands on it again instead of pushing a duplicate", async () => {
    const control: Record<string, Control> = {};
    const closes: Array<[string, HistoryLayerCloseReason]> = [];
    await act(async () =>
      root.render(
        <Layer name="workspace" options={{ key: "workspace" }} control={control} closes={closes} />,
      ),
    );
    await flush();
    // Another page is pushed on top (e.g. "Manage licenses"), which closes the workspace…
    await act(async () => {
      history.pushState(null, "", location.href);
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    await flush();
    expect(closes).toEqual([["workspace", "back"]]);
    expect(fake.back).not.toHaveBeenCalled();
    // …and Back from that page lands on the workspace entry, which reopens it.
    await act(async () => fake.browserBack());
    await act(async () => control.workspace.setOpen(true));
    await flush();
    expect(fake.pushState).toHaveBeenCalledTimes(2);
    expect(fake.index()).toBe(1);
    await act(async () => control.workspace.setOpen(false));
    await flush();
    expect(fake.back).toHaveBeenCalledTimes(1);
    expect(fake.index()).toBe(0);
  });

  it("opened from an address that already describes it, keeps the page underneath", async () => {
    const control: Record<string, Control> = {};
    const closes: Array<[string, HistoryLayerCloseReason]> = [];
    await act(async () =>
      root.render(
        <Layer
          name="workspace"
          options={{
            key: "workspace",
            url: () => "http://localhost:3000/?customer=a#/customers",
            baseUrl: () => "http://localhost:3000/#/customers",
          }}
          control={control}
          closes={closes}
        />,
      ),
    );
    await flush();
    expect(fake.entries.map((entry) => entry.url)).toEqual([
      "http://localhost:3000/#/customers",
      "http://localhost:3000/?customer=a#/customers",
    ]);
  });
});

describe("a layer that keeps itself open on Back", () => {
  it("holds the layer when onClose returns false and takes a new entry on retain()", async () => {
    const calls: Array<[HistoryLayerCloseReason, boolean]> = [];
    let retain = () => {};
    function Guarded() {
      const [open, setOpen] = useState(true);
      const layer = useHistoryLayer(open, (reason, canStay) => {
        calls.push([reason, canStay]);
        if (canStay) return false;
        setOpen(false);
      });
      retain = layer.retain;
      return open ? <p>guarded</p> : null;
    }
    const seen: Array<string | null> = [];
    await act(async () =>
      root.render(
        <>
          <Guarded />
          <TopProbe seen={seen} />
        </>,
      ),
    );
    await flush();
    const own = seen.at(-1);
    expect(own).not.toBeNull();

    await act(async () => fake.browserBack());
    await flush();
    expect(calls).toEqual([["back", true]]);
    expect(container.textContent).toBe("guarded");
    // Still the top layer while it waits, but its entry is spent.
    expect(seen.at(-1)).toBe(own);
    expect(fake.index()).toBe(0);

    await act(async () => retain());
    await flush();
    expect(fake.pushState).toHaveBeenCalledTimes(2);
    expect(fake.index()).toBe(1);
    expect(depths()).toEqual([0, 1]);
    // retain() on a layer that has its entry is a no-op.
    await act(async () => retain());
    expect(fake.pushState).toHaveBeenCalledTimes(2);

    // The next Back targets the layer again.
    await act(async () => fake.browserBack());
    await flush();
    expect(calls).toEqual([
      ["back", true],
      ["back", true],
    ]);
    expect(container.textContent).toBe("guarded");
  });

  it("a second Back while the layer waits cannot keep it open", async () => {
    history.pushState(null, "", location.href);
    const calls: Array<[HistoryLayerCloseReason, boolean]> = [];
    function Guarded() {
      const [open, setOpen] = useState(true);
      useHistoryLayer(open, (reason, canStay) => {
        calls.push([reason, canStay]);
        if (canStay) return false;
        setOpen(false);
      });
      return open ? <p>guarded</p> : null;
    }
    await act(async () => root.render(<Guarded />));
    await flush();
    await act(async () => fake.browserBack());
    await flush();
    await act(async () => fake.browserBack());
    await flush();
    expect(calls).toEqual([
      ["back", true],
      ["back", false],
    ]);
    expect(container.textContent).toBe("");
    expect(fake.index()).toBe(0);
    expect(fake.back).not.toHaveBeenCalled();
    expect(fake.go).not.toHaveBeenCalled();
  });
});

describe("ds/Modal with unsaved changes on the history layer", () => {
  async function openDirtyDialogOverWorkspace() {
    const control: Record<string, Control> = {};
    const closes: Array<[string, HistoryLayerCloseReason]> = [];
    const seen: Array<string | null> = [];
    const onClosed = vi.fn();
    await act(async () =>
      root.render(
        <>
          <Layer
            name="workspace"
            options={{ key: "workspace" }}
            control={control}
            closes={closes}
          />
          <DirtyDialog control={control} onClosed={onClosed} />
          <TopProbe seen={seen} />
        </>,
      ),
    );
    await flush();
    await act(async () => control.dialog.setOpen(true));
    await flush();
    expect(depths()).toEqual([0, 1, 2]);
    const dialogTop = seen.at(-1);
    expect(dialogTop).not.toBe("workspace");
    return { closes, seen, onClosed, dialogTop };
  }

  it("Back → Keep editing takes a new entry, so the next Back asks again instead of closing the workspace", async () => {
    const { closes, seen, onClosed, dialogTop } = await openDirtyDialogOverWorkspace();

    await act(async () => fake.browserBack());
    await flush();
    expect(buttonNamed("Keep editing")).not.toBeNull();
    expect(onClosed).not.toHaveBeenCalled();
    expect(fake.index()).toBe(1);

    await act(async () => buttonNamed("Keep editing")!.click());
    await flush();
    expect(buttonNamed("Keep editing")).toBeNull();
    expect(fake.pushState).toHaveBeenCalledTimes(3);
    expect(fake.index()).toBe(2);
    expect(depths()).toEqual([0, 1, 2]);
    expect(fake.entries[2].url).toBe(fake.entries[1].url);
    expect(seen.at(-1)).toBe(dialogTop);

    await act(async () => fake.browserBack());
    await flush();
    // The prompt again — not the workspace underneath closing.
    expect(buttonNamed("Keep editing")).not.toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(closes).toEqual([]);
    expect(onClosed).not.toHaveBeenCalled();
    expect(fake.index()).toBe(1);
    expect(seen.at(-1)).toBe(dialogTop);
    expect(fake.back).not.toHaveBeenCalled();
    expect(fake.go).not.toHaveBeenCalled();
  });

  it("Back → Discard closes the dialog without stepping back again (its entry is already spent)", async () => {
    const { closes, seen, onClosed } = await openDirtyDialogOverWorkspace();

    await act(async () => fake.browserBack());
    await flush();
    await act(async () => buttonNamed("Discard")!.click());
    await flush();
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(fake.back).not.toHaveBeenCalled();
    expect(fake.go).not.toHaveBeenCalled();
    expect(fake.pushState).toHaveBeenCalledTimes(2);
    expect(fake.index()).toBe(1);
    expect(closes).toEqual([]);
    expect(seen.at(-1)).toBe("workspace");
  });

  it("Escape on a Back-triggered prompt keeps editing and takes a new entry too", async () => {
    const { closes, seen, dialogTop } = await openDirtyDialogOverWorkspace();

    await act(async () => fake.browserBack());
    await flush();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flush();
    expect(buttonNamed("Keep editing")).toBeNull();
    expect(fake.index()).toBe(2);
    expect(seen.at(-1)).toBe(dialogTop);
    expect(closes).toEqual([]);
  });
});

describe("adopting an entry from the recorded chain", () => {
  const customer = { id: 101, key: "customer" };
  const dialog = { id: 102, key: null };
  const customerUrl = "http://localhost:3000/?customer=a&customerBy=hwid#/customers";

  /** What a reload leaves behind: the page, Customer 360, and a keyless dialog above it (current). */
  function reloadedOverDialog() {
    history.pushState({ rrLayer: { ...customer, depth: 1, chain: [customer] } }, "", customerUrl);
    history.pushState(
      { rrLayer: { ...dialog, depth: 2, chain: [customer, dialog] } },
      "",
      customerUrl,
    );
    fake.pushState.mockClear();
    fake.replaceState.mockClear();
  }

  function CustomerLayer({
    control,
    closes,
  }: {
    control: Record<string, Control>;
    closes: Array<[string, HistoryLayerCloseReason]>;
  }) {
    return (
      <Layer
        name="customer"
        options={{ key: "customer", url: () => customerUrl, baseUrl: () => fake.entries[0].url }}
        control={control}
        closes={closes}
      />
    );
  }

  it("after a reload over a keyless dialog, adopts its own entry below instead of pushing a copy", async () => {
    reloadedOverDialog();
    const control: Record<string, Control> = {};
    const closes: Array<[string, HistoryLayerCloseReason]> = [];
    const seen: Array<string | null> = [];
    await act(async () =>
      root.render(
        <>
          <CustomerLayer control={control} closes={closes} />
          <TopProbe seen={seen} />
        </>,
      ),
    );
    await flush();
    expect(fake.pushState).not.toHaveBeenCalled();
    expect(fake.replaceState).not.toHaveBeenCalled();
    expect(fake.entries).toHaveLength(3);
    expect(seen.at(-1)).toBe("customer");

    // The dialog did not survive the reload: closing Customer 360 steps over its dead entry too.
    await act(async () => control.customer.setOpen(false));
    await flush();
    expect(fake.go).toHaveBeenCalledWith(-2);
    expect(fake.back).not.toHaveBeenCalled();
    expect(fake.index()).toBe(0);
    expect(closes).toEqual([]);
  });

  it("a Back off that dead dialog entry keeps Customer 360 open, the next Back closes it", async () => {
    reloadedOverDialog();
    const control: Record<string, Control> = {};
    const closes: Array<[string, HistoryLayerCloseReason]> = [];
    const seen: Array<string | null> = [];
    await act(async () =>
      root.render(
        <>
          <CustomerLayer control={control} closes={closes} />
          <TopProbe seen={seen} />
        </>,
      ),
    );
    await flush();
    await act(async () => fake.browserBack());
    await flush();
    expect(closes).toEqual([]);
    expect(seen.at(-1)).toBe("customer");
    await act(async () => fake.browserBack());
    await flush();
    expect(closes).toEqual([["customer", "back"]]);
    expect(fake.pushState).not.toHaveBeenCalled();
    expect(fake.back).not.toHaveBeenCalled();
  });

  it("a jump between entries at the same depth closes the layer the landed entry does not list", async () => {
    const control: Record<string, Control> = {};
    const closes: Array<[string, HistoryLayerCloseReason]> = [];
    const seen: Array<string | null> = [];
    await act(async () =>
      root.render(
        <>
          <CustomerLayer control={control} closes={closes} />
          <Layer name="dialog" initial={false} control={control} closes={closes} />
          <TopProbe seen={seen} />
        </>,
      ),
    );
    await flush();
    // Another page is pushed over Customer 360, and a dialog opens on that page.
    await act(async () => {
      history.pushState(null, "", fake.entries[0].url);
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    await flush();
    expect(closes).toEqual([["customer", "back"]]);
    await act(async () => control.dialog.setOpen(true));
    await flush();
    expect(depths()).toEqual([0, 1, 0, 1]);
    const pushes = fake.pushState.mock.calls.length;

    // Two steps back at once (the browser's history menu): onto Customer 360's entry.
    await act(async () => fake.browserGo(-2));
    await flush();
    expect(closes).toEqual([
      ["customer", "back"],
      ["dialog", "back"],
    ]);
    await act(async () => control.customer.setOpen(true));
    await flush();
    expect(fake.pushState).toHaveBeenCalledTimes(pushes);
    expect(fake.index()).toBe(1);
    expect(seen.at(-1)).toBe("customer");
  });
});

describe("navigateOverLayers", () => {
  it("closes open layers as a navigation, keeps their entries beneath the new page and ignores its own popstate", async () => {
    const control: Record<string, Control> = {};
    const closes: Array<[string, HistoryLayerCloseReason]> = [];
    const seen: Array<string | null> = [];
    const licenses = "http://localhost:3000/?customerReturn=x#/licenses";
    // The page's own state, which every entry above it carries along.
    history.replaceState({ scrollY: 40 }, "", fake.entries[0].url);
    const followed = vi.fn();
    window.addEventListener("popstate", followed);
    try {
      await act(async () =>
        root.render(
          <>
            <Layer
              name="workspace"
              options={{ key: "workspace" }}
              control={control}
              closes={closes}
            />
            <TopProbe seen={seen} />
          </>,
        ),
      );
      await flush();
      await act(async () => navigateOverLayers(licenses));
      await flush();

      expect(closes).toEqual([["workspace", "navigate"]]);
      expect(fake.back).not.toHaveBeenCalled();
      expect(fake.go).not.toHaveBeenCalled();
      expect(fake.index()).toBe(2);
      expect(fake.entries[2]).toEqual({ state: { scrollY: 40 }, url: licenses });
      expect(fake.entries[1].state).toMatchObject({
        scrollY: 40,
        rrLayer: { key: "workspace", depth: 1 },
      });
      // App and the router still hear about the new address.
      expect(followed).toHaveBeenCalledTimes(1);
      expect(seen.at(-1)).toBeNull();

      // Back from the new page lands on the workspace entry, which it adopts.
      await act(async () => fake.browserBack());
      await act(async () => control.workspace.setOpen(true));
      await flush();
      expect(fake.pushState).toHaveBeenCalledTimes(2);
      expect(fake.index()).toBe(1);
      expect(seen.at(-1)).toBe("workspace");
    } finally {
      window.removeEventListener("popstate", followed);
    }
  });
});
