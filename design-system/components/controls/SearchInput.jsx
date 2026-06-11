import React from "react";
import { Icon } from "../icons/Icon.jsx";

/** Search field with leading icon — session/user directory filtering. */
export function SearchInput({ value, onChange, placeholder = "Search…", style, className = "" }) {
  return (
    <div className={`search-wrap${className ? ` ${className}` : ""}`} style={style}>
      <span className="search-icon"><Icon name="search" size={14} /></span>
      <input
        className="glass-input"
        value={value}
        onChange={(e) => onChange && onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
      />
    </div>
  );
}
