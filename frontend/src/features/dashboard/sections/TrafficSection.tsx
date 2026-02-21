import { ChartCard } from '@/shared/ui/ChartCard';
import { GlassCard } from '@/shared/ui/GlassCard';
import { KpiCard } from '@/shared/ui/KpiCard';
import { TableCard } from '@/shared/ui/TableCard';
import type { GenericRow, TrafficData } from '@/shared/types/dashboard';

type TrafficSectionProps = {
	data: TrafficData;
};

type DailyRow = TrafficData['dailyRows'][number] & GenericRow;

export function TrafficSection({ data }: TrafficSectionProps) {
	const latestDay = data.dailyRows[0];
	const oldestDay = data.dailyRows.at(-1);

	return (
		<div className="section-grid section-grid--traffic">
			<div className="kpi-row">
				{data.kpis.map((metric) => (
					<KpiCard key={metric.label} metric={metric} />
				))}
			</div>

			<ChartCard
				title="Traffic Over Time"
				subtitle="Daily requests and unique installs"
				mode="line"
				data={data.trafficOverTime}
				className="traffic-main-chart"
				series={[
					{ key: 'requests', label: 'Requests', color: 'var(--accent)' },
					{ key: 'visitors', label: 'Unique installs', color: 'var(--accent-2)' },
				]}
			/>

			<ChartCard
				title="Unique Installs Trend"
				subtitle="Daily install activity"
				mode="bar"
				data={data.installsOverTime}
				className="traffic-country-chart"
				series={[{ key: 'installs', label: 'Unique installs', color: 'var(--accent)' }]}
			/>

			<GlassCard title="Traffic Snapshot" subtitle="Quick context from current filtered view" className="traffic-snapshot-card">
				<div className="protocol-list">
					<div className="protocol-list__row">
						<div>
							<p>Newest day</p>
							<span>{latestDay?.day ?? '--'}</span>
						</div>
						<strong>{latestDay?.requests ?? '--'}</strong>
					</div>
					<div className="protocol-list__row">
						<div>
							<p>Oldest day</p>
							<span>{oldestDay?.day ?? '--'}</span>
						</div>
						<strong>{oldestDay?.requests ?? '--'}</strong>
					</div>
					<div className="protocol-list__row">
						<div>
							<p>Rows loaded</p>
							<span>From backend daily series</span>
						</div>
						<strong>{data.dailyRows.length}</strong>
					</div>
				</div>
			</GlassCard>

			<TableCard<DailyRow>
				title="Daily Request Table"
				subtitle="Raw daily counts from backend"
				className="traffic-table-card"
				columns={[
					{ key: 'day', label: 'Day' },
					{ key: 'requests', label: 'Requests', align: 'right' },
					{ key: 'uniqueInstalls', label: 'Unique Installs', align: 'right' },
				]}
				rows={data.dailyRows as DailyRow[]}
				emptyMessage="No traffic rows match the current search."
			/>
		</div>
	);
}
