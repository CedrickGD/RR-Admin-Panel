/**
 * DS form field — label + requirement hint + control + help/error line.
 *
 * The issue modal on Licenses already marked every field ("Order ID
 * *required*") and showed a styled inline error, while Team and the customer
 * access dialog relied on the bare HTML `required` attribute (native bubble, no
 * visible marker) and unstyled `<p role="alert">`. Field is that good pattern
 * made reusable: it keeps the `required` attribute on the control for
 * keyboard-submit blocking and adds the visible marker, the description wiring
 * (`aria-describedby`) and one error presentation.
 *
 * The control is cloned, not wrapped in guesswork: when `children` is a single
 * element it receives `id`, `aria-describedby` and — while `error` is set —
 * `aria-invalid`. Pass `htmlFor` when the control brings its own id.
 */
import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";

export interface FieldProps {
  /** Sentence case, e.g. "Order ID" — never Title Case (docs/panel-workspace.md). */
  label: ReactNode;
  /** Requirement marker beside the label: "required", "optional", or free text ("recommended"). */
  hint?: "required" | "optional" | string;
  /** Static guidance under the control. Replaced by `error` while one is set. */
  help?: ReactNode;
  /** Validation message. Renders in place of `help`, wired as the control's description. */
  error?: string;
  /** Id of the control when it brings its own; otherwise Field generates one. */
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

type ControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
};

export function Field({ label, hint, help, error, htmlFor, className = "", children }: FieldProps) {
  const generatedId = useId();
  const helpId = useId();
  const errorId = useId();
  const controlId = htmlFor ?? generatedId;

  const only = Children.count(children) === 1 ? Children.toArray(children)[0] : null;
  const control =
    only && isValidElement(only)
      ? cloneElement(only as ReactElement<ControlProps>, {
          id: (only as ReactElement<ControlProps>).props.id ?? controlId,
          "aria-describedby":
            [
              (only as ReactElement<ControlProps>).props["aria-describedby"],
              error ? errorId : null,
              !error && help ? helpId : null,
            ]
              .filter(Boolean)
              .join(" ") || undefined,
          "aria-invalid": error
            ? true
            : (only as ReactElement<ControlProps>).props["aria-invalid"],
        })
      : children;

  return (
    <div className={`ds-field${className ? ` ${className}` : ""}`}>
      <label className="label-sm ds-field-label" htmlFor={controlId}>
        {label}
        {hint ? <em>{hint}</em> : null}
      </label>
      {control}
      {error ? (
        <p className="ds-field-error" id={errorId} role="alert">
          {error}
        </p>
      ) : help ? (
        <p className="ds-field-help" id={helpId}>
          {help}
        </p>
      ) : null}
    </div>
  );
}

export interface FormErrorProps {
  /** Nothing renders while this is empty, so callers can pass state directly. */
  message?: string | null;
}

/**
 * Form-level error box (a failed save, a rejected API call) — the styled band
 * the license issue modal shipped with, now `.form-error` and available to
 * every dialog. Field owns per-control errors; this one owns the whole form.
 */
export function FormError({ message }: FormErrorProps) {
  if (!message) return null;
  return (
    <p className="form-error" role="alert">
      {message}
    </p>
  );
}
