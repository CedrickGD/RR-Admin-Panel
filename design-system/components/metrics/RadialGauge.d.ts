export interface RadialGaugeProps {
  /** 0–1 fill ratio */
  ratio: number;
  /** e.g. "Version adoption" */
  title: string;
  /** e.g. "162 of 220 on 1.6.x" */
  sub?: string;
  /** Diameter in px. Default 64. */
  size?: number;
}
