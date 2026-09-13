import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GlassDropdown } from "../src/components/GlassDropdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * jsdom has no Popover API. The stand-in follows the spec where it matters here: showPopover() on
 * a popover that is already showing throws InvalidStateError, and `:popover-open` matches only
 * while it shows.
 */
type PopoverElement = HTMLElement & { showPopover?: () => void; hidePopover?: () => void };
const showing = new WeakSet<Element>();
const nativeMatches = Element.prototype.matches;
const proto = HTMLElement.prototype as PopoverElement;
const hadPopover = typeof proto.showPopover === "function";

beforeAll(() => {
  if (!hadPopover) {
    proto.showPopover = function (this: HTMLElement) {
      if (showing.has(this)) {
        throw new DOMException("The popover is already showing.", "InvalidStateError");
      }
      showing.add(this);
    };
    proto.hidePopover = function (this: HTMLElement) {
      showing.delete(this);
    };
    Element.prototype.matches = function (this: Element, selector: string) {
      if (selector === ":popover-open") return showing.has(this);
      return nativeMatches.call(this, selector);
    };
  }
});

afterAll(() => {
  if (!hadPopover) {
    delete proto.showPopover;
    delete proto.hidePopover;
    Element.prototype.matches = nativeMatches;
  }
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function render(align: "left" | "right") {
  act(() => {
    root.render(
      <GlassDropdown
        placeholder="All versions"
        options={["1.5.0", "1.4.9"]}
        value={null}
        onChange={() => {}}
        align={align}
      />,
    );
  });
}

const trigger = () => container.querySelector<HTMLButtonElement>(".gdrop-trigger")!;
const menu = () => document.querySelector<HTMLElement>(".gdrop-menu");

describe("GlassDropdown popover", () => {
  it("does not show an open popover a second time when its anchor edge changes", () => {
    const show = vi.spyOn(proto as Required<PopoverElement>, "showPopover");
    render("left");
    act(() => trigger().click());
    expect(menu()).not.toBeNull();
    expect(show).toHaveBeenCalledTimes(1);

    // The layout effect re-runs on `align`; on the open popover that used to throw.
    expect(() => render("right")).not.toThrow();
    expect(menu()).not.toBeNull();
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("shows the popover again after it was closed and reopened", () => {
    const show = vi.spyOn(proto as Required<PopoverElement>, "showPopover");
    render("left");
    act(() => trigger().click());
    act(() => trigger().click());
    expect(menu()).toBeNull();
    act(() => trigger().click());
    expect(menu()).not.toBeNull();
    expect(show).toHaveBeenCalledTimes(2);
  });

  it("closes on Escape and hands focus back to the trigger", () => {
    render("left");
    act(() => trigger().click());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});
