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
  /** Lands on the trigger button, so a ds/Field `<label for>` actually works. */
  id?: string;
  name?: string;
  required?: boolean;
  "aria-label"?: string;
  /** Forwarded by ds/Field when the field carries help text or an error. */
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
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
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
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
  // The id goes on the trigger button, not on this wrapper: a `<label for>`
  // pointing at a <div> is inert (ds/Field), so clicking the label did nothing
  // and the control had no programmatic label — only a duplicated aria-label.
  return (
    <div
      className={`custom-select ${className}`}
      style={style}
      aria-disabled={disabled || undefined}
    >
      <GlassDropdown
        triggerId={id ?? ownId}
        describedBy={describedBy}
        invalid={invalid === true || invalid === "true"}
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
