import { ChartCard } from '@/shared/ui/ChartCard';
import { KpiCard } from '@/shared/ui/KpiCard';
import { TableCard } from '@/shared/ui/TableCard';
import type { GenericRow, SecurityData } from '@/shared/types/dashboard';

type SecuritySectionProps = {
	data: SecurityData;
};

type SecurityRow = SecurityData['recentEvents'][number] & GenericRow;

export function SecuritySection({ data }: SecuritySectionProps) {
	return (
		<div className="section-grid section-grid--security">
			<div className="kpi-row">
				{data.kpis.map((metric) => (
					<KpiCard key={metric.label} metric={metric} />
				))}
			</div>

			<ChartCard
				title="Top Threat Types"
				subtitle="Events by type"
				mode="bar"
				data={data.threats}
				className="security-distribution-chart"
				series={[{ key: 'total', label: 'Events', color: 'var(--accent)' }]}
			/>

			<ChartCard
				title="Threat Share"
				subtitle="Relative event distribution"
				mode="donut"
				data={data.threats}
				className="security-threat-chart"
				series={[{ key: 'total', label: 'Events' }]}
			/>

			<TableCard<SecurityRow>
				title="Security Event Breakdown"
				subtitle="Current events from backend"
				className="security-events-table"
				columns={[
					{ key: 'event', label: 'Event' },
					{ key: 'total', label: 'Total', align: 'right' },
					{ key: 'share', label: 'Share', align: 'right' },
					{ key: 'lastSeen', label: 'Last Seen', align: 'right' },
				]}
				rows={data.recentEvents as SecurityRow[]}
				emptyMessage="No security events match the current search."
			/>
		</div>
	);
}
