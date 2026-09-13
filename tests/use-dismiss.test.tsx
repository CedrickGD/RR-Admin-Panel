import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDismiss, type DismissReason } from "../src/hooks/useDismiss";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let outside: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  outside = document.createElement("div");
  document.body.append(container, outside);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  outside.remove();
  vi.restoreAllMocks();
});

function Layer({
  open,
  onClose,
  name,
}: {
  open: boolean;
  onClose: (reason: DismissReason) => void;
  name: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, onClose, ref);
  return (
    <div ref={ref} data-layer={name}>
      <button type="button">inside {name}</button>
    </div>
  );
}

/** Two layers that close themselves, opened in the order given. */
function Stack({ log }: { log: string[] }) {
  const [menu, setMenu] = useState(true);
  const [panel, setPanel] = useState(false);
  return (
    <>
      <Layer
        name="menu"
        open={menu}
        onClose={(reason) => {
          log.push(`menu:${reason}`);
          setMenu(false);
        }}
      />
      <Layer
        name="panel"
        open={panel}
        onClose={(reason) => {
          log.push(`panel:${reason}`);
          setPanel(false);
        }}
      />
      <button type="button" data-open-panel onClick={() => setPanel(true)}>
        open panel
      </button>
    </>
  );
}

const pointerDown = (target: Element) =>
  act(() => {
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
const key = (name: string) => {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
  act(() => {
    document.body.dispatchEvent(event);
  });
  return event;
};

describe("useDismiss", () => {
  it("listens to nothing while closed", () => {
    const onClose = vi.fn();
    act(() => root.render(<Layer name="menu" open={false} onClose={onClose} />));
    pointerDown(outside);
    key("Escape");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on a pointerdown outside the element, not inside it", () => {
    const onClose = vi.fn();
    act(() => root.render(<Layer name="menu" open onClose={onClose} />));
    pointerDown(container.querySelector("button")!);
    expect(onClose).not.toHaveBeenCalled();
    pointerDown(outside);
    expect(onClose).toHaveBeenCalledWith("outside");
  });

  it("sees an outside pointerdown even when the target stops it from propagating", () => {
    // MapLibre's canvas handlers are the real case: the dismissal must not depend on bubbling.
    const onClose = vi.fn();
    act(() => root.render(<Layer name="menu" open onClose={onClose} />));
    outside.addEventListener("pointerdown", (event) => event.stopPropagation());
    pointerDown(outside);
    expect(onClose).toHaveBeenCalledWith("outside");
  });

  it("takes Escape before window listeners registered for the page underneath", () => {
    const pageEscape = vi.fn();
    window.addEventListener("keydown", pageEscape);
    try {
      const onClose = vi.fn();
      act(() => root.render(<Layer name="menu" open onClose={onClose} />));
      const event = key("Escape");
      expect(onClose).toHaveBeenCalledWith("escape");
      expect(event.defaultPrevented).toBe(true);
      expect(pageEscape).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", pageEscape);
    }
  });

  it("ignores other keys", () => {
    const onClose = vi.fn();
    act(() => root.render(<Layer name="menu" open onClose={onClose} />));
    key("Enter");
    key("ArrowDown");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("gives Escape to the layer opened last, one layer per press", () => {
    const log: string[] = [];
    act(() => root.render(<Stack log={log} />));
    // A keyboard click opens the panel on top without a pointerdown, so both are open.
    act(() => container.querySelector<HTMLButtonElement>("[data-open-panel]")!.click());

    key("Escape");
    expect(log).toEqual(["panel:escape"]);
    key("Escape");
    expect(log).toEqual(["panel:escape", "menu:escape"]);
    key("Escape");
    expect(log).toEqual(["panel:escape", "menu:escape"]);
  });

  it("removes its listeners on unmount", () => {
    const onClose = vi.fn();
    act(() => root.render(<Layer name="menu" open onClose={onClose} />));
    act(() => root.render(<></>));
    pointerDown(outside);
    key("Escape");
    expect(onClose).not.toHaveBeenCalled();
  });
});
