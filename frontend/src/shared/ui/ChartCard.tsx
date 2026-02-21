import type { ReactNode } from 'react';
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Line,
	LineChart,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts';
import { GlassCard } from './GlassCard';
import type { ChartMode, ChartPoint, ChartSeries } from '@/shared/types/dashboard';

type ChartCardProps = {
	title: string;
	subtitle?: string;
	mode: ChartMode;
	data: ChartPoint[];
	series: ChartSeries[];
	actions?: ReactNode;
	height?: number;
	className?: string;
};

const donutPalette = ['var(--accent)', 'var(--accent-2)', 'var(--accent-3)', '#94a3b8'];
const chartAxisStyle = {
	stroke: 'var(--muted-text)',
	tickLine: false,
	axisLine: false,
};

const formatTooltipValue = (value: unknown): string => {
	if (typeof value === 'number') {
		return value.toLocaleString();
	}
	return String(value ?? '--');
};

function CustomChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<Record<string, unknown>>; label?: string | number }) {
	if (!active || !payload || payload.length === 0) {
		return null;
	}

	return (
		<div className="chart-tooltip" role="presentation">
			{(label ?? '').toString().length > 0 && <p className="chart-tooltip__label">{label}</p>}
			<div className="chart-tooltip__rows">
				{payload.map((entry, index) => (
					<div className="chart-tooltip__row" key={`tip-${String(entry.dataKey ?? entry.name ?? index)}`}>
						<span className="chart-tooltip__swatch" style={{ background: String(entry.color ?? 'var(--accent)') }} />
						<span className="chart-tooltip__name">{String(entry.name ?? entry.dataKey ?? 'Value')}</span>
						<span className="chart-tooltip__value">{formatTooltipValue(entry.value)}</span>
					</div>
				))}
			</div>
		</div>
	);
}

export function ChartCard({ title, subtitle, mode, data, series, actions, height = 260, className }: ChartCardProps) {
	const chartHeight = mode === 'donut' ? Math.max(height, 300) : height;
	const valueKey = series[0]?.key ?? 'value';
	const donutTotal = mode === 'donut'
		? data.reduce((sum, item) => {
			const rawValue = item[valueKey as keyof ChartPoint];
			const numericValue = typeof rawValue === 'number' ? rawValue : Number(rawValue ?? 0);
			return Number.isFinite(numericValue) ? sum + numericValue : sum;
		}, 0)
		: 0;
	const donutLegend = mode === 'donut'
		? data.slice(0, 5).map((item, index) => {
			const rawValue = item[valueKey as keyof ChartPoint];
			const numericValue = typeof rawValue === 'number' ? rawValue : Number(rawValue ?? 0);
			const safeValue = Number.isFinite(numericValue) ? numericValue : 0;
			const share = donutTotal > 0 ? `${((safeValue / donutTotal) * 100).toFixed(1)}%` : '0.0%';
			return {
				label: String(item.label ?? `Slice ${index + 1}`),
				value: safeValue.toLocaleString(),
				share,
				color: donutPalette[index % donutPalette.length],
			};
		})
		: [];

	const chartBody = () => {
		if (mode === 'line') {
			return (
				<ResponsiveContainer width="100%" height={chartHeight}>
					<LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
						<CartesianGrid stroke="var(--grid-line)" strokeDasharray="3 7" vertical={false} />
						<XAxis dataKey="label" {...chartAxisStyle} />
						<YAxis {...chartAxisStyle} />
						<Tooltip content={<CustomChartTooltip />} cursor={false} allowEscapeViewBox={{ x: true, y: true }} />
						{series.map((entry) => (
							<Line
								key={entry.key}
								type="monotone"
								dataKey={entry.key}
								name={entry.label}
								stroke={entry.color ?? 'var(--accent)'}
								strokeWidth={3}
								dot={false}
								activeDot={{ r: 4 }}
								animationDuration={700}
							/>
						))}
					</LineChart>
				</ResponsiveContainer>
			);
		}

		if (mode === 'area') {
			return (
				<ResponsiveContainer width="100%" height={chartHeight}>
					<AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
						<defs>
							{series.map((entry) => (
								<linearGradient id={`area-${entry.key}`} x1="0" y1="0" x2="0" y2="1" key={entry.key}>
									<stop offset="0%" stopColor={entry.gradientFrom ?? entry.color ?? 'var(--accent)'} stopOpacity={0.45} />
									<stop offset="100%" stopColor={entry.gradientTo ?? entry.color ?? 'var(--accent)'} stopOpacity={0.04} />
								</linearGradient>
							))}
						</defs>
						<CartesianGrid stroke="var(--grid-line)" strokeDasharray="3 7" vertical={false} />
						<XAxis dataKey="label" {...chartAxisStyle} />
						<YAxis {...chartAxisStyle} />
						<Tooltip content={<CustomChartTooltip />} cursor={false} allowEscapeViewBox={{ x: true, y: true }} />
						{series.map((entry) => (
							<Area
								key={entry.key}
								type="monotone"
								dataKey={entry.key}
								name={entry.label}
								stroke={entry.color ?? 'var(--accent)'}
								fill={`url(#area-${entry.key})`}
								strokeWidth={2.4}
								stackId={entry.stackId}
								animationDuration={700}
							/>
						))}
					</AreaChart>
				</ResponsiveContainer>
			);
		}

		if (mode === 'bar') {
			return (
				<ResponsiveContainer width="100%" height={chartHeight}>
					<BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
						<CartesianGrid stroke="var(--grid-line)" strokeDasharray="3 7" vertical={false} />
						<XAxis dataKey="label" {...chartAxisStyle} />
						<YAxis {...chartAxisStyle} />
						<Tooltip content={<CustomChartTooltip />} cursor={false} allowEscapeViewBox={{ x: true, y: true }} />
						{series.map((entry) => (
							<Bar
								key={entry.key}
								dataKey={entry.key}
								name={entry.label}
								fill={entry.color ?? 'var(--accent)'}
								radius={[8, 8, 8, 8]}
								animationDuration={700}
							/>
						))}
					</BarChart>
				</ResponsiveContainer>
			);
		}

		return (
			<ResponsiveContainer width="100%" height={chartHeight}>
				<PieChart>
					<Tooltip content={<CustomChartTooltip />} allowEscapeViewBox={{ x: true, y: true }} />
					<Pie
						data={data}
						dataKey={valueKey}
						nameKey="label"
						cx="50%"
						cy="50%"
						innerRadius={72}
						outerRadius={104}
						paddingAngle={3}
						strokeWidth={0}
						animationDuration={800}
					>
						{data.map((_, index) => (
							<Cell key={`cell-${index}`} fill={donutPalette[index % donutPalette.length]} />
						))}
					</Pie>
					<text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="donut-center-value">
						{donutTotal.toLocaleString()}
					</text>
				</PieChart>
			</ResponsiveContainer>
		);
	};

	return (
		<GlassCard title={title} subtitle={subtitle} actions={actions} className={`chart-card ${className ?? ''}`.trim()}>
			<div className="chart-card__inner">{chartBody()}</div>
			{mode === 'donut' && donutLegend.length > 0 && (
				<ul className="chart-card__legend">
					{donutLegend.map((item) => (
						<li key={item.label} className="chart-card__legend-item">
							<span className="chart-card__legend-dot" style={{ background: item.color }} />
							<span className="chart-card__legend-label">{item.label}</span>
							<span className="chart-card__legend-value">{item.share} ({item.value})</span>
						</li>
					))}
				</ul>
			)}
		</GlassCard>
	);
}
