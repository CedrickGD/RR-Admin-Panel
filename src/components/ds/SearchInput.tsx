/**
 * DS port of design-system/components/controls/SearchInput.
 *
 * Search field with a leading lucide Search icon (14px) — session/user
 * directory filtering. Focus ring (accent border + 3px halo) comes from
 * `.glass-input` in the DS controls.css. Width is fluid; constrain with a
 * wrapper or style={{ maxWidth: 280 }}.
 */
import type { CSSProperties } from "react";
import { Search } from "lucide-react";

export interface SearchInputProps {
  value: string;
  onChange: (next: string) => void;
  /** e.g. "Search user, Discord, session id…" */
  placeholder?: string;
  style?: CSSProperties;
  className?: string;
}

export function SearchInput({ value, onChange, placeholder = "Search…", style, className = "" }: SearchInputProps) {
  return (
    <div className={`search-wrap${className ? ` ${className}` : ""}`} style={style}>
      <span className="search-icon"><Search size={14} /></span>
      <input
        className="glass-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
      />
    </div>
  );
}
