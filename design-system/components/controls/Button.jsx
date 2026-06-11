import React from "react";
import { Icon } from "../icons/Icon.jsx";

const VARIANT_CLASS = {
  primary: "btn-primary",
  ghost: "btn-ghost",
  accent: "btn-accent-ghost",
  danger: "btn-danger",
};
const SIZE_CLASS = { md: "", sm: " btn-sm", xs: " btn-xs" };

/** Console button. Ghost is the workhorse; primary is reserved for the one true action. */
export function Button({ variant = "ghost", size = "md", icon, children, className = "", ...rest }) {
  return (
    <button
      type="button"
      className={`btn ${VARIANT_CLASS[variant] ?? VARIANT_CLASS.ghost}${SIZE_CLASS[size] ?? ""}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {icon ? <Icon name={icon} size={size === "xs" ? 12 : 14} /> : null}
      {children}
    </button>
  );
}

/** Square icon-only button for table rows and panel chrome. */
export function IconButton({ icon, size = 14, className = "", ...rest }) {
  return (
    <button type="button" className={`btn-icon${className ? ` ${className}` : ""}`} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  );
}
