import { Children, isValidElement, useId, type CSSProperties, type ReactNode } from "react";
import { GlassDropdown } from "../GlassDropdown";
interface Props {
  children: ReactNode;
  value?: string | number | readonly string[];
  defaultValue?: string | number | readonly string[];
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  id?: string;
  name?: string;
  required?: boolean;
  "aria-label"?: string;
}
export function Select({
  children,
  value,
  defaultValue,
  onValueChange,
  disabled,
  className = "",
  style,
  id,
  name,
  required,
  "aria-label": label,
}: Props) {
  const ownId = useId();
  const options = Children.toArray(children)
    .filter(isValidElement)
    .map((child) => {
      const props = child.props as { value?: string | number; children?: ReactNode };
      return {
        value: String(props.value ?? props.children ?? ""),
        label: String(props.children ?? ""),
      };
    });
  const selected = String(value ?? defaultValue ?? options[0]?.value ?? "");
  return (
    <div
      id={id ?? ownId}
      className={`custom-select ${className}`}
      style={style}
      aria-label={label}
      aria-disabled={disabled || undefined}
    >
      <GlassDropdown
        allowClear={options.some((o) => o.value === "")}
        placeholder={options.find((o) => o.value === "")?.label ?? "Choose…"}
        options={options.filter((o) => o.value !== "").map((o) => o.value)}
        value={selected || null}
        renderOption={(key) => options.find((o) => o.value === key)?.label ?? key}
        onChange={(next) => {
          if (!disabled) onValueChange?.(next ?? "");
        }}
        disabled={disabled}
        label={label}
        align="left"
      />
      {name && <input type="hidden" name={name} value={selected} required={required} />}
    </div>
  );
}
