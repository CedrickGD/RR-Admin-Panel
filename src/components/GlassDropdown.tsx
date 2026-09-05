import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

interface GlassDropdownProps {
  disabled?: boolean;
  label?: string;
  allowClear?: boolean;
  /** Empty/"all" state label, e.g. "All versions". Selecting it passes null to onChange. */
  placeholder: string;
  options: string[];
  /** Currently selected option, or null for the placeholder/all state. */
  value: string | null;
  onChange: (next: string | null) => void;
  /** Optional display mapping, e.g. "legacy" -> "Legacy (pre-1.4)" */
  renderOption?: (option: string) => string;
  /** Show the filter input when the list is longer than this. Default 8. */
  searchThreshold?: number;
  /** Popover anchor edge. Default "right". */
  align?: "left" | "right";
}

/**
 * Custom select replacement — native dropdowns can't be themed and look foreign
 * in the console. Trigger pill + anchored dark popover with type-to-filter.
 * NEVER use a native <select> in this design system.
 */
export function GlassDropdown({
  placeholder,
  options,
  value,
  onChange,
  renderOption,
  searchThreshold = 8,
  align = "right",
  disabled,
  label: accessibleLabel,
  allowClear = true,
}: GlassDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({ top: 0, left: 0, width: 200, maxHeight: 300 });
  useLayoutEffect(() => {
    if (!open || !menuRef.current || !rootRef.current) return;
    const menu = menuRef.current;
    menu.showPopover?.();
    const position = () => {
      const rect = rootRef.current!.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const upwards = below < 220 && above > below;
      const maxHeight = Math.max(40, Math.min(320, upwards ? above : below));
      const width = Math.min(Math.max(rect.width, 200), window.innerWidth - 24);
      const height = Math.min(menu.scrollHeight, maxHeight);
      const left = Math.max(
        12,
        Math.min(
          align === "right" ? rect.right - width : rect.left,
          window.innerWidth - width - 12,
        ),
      );
      setPlacement({
        top: upwards ? Math.max(12, rect.top - height - 7) : rect.bottom + 7,
        left,
        width,
        maxHeight,
      });
    };
    position();
    window.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", position, true);
    };
  }, [open, align]);

  const label = (option: string) => (renderOption ? renderOption(option) : option);
  const searchable = options.length > searchThreshold;

  const visibleOptions = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return options;
    return options.filter(
      (option) =>
        label(option).toLowerCase().includes(trimmed) || option.toLowerCase().includes(trimmed),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, query, renderOption]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    if (searchRef.current) searchRef.current.focus();
    else
      menuRef.current
        ?.querySelector<HTMLButtonElement>('[aria-selected="true"], .gdrop-item')
        ?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpen(false);
        rootRef.current?.querySelector<HTMLButtonElement>(".gdrop-trigger")?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const select = (next: string | null) => {
    onChange(next);
    setOpen(false);
    rootRef.current?.querySelector<HTMLButtonElement>(".gdrop-trigger")?.focus();
  };

  return (
    <div className={`gdrop${value ? " gdrop-active" : ""}`} ref={rootRef}>
      <button
        type="button"
        disabled={disabled}
        aria-label={accessibleLabel}
        className="gdrop-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="listbox"
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="gdrop-trigger-label">{value ? label(value) : placeholder}</span>
        <ChevronDown size={14} className={`gdrop-chevron${open ? " gdrop-chevron-open" : ""}`} />
      </button>

      {open ? (
        <div
          ref={menuRef}
          popover="manual"
          className="gdrop-menu"
          role="listbox"
          aria-label={accessibleLabel ?? placeholder}
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            if (event.target === searchRef.current && !event.key.startsWith("Arrow")) return;
            const items = [
              ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(".gdrop-item") ?? []),
            ];
            if (!items.length) return;
            event.preventDefault();
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
            items[next].focus();
          }}
          style={{
            ...placement,
            right: "auto",
            margin: 0,
            position: "fixed",
            transformOrigin: "top left",
          }}
        >
          {searchable ? (
            <div className="gdrop-search">
              <Search size={14} />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter…"
                spellCheck={false}
              />
            </div>
          ) : null}

          <div className="gdrop-list">
            {allowClear && (
              <button
                type="button"
                className={`gdrop-item${value === null ? " gdrop-item-selected" : ""}`}
                onClick={() => select(null)}
                role="option"
                aria-selected={value === null}
              >
                <span>{placeholder}</span>
                {value === null ? <Check size={14} /> : null}
              </button>
            )}
            {visibleOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={`gdrop-item${value === option ? " gdrop-item-selected" : ""}`}
                onClick={() => select(option)}
                role="option"
                aria-selected={value === option}
              >
                <span>{label(option)}</span>
                {value === option ? <Check size={14} /> : null}
              </button>
            ))}
            {visibleOptions.length === 0 ? <p className="gdrop-empty">No matches.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
