/**
 * DS text input — the one owner of `.glass-input`.
 *
 * 39 raw `<input className="glass-input">` elements were spread over the pages
 * (28 on Licenses alone) while the only input primitive was SearchInput. This
 * wraps the same class so migrated call sites look identical, forwards the ref
 * for focus management, and turns validation state into the `aria-invalid` the
 * hand-written fields never set. Pair it with ds/Field for label + hint + error.
 */
import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Marks the field as failing validation: sets aria-invalid and the error border. */
  invalid?: boolean;
  /** Machine values (license keys, HWIDs) render in the mono face. */
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, mono, className = "", type = "text", ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={`glass-input${mono ? " customer360-mono" : ""}${className ? ` ${className}` : ""}`}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

/** Multi-line sibling of Input — same field chrome, control radius, resizes vertically. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className = "", ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={`glass-input${className ? ` ${className}` : ""}`}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});
