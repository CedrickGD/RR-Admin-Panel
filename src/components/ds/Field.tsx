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
 *
 * Once the control shares its row with something else — a reveal button, a row of
 * quick-grant presets — that single element is the wrapper, and cloning onto it
 * describes the box instead of the input: the screen reader reads the label and
 * nothing else. Pass a function in that case and spread what it hands you onto the
 * real control.
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
  /** The control, or a function receiving the props the control needs (see above). */
  children: ReactNode | ((control: ControlProps) => ReactNode);
}

export type ControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
};

export function Field({ label, hint, help, error, htmlFor, className = "", children }: FieldProps) {
  const generatedId = useId();
  const helpId = useId();
  const errorId = useId();
  const controlId = htmlFor ?? generatedId;

  const describedBy = error ? errorId : help ? helpId : undefined;
  const controlProps: ControlProps = {
    id: controlId,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : undefined,
  };
  const cloneOnly = (nodes: ReactNode) => {
    const only = Children.count(nodes) === 1 ? Children.toArray(nodes)[0] : null;
    if (!only || !isValidElement(only)) return nodes;
    const props = (only as ReactElement<ControlProps>).props;
    return cloneElement(only as ReactElement<ControlProps>, {
      id: props.id ?? controlId,
      "aria-describedby":
        [props["aria-describedby"], describedBy].filter(Boolean).join(" ") || undefined,
      "aria-invalid": error ? true : props["aria-invalid"],
    });
  };
  const control = typeof children === "function" ? children(controlProps) : cloneOnly(children);

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
