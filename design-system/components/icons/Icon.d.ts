export interface IconProps {
  /** Lucide icon name (kebab-case): "users", "radio", "triangle-alert", "settings-2", … (60 shipped — see iconPaths.js) */
  name: string;
  /** Square size in px. Console default is 16 (navbar items, buttons); table actions 14. */
  size?: number;
  /** Lucide stroke width. Default 2; use 2.4 for emphasis marks. */
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
  /** Accessible title; omit for decorative icons. */
  title?: string;
}
