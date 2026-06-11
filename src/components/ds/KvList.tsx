export interface KvListItem {
  k: string;
  v: string;
  /** "default" renders a neutral Tag chip; "accent" an accent-tinted one; omit for plain mono value */
  tag?: "default" | "accent";
}

export interface KvListProps {
  items: KvListItem[];
}

/** Key-value rows — system context, account identity, backend status. */
export function KvList({ items }: KvListProps) {
  return (
    <div className="kv-list">
      {items.map((item) => (
        <div className="kv-row" key={item.k}>
          <span className="kv-key">{item.k}</span>
          {item.tag ? (
            <span className={`kv-tag${item.tag === "accent" ? " kv-tag-accent" : ""}`}>{item.v}</span>
          ) : (
            <span className="kv-val">{item.v}</span>
          )}
        </div>
      ))}
    </div>
  );
}
