import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons/Icon.jsx";

/**
 * Custom select replacement — native dropdowns can't be themed and look foreign
 * in the console. Trigger pill + anchored dark popover with type-to-filter.
 * NEVER use a native <select> in this design system.
 */
export function Dropdown({ placeholder, options, value, onChange, renderOption, searchThreshold = 8, align = "right" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const searchRef = useRef(null);

  const label = (option) => (renderOption ? renderOption(option) : option);
  const searchable = options.length > searchThreshold;

  const visibleOptions = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return options;
    return options.filter((o) => label(o).toLowerCase().includes(trimmed) || o.toLowerCase().includes(trimmed));
  }, [options, query, renderOption]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    if (searchRef.current) searchRef.current.focus();
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const select = (next) => {
    if (onChange) onChange(next);
    setOpen(false);
  };

  return (
    <div className={`gdrop${value ? " gdrop-active" : ""}`} ref={rootRef}>
      <button type="button" className="gdrop-trigger" onClick={() => setOpen((c) => !c)} aria-expanded={open}>
        <span className="gdrop-trigger-label">{value ? label(value) : placeholder}</span>
        <Icon name="chevron-down" size={14} className={`gdrop-chevron${open ? " gdrop-chevron-open" : ""}`} />
      </button>

      {open ? (
        <div className="gdrop-menu" role="listbox" style={align === "left" ? { right: "auto", left: 0 } : undefined}>
          {searchable ? (
            <div className="gdrop-search">
              <Icon name="search" size={14} />
              <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter…" spellCheck={false} />
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
              {value === null ? <Icon name="check" size={14} /> : null}
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
                {value === option ? <Icon name="check" size={14} /> : null}
              </button>
            ))}
            {visibleOptions.length === 0 ? <p className="gdrop-empty">No matches.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
