export interface SparklineProps {
  /** Raw series — scaled to fit. Needs 2+ points or renders nothing. */
  values: number[];
  /** Default 64×26 — sized for the KPI tile's right side. */
  width?: number;
  height?: number;
  /** Line color. Default var(--accent); use var(--chart-errors) for error series. */
  color?: string;
}
