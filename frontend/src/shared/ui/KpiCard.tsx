import clsx from 'clsx';
import type { KpiMetric } from '@/shared/types/dashboard';

type KpiCardProps = {
	metric: KpiMetric;
};

export function KpiCard({ metric }: KpiCardProps) {
	return (
		<article className="kpi-card">
			<div className="kpi-card__header">
				<p className="kpi-card__label">{metric.label}</p>
				<span className={clsx('kpi-card__delta', `kpi-card__delta--${metric.trend}`)}>{metric.delta}</span>
			</div>
			<p className="kpi-card__value">{metric.value}</p>
			{metric.detail && <p className="kpi-card__detail">{metric.detail}</p>}
			{metric.sparkline && metric.sparkline.length > 1 && (
				<div className="kpi-card__sparkline" aria-hidden>
					{metric.sparkline.map((point, index) => (
						<span
							key={`${metric.label}-${index}`}
							style={{
								height: `${Math.max(point, 5)}%`,
							}}
						/>
					))}
				</div>
			)}
		</article>
	);
}
