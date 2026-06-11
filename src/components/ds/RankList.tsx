/**
 * DS port of design-system/components/metrics/RankList.
 *
 * Ranked horizontal share bars — version adoption, top countries, platform
 * split. Fills are an accent gradient and grow in with v2grow (0.7s, scaleX
 * from the left). The caller sorts the items and normalizes `share` (0–1 of
 * the max or total); bars never render under 2% width.
 */
export interface RankListItem {
  label: string;
  /** Pre-formatted display value, e.g. "144". */
  value: string;
  /** 0–1 of the max/total, normalized by the caller. */
  share: number;
}

export interface RankListProps {
  items: RankListItem[];
}

export function RankList({ items }: RankListProps) {
  if (items.length === 0) {
    return <p style={{ padding: "10px 0", fontSize: "0.8125rem", color: "var(--text-2)", margin: 0 }}>No data.</p>;
  }
  return (
    <div className="rank">
      {items.map((item) => (
        <div className="rank-row" key={item.label}>
          <span className="rank-label" title={item.label}>{item.label}</span>
          <span className="rank-track">
            <span
              className="rank-fill"
              style={{ width: `${Math.min(100, Math.max(2, Math.round(item.share * 100)))}%` }}
            />
          </span>
          <span className="rank-value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
