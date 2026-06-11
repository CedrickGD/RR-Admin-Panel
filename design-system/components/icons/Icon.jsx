import React from "react";
import { ICON_PATHS } from "./iconPaths.js";

/**
 * Lucide icon, inlined from the official SVG set (the console's icon system).
 * Renders stroke icons in currentColor — color via CSS `color` on a parent.
 */
export function Icon({ name, size = 16, strokeWidth = 2, className, style, title }) {
  const inner = ICON_PATHS[name];
  if (!inner) {
    console.warn(`[Icon] unknown icon "${name}" — see components/icons/iconPaths.js for the available set`);
    return null;
  }
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      dangerouslySetInnerHTML={{ __html: title ? `<title>${title}</title>${inner}` : inner }}
    />
  );
}
