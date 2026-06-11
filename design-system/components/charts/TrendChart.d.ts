/**
 * @startingPoint section="Charts" subtitle="Large time-series panel: smooth areas + rounded bars + dark hover tooltip" viewport="700x300"
 */
export interface TrendChartProps {
  /** Points in order. `label` is the x tick ("14:00", "Jun 02"); series keys are numeric fields. */
  data: Array<{ label: string; [seriesKey: string]: string | number }>;
  /** Pixel height. 280–300 for main panels, 160 for modal drill-downs. */
  height?: number;
  /** Smooth area-line series. Use chart tokens: var(--chart-users), var(--chart-errors). */
  areas?: Array<{ key: string; name: string; color: string; strokeWidth?: number }>;
  /** Rounded-top bar series behind the lines. Use var(--chart-sessions). */
  bars?: Array<{ key: string; name: string; color: string }>;
  /** Horizontal grid divisions. Default 4. */
  yTicks?: number;
  /** Minimum px between x labels. Default 56. */
  minTickGap?: number;
}
