/**
 * Internal helper for the ds/ ports.
 *
 * ICON APPROACH (shared by every ds/ component): the design-system contracts
 * take a Lucide icon NAME string and render it through a local Icon component.
 * In this app the icon props accept a ReactNode instead — pass a lucide-react
 * element directly, e.g. icon={<RefreshCw />}. When the element carries no
 * explicit `size` prop, the component injects the DS-mandated pixel size
 * (so a bare <RefreshCw /> never renders at lucide's 24px default). An
 * explicit size on the element always wins.
 */
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

/** Inject `size={px}` into a lucide-react element unless the caller already set one. */
export function sizedIcon(icon: ReactNode, px: number): ReactNode {
  if (
    isValidElement(icon) &&
    typeof icon.type !== "string" &&
    (icon.props as { size?: number | string }).size === undefined
  ) {
    return cloneElement(icon as ReactElement<{ size?: number | string }>, { size: px });
  }
  return icon;
}
