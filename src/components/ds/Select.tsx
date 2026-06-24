import { ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";

interface Option {
  value: string;
  label: string;
}

interface SelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function Select({ options, value, onChange, className, style }: SelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedOption = options.find(o => o.value === value) || options[0];

  return (
    <div 
      ref={ref} 
      style={{ 
        position: "relative", 
        display: "inline-block", 
        width: "max-content",
        ...style 
      }} 
      className={className}
    >
      <div 
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "6px 12px",
          borderRadius: "6px",
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          color: "var(--text)",
          cursor: "pointer",
          userSelect: "none",
          minWidth: "120px",
          justifyContent: "space-between"
        }}
      >
        <span>{selectedOption?.label}</span>
        <ChevronDown size={14} style={{ opacity: 0.6 }} />
      </div>
      
      {open && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          marginTop: "4px",
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
          zIndex: 50,
          overflow: "hidden"
        }}>
          {options.map(option => (
            <div 
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                background: option.value === value ? "var(--bg-hover)" : "transparent",
                color: option.value === value ? "var(--text)" : "var(--text-muted)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = option.value === value ? "var(--bg-hover)" : "transparent";
                e.currentTarget.style.color = option.value === value ? "var(--text)" : "var(--text-muted)";
              }}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
