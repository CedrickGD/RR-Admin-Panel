export interface RankListProps {
  /** Sorted descending by the caller. share is 0–1 of the max/total. */
  items: Array<{ label: string; value: string; share: number }>;
}
