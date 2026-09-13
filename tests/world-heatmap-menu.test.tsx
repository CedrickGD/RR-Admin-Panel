import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WorldHeatmap } from "../src/components/charts/WorldHeatmap";
import { resetHistoryLayers } from "../src/hooks/useHistoryLayer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * WorldHeatmap on jsdom with MapLibre replaced by a recording stand-in: jsdom has no WebGL, and
 * what is under test is the component's own wiring (resize tracking, the in-map menu), not the
 * map. The stand-in never fires "load", so the style passes that need a loaded style stay idle.
 */
type Handler = (...args: unknown[]) => void;
interface FakeMapShape {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  style: unknown;
  resize: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  zoomIn: ReturnType<typeof vi.fn>;
  zoomOut: ReturnType<typeof vi.fn>;
  setStyle: ReturnType<typeof vi.fn>;
  setProjection: ReturnType<typeof vi.fn>;
  fitBounds: ReturnType<typeof vi.fn>;
  easeTo: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => void;
}

const mocks = vi.hoisted(() => ({
  maps: [] as FakeMapShape[],
  observers: [] as Array<{
    callback: ResizeObserverCallback;
    observed: Element[];
    disconnect: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("maplibre-gl", () => {
  class FakeMap {
    container: HTMLElement;
    style: unknown;
    handlers = new Map<string, Handler[]>();
    canvas = document.createElement("canvas");
    resize = vi.fn();
    remove = vi.fn();
    zoomIn = vi.fn();
    zoomOut = vi.fn();
    setStyle = vi.fn();
    setProjection = vi.fn();
    fitBounds = vi.fn();
    easeTo = vi.fn();
    addControl = vi.fn();
    addSource = vi.fn();
    addLayer = vi.fn();
    setFilter = vi.fn();
    setPaintProperty = vi.fn();
    setLayoutProperty = vi.fn();
    setPixelRatio = vi.fn();
    getLayer = vi.fn(() => undefined);
    getSource = vi.fn(() => undefined);
    getStyle = vi.fn(() => ({ layers: [] }));
    isStyleLoaded = vi.fn(() => false);
    queryRenderedFeatures = vi.fn(() => []);
    getZoom = vi.fn(() => 2);
    constructor(options: { container: HTMLElement; style: unknown }) {
      this.container = options.container;
      this.style = options.style;
      this.container.appendChild(this.canvas);
      mocks.maps.push(this as unknown as FakeMapShape);
    }
    on(event: string, ...rest: unknown[]) {
      const handler = rest[rest.length - 1] as Handler;
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }
    once(event: string, handler: Handler) {
      return this.on(event, handler);
    }
    off() {
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      (this.handlers.get(event) ?? []).forEach((handler) => handler(...args));
    }
    getCanvas() {
      return this.canvas;
    }
  }
  class Popup {
    remove = vi.fn(() => this);
    addClassName = vi.fn(() => this);
    removeClassName = vi.fn(() => this);
    setLngLat = vi.fn(() => this);
    setHTML = vi.fn(() => this);
    addTo = vi.fn(() => this);
    getElement = vi.fn(() => null);
  }
  class AttributionControl {}
  class LngLatBounds {
    extend() {
      return this;
    }
    isEmpty() {
      return true;
    }
  }
  const api = { Map: FakeMap, Popup, AttributionControl, LngLatBounds };
  return { default: api, ...api };
});

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  class FakeResizeObserver {
    observed: Element[] = [];
    disconnect = vi.fn();
    constructor(public callback: ResizeObserverCallback) {
      mocks.observers.push(this);
    }
    observe(element: Element) {
      this.observed.push(element);
    }
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  mocks.maps.length = 0;
  mocks.observers.length = 0;
  localStorage.clear();
  resetHistoryLayers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderMap() {
  act(() => {
    root.render(<WorldHeatmap sessionPoints={[]} theme="dark" onOpenSession={() => {}} />);
  });
  return mocks.maps[mocks.maps.length - 1];
}

describe("WorldHeatmap resize tracking", () => {
  it("resizes the map whenever its container changes size, not only the window", () => {
    const map = renderMap();
    const element = container.querySelector(".world-heatmap-map");
    expect(mocks.observers).toHaveLength(1);
    expect(mocks.observers[0].observed).toEqual([element]);

    map.resize.mockClear();
    mocks.observers[0].callback([], mocks.observers[0] as unknown as ResizeObserver);
    expect(map.resize).toHaveBeenCalledTimes(1);
  });

  it("stops observing when the map goes away", () => {
    const map = renderMap();
    act(() => root.render(<></>));
    expect(mocks.observers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(map.remove).toHaveBeenCalledTimes(1);
  });
});

const trigger = () => container.querySelector<HTMLButtonElement>('[aria-label="Map controls"]')!;
const menuPanel = () => container.querySelector<HTMLElement>(".world-heatmap-menu-panel");
const inMenu = (selector: string) => menuPanel()!.querySelector<HTMLButtonElement>(selector)!;
const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const pointerDown = (target: Element) =>
  act(() => {
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
const escape = () =>
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
const openMenu = () => act(() => trigger().click());

describe("WorldHeatmap in-map menu", () => {
  it("keeps zoom and fullscreen outside the menu, always visible", () => {
    const map = renderMap();
    expect(menuPanel()).toBeNull();
    act(() => button("Zoom in").click());
    act(() => button("Zoom out").click());
    expect(map.zoomIn).toHaveBeenCalledTimes(1);
    expect(map.zoomOut).toHaveBeenCalledTimes(1);
    expect(button("Fullscreen")).not.toBeNull();
    expect(container.querySelector(".world-heatmap-menu")!.contains(button("Zoom in"))).toBe(false);
  });

  it("opens from the hamburger and closes on a press on the map canvas", () => {
    const map = renderMap();
    openMenu();
    expect(menuPanel()).not.toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(trigger().getAttribute("aria-controls")).toBe(menuPanel()!.id);

    pointerDown(map.canvas);
    expect(menuPanel()).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("stays open for a press inside it and toggles closed from the trigger", () => {
    renderMap();
    openMenu();
    pointerDown(menuPanel()!);
    pointerDown(trigger());
    expect(menuPanel()).not.toBeNull();
    act(() => trigger().click());
    expect(menuPanel()).toBeNull();
  });

  it("takes Escape before fullscreen does and hands focus back to the trigger", () => {
    renderMap();
    act(() => button("Fullscreen").click());
    expect(container.querySelector(".world-heatmap-fullscreen")).not.toBeNull();
    openMenu();

    escape();
    expect(menuPanel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    // The same press did not reach the map's own Escape handling.
    expect(container.querySelector(".world-heatmap-fullscreen")).not.toBeNull();

    escape();
    expect(container.querySelector(".world-heatmap-fullscreen")).toBeNull();
  });

  it("offers the map style as a radio group that persists and swaps to satellite", () => {
    const map = renderMap();
    openMenu();
    const radios = [...menuPanel()!.querySelectorAll('[role="radiogroup"] [role="radio"]')];
    expect(radios.map((radio) => radio.getAttribute("data-style"))).toEqual([
      "tactical",
      "standard",
      "satellite",
    ]);
    expect(inMenu('[data-style="tactical"]').getAttribute("aria-checked")).toBe("true");

    act(() => inMenu('[data-style="satellite"]').click());
    expect(menuPanel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(localStorage.getItem("rr:map-style")).toBe("satellite");
    expect(map.setStyle).toHaveBeenCalledTimes(1);
    expect(map.setStyle.mock.calls[0][0]).toMatchObject({ sources: { satellite: {} } });

    openMenu();
    expect(inMenu('[data-style="satellite"]').getAttribute("aria-checked")).toBe("true");
    expect(inMenu('[data-style="tactical"]').getAttribute("aria-checked")).toBe("false");
  });

  it("switches tactical to standard without reloading the style, and reads the saved style", () => {
    const map = renderMap();
    openMenu();
    act(() => inMenu('[data-style="standard"]').click());
    expect(localStorage.getItem("rr:map-style")).toBe("standard");
    expect(map.setStyle).not.toHaveBeenCalled();

    act(() => root.render(<></>));
    const again = renderMap();
    expect(mocks.maps).toHaveLength(2);
    // The saved style is what the next map starts with (standard is the Liberty style URL).
    expect(typeof mocks.maps[1].style).toBe("string");
    openMenu();
    expect(inMenu('[data-style="standard"]').getAttribute("aria-checked")).toBe("true");
    expect(again).toBe(mocks.maps[1]);
  });

  it("shows the globe as a pressed toggle", () => {
    const map = renderMap();
    openMenu();
    expect(inMenu('[data-action="globe"]').getAttribute("aria-pressed")).toBe("true");
    act(() => inMenu('[data-action="globe"]').click());
    expect(map.setProjection).toHaveBeenLastCalledWith({ type: "mercator" });
    expect(menuPanel()).toBeNull();
    openMenu();
    expect(inMenu('[data-action="globe"]').getAttribute("aria-pressed")).toBe("false");
  });

  it("opens the info panel from the menu and closes the menu", () => {
    renderMap();
    openMenu();
    act(() => inMenu('[data-action="info"]').click());
    expect(menuPanel()).toBeNull();
    expect(container.querySelector(".world-heatmap-floating-panel")).not.toBeNull();
  });

  it("closes when fullscreen changes, and is not a history layer", () => {
    const pushState = vi.spyOn(history, "pushState");
    renderMap();
    openMenu();
    expect(pushState).not.toHaveBeenCalled();

    // A keyboard activation of Fullscreen presses nothing outside the menu.
    act(() => button("Fullscreen").click());
    expect(menuPanel()).toBeNull();
    pushState.mockRestore();
  });

  it("moves focus into the menu when opened from the keyboard", () => {
    renderMap();
    act(() => {
      trigger().dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
    });
    expect(menuPanel()).not.toBeNull();
    expect(document.activeElement).toBe(inMenu('[data-action="focus-live"]'));
    // Zoom to selection is disabled without a selection, so ArrowDown skips it.
    act(() => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
    });
    expect(document.activeElement).toBe(inMenu('[data-style="tactical"]'));
  });
});
