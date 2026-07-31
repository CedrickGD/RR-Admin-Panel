import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

interface GlassDropdownProps {
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
export function GlassDropdown({ placeholder, options, value, onChange, renderOption, searchThreshold = 8, align = "right" }: GlassDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const label = (option: string) => (renderOption ? renderOption(option) : option);
  const searchable = options.length > searchThreshold;

  const visibleOptions = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return options;
    return options.filter((option) => label(option).toLowerCase().includes(trimmed) || option.toLowerCase().includes(trimmed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, query, renderOption]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    searchRef.current?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const select = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div className={`gdrop${value ? " gdrop-active" : ""}`} ref={rootRef}>
      <button type="button" className="gdrop-trigger" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        <span className="gdrop-trigger-label">{value ? label(value) : placeholder}</span>
        <ChevronDown size={14} className={`gdrop-chevron${open ? " gdrop-chevron-open" : ""}`} />
      </button>

      {open ? (
        <div className="gdrop-menu" role="listbox" style={align === "left" ? { right: "auto", left: 0, transformOrigin: "top left" } : undefined}>
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
