import React from "react";

/** Small squared chip for config values in headers and kv rows. */
export function Tag({ accent = false, children, title }) {
  return <span className={`kv-tag${accent ? " kv-tag-accent" : ""}`} title={title}>{children}</span>;
}

/** Loading spinner. */
export function Spinner({ small = false }) {
  return <span className={`spinner${small ? " spinner-sm" : ""}`} style={{ display: "inline-block" }} />;
}
