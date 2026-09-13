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
  return mocks.maps[0];
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
