import { ChartCard } from '@/shared/ui/ChartCard';
import { GlassCard } from '@/shared/ui/GlassCard';
import { KpiCard } from '@/shared/ui/KpiCard';
import { WeatherConditionIcon } from '@/shared/ui/WeatherConditionIcon';
import type { BackendEndpointStatus, CloudflareSnapshot, OverviewData, OverviewWeather } from '@/shared/types/dashboard';

type OverviewSectionProps = {
	data: OverviewData;
	weather: OverviewWeather;
	cloudflare: CloudflareSnapshot;
	endpointStatuses: BackendEndpointStatus[];
};

export function OverviewSection({ data, weather, cloudflare, endpointStatuses }: OverviewSectionProps) {
	return (
		<div className="section-grid section-grid--overview">
			<GlassCard
				title="System Overview"
				subtitle="Cloudflare edge telemetry"
				className="overview-system-card"
			>
				<div className="overview-system-card__metrics">
					{data.systemKpis.map((metric) => (
						<KpiCard key={metric.label} metric={metric} />
					))}
				</div>
				<div className="overview-system-card__status">
					<p className="status-pill">Edge Health: Stable</p>
					<p className="status-text">
						{cloudflare.error
							? cloudflare.error
							: cloudflare.overview?.latest_received_utc
								? `Latest event: ${cloudflare.overview.latest_received_utc}`
								: 'Waiting for backend data.'}
					</p>
				</div>
			</GlassCard>

			<ChartCard
				title="Traffic Last 24 Hours"
				subtitle="Requests and unique installs"
				mode="area"
				data={data.traffic24h}
				className="overview-traffic-chart"
				series={[
					{ key: 'requests', label: 'Requests', color: 'var(--accent)' },
					{ key: 'installs', label: 'Unique installs', color: 'var(--accent-2)' },
				]}
			/>

			<GlassCard title="Weather Snapshot" subtitle={`${weather.city}, ${weather.country}`} className="overview-weather-glance">
				<div className="overview-weather-card">
					<div className="overview-weather-card__temp">
						<WeatherConditionIcon condition={weather.condition} size={26} />
						<span>{typeof weather.currentTempC === 'number' ? `${weather.currentTempC.toFixed(1)} C` : '--'}</span>
					</div>
					{weather.available ? (
						<>
							<p>{weather.conditionLabel}</p>
							<div className="overview-weather-card__meta">
								<span>
									Feels like {typeof weather.feelsLikeC === 'number' ? `${weather.feelsLikeC.toFixed(1)} C` : '--'}
								</span>
								<span>
									{typeof weather.minTempC === 'number' ? `${weather.minTempC.toFixed(1)} C` : '--'} /{' '}
									{typeof weather.maxTempC === 'number' ? `${weather.maxTempC.toFixed(1)} C` : '--'}
								</span>
								<span>
									{typeof weather.windKph === 'number' ? `${weather.windKph.toFixed(0)} km/h` : '--'} {weather.windDirection ?? ''}
								</span>
								{weather.updatedAt && <span>Updated {weather.updatedAt}</span>}
							</div>
						</>
					) : (
						<div className="overview-weather-card__meta">
							<span>Weather source unavailable.</span>
							{weather.error && <span>{weather.error}</span>}
						</div>
					)}
				</div>
			</GlassCard>

			<GlassCard title="Recent Security Events" className="compact-card overview-events-card">
				<ul className="simple-list">
					{data.recentSecurityEvents.length > 0 ? (
						data.recentSecurityEvents.map((event) => (
							<li key={`${event.time}-${event.event}`}>
								<strong>{event.time}</strong>
								<span>{event.event}</span>
								<em>{event.level}</em>
							</li>
						))
					) : (
						<li>
							<strong>--</strong>
							<span>No security events from backend.</span>
							<em>--</em>
						</li>
					)}
				</ul>
			</GlassCard>

			<GlassCard title="Latest Daily Highlights" className="compact-card overview-countries-card">
				<ul className="simple-list">
					{data.dailyHighlights.length > 0 ? (
						data.dailyHighlights.map((item) => (
							<li key={item.label}>
								<strong>{item.label}</strong>
								<em>{item.value}</em>
							</li>
						))
					) : (
						<li>
							<strong>--</strong>
							<em>No daily series available.</em>
						</li>
					)}
				</ul>
			</GlassCard>

			<GlassCard title="Backend Endpoints" className="compact-card overview-endpoints-card">
				<ul className="simple-list endpoint-list">
					{endpointStatuses.map((item) => (
						<li key={item.label}>
							<strong>{item.label}</strong>
							<span>{item.detail}</span>
							<em className={item.online ? 'endpoint-state endpoint-state--up' : 'endpoint-state endpoint-state--down'}>
								{item.online ? 'Up' : 'Down'}
							</em>
						</li>
					))}
				</ul>
			</GlassCard>
		</div>
	);
}
