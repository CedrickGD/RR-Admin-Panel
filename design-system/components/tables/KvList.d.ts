export interface KvListProps {
  /** tag: "default" renders a neutral Tag chip; "accent" an accent-tinted one; omit for plain mono value */
  items: Array<{ k: string; v: string; tag?: "default" | "accent" }>;
}
