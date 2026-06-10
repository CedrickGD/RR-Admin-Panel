import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

interface GlassDropdownProps {
  /** Shown when nothing is selected, e.g. "All versions". */
  placeholder: string;
  options: string[];
  value: string | null;
  onChange: (next: string | null) => void;
  /** Optional label rendering for option values (e.g. "legacy" -> "Legacy (pre-1.4)"). */
  renderOption?: (option: string) => string;
  /** Show the search input when the list is longer than this. */
  searchThreshold?: number;
}

/**
 * Custom select replacement — native dropdowns can't be themed and look foreign
 * in the glass UI. Trigger pill + anchored glass popover with type-to-filter.
 */
export function GlassDropdown({ placeholder, options, value, onChange, renderOption, searchThreshold = 8 }: GlassDropdownProps) {
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
        <ChevronDown className={`h-3.5 w-3.5 gdrop-chevron${open ? " gdrop-chevron-open" : ""}`} />
      </button>

      {open ? (
        <div className="gdrop-menu" role="listbox">
          {searchable ? (
            <div className="gdrop-search">
              <Search className="h-3.5 w-3.5" />
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
              {value === null ? <Check className="h-3.5 w-3.5" /> : null}
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
                {value === option ? <Check className="h-3.5 w-3.5" /> : null}
              </button>
            ))}
            {visibleOptions.length === 0 ? <p className="gdrop-empty">No matches.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
