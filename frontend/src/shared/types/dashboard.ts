import type { ReactNode } from 'react';

export type ThemeMode = 'dark' | 'light';

export type DashboardSection =
	| 'overview'
	| 'traffic'
	| 'security';

export type TrendState = 'up' | 'down' | 'neutral';

export type KpiMetric = {
	label: string;
	value: string;
	delta: string;
	trend: TrendState;
	detail?: string;
	sparkline?: number[];
};

export type ChartMode = 'line' | 'area' | 'bar' | 'donut';

export type ChartPoint = {
	label: string;
	[key: string]: string | number;
};

export type ChartSeries = {
	key: string;
	label: string;
	color?: string;
	gradientFrom?: string;
	gradientTo?: string;
	stackId?: string;
};

export type GenericRow = Record<string, string | number>;

export type TableColumn<T extends GenericRow> = {
	key: keyof T | string;
	label: string;
	align?: 'left' | 'center' | 'right';
	width?: string;
	render?: (row: T) => ReactNode;
};

export type FilterChip = {
	id: string;
	label: string;
};

export type FilterDropdown = {
	id: string;
	label: string;
	value: string;
};

export type WeatherCondition = 'sunny' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow';

export type WeatherHourlyPoint = {
	hour: string;
	tempC: number;
	precipChance: number;
};

export type WeatherDayPoint = {
	day: string;
	minC: number;
	maxC: number;
};

export type WeatherCityData = {
	key: string;
	city: string;
	country: string;
	condition: WeatherCondition;
	conditionLabel: string;
	currentTempC: number;
	feelsLikeC: number;
	minTempC: number;
	maxTempC: number;
	windKph: number;
	windDirection: string;
	humidity: number;
	precipChance: number;
	rainMm: number;
	updatedAt: string;
	hourly: WeatherHourlyPoint[];
	daily: WeatherDayPoint[];
};

export type OverviewData = {
	systemKpis: KpiMetric[];
	traffic24h: ChartPoint[];
	recentSecurityEvents: Array<{ time: string; event: string; level: string }>;
	dailyHighlights: Array<{ label: string; value: string }>;
};

export type TrafficData = {
	kpis: KpiMetric[];
	trafficOverTime: ChartPoint[];
	installsOverTime: ChartPoint[];
	dailyRows: Array<{
		day: string;
		requests: string;
		uniqueInstalls: string;
	}>;
};

export type SecurityData = {
	kpis: KpiMetric[];
	threats: ChartPoint[];
	recentEvents: Array<{
		event: string;
		total: string;
		share: string;
		lastSeen: string;
	}>;
};

export type OverviewWeather = {
	available: boolean;
	city: string;
	country: string;
	condition: WeatherCondition;
	conditionLabel: string;
	currentTempC?: number;
	feelsLikeC?: number;
	minTempC?: number;
	maxTempC?: number;
	windKph?: number;
	windDirection?: string;
	updatedAt?: string;
	error?: string;
};

export type BackendEndpointStatus = {
	label: string;
	online: boolean;
	detail: string;
};

export type PerformanceData = {
	kpis: KpiMetric[];
	latency: ChartPoint[];
	cacheSplit: ChartPoint[];
	protocols: Array<{ protocol: string; share: string; requests: string }>;
};

export type LogEntry = {
	id: string;
	time: string;
	status: number;
	method: string;
	path: string;
	colo: string;
	message: string;
	traceId: string;
	details: string;
};

export type ErrorsData = {
	kpis: KpiMetric[];
	statusTrend: ChartPoint[];
	logs: LogEntry[];
};

export type DashboardFallbackData = {
	overview: OverviewData;
	traffic: TrafficData;
	security: SecurityData;
	performance: PerformanceData;
	errors: ErrorsData;
	weather: Record<string, WeatherCityData>;
};

export type CloudflareOverview = {
	total_events: number;
	total_unique_installs: number;
	active_installs_24h: number;
	active_installs_7d: number;
	active_installs_30d: number;
	latest_received_utc: string | null;
};

export type CloudflareEventsByType = {
	items: Array<{ event_name: string; total: number }>;
};

export type CloudflareDaily = {
	days: number;
	items: Array<{
		day_utc: string;
		total_events: number;
		unique_installs: number;
	}>;
};

export type CloudflareWorkers = {
	items: Array<{
		worker_name: string;
		total_events: number;
		unique_installs: number;
		latest_received_utc: string | null;
	}>;
};

export type CloudflareAppOpens = {
	days: number;
	opens_24h: number;
	opens_7d: number;
	opens_30d: number;
	opens_all_time: number;
	unique_installs_24h: number;
	unique_installs_7d: number;
	unique_installs_30d: number;
	unique_installs_all_time: number;
	latest_received_utc: string | null;
	items: Array<{
		day_utc: string;
		opens: number;
		unique_installs: number;
	}>;
};

export type CloudflareSessions = {
	days: number;
	limit: number;
	latest_app_start_utc: string | null;
	latest_session_end_utc: string | null;
	active_sessions: number;
	sessions_started_24h: number;
	sessions_started_7d: number;
	sessions_started_30d: number;
	sessions_started_all_time: number;
	sessions_ended_all_time: number;
	avg_duration_seconds_24h: number | null;
	avg_duration_seconds_7d: number | null;
	avg_duration_seconds_30d: number | null;
	avg_duration_seconds_all_time: number | null;
	items: Array<{
		session_id: string;
		install_id_hash: string;
		started_utc: string;
		started_received_utc: string;
		ended_utc: string | null;
		ended_received_utc: string | null;
		duration_seconds: number | null;
		is_active: boolean;
	}>;
};

export type CloudflareSnapshot = {
	overview?: CloudflareOverview;
	eventsByType?: CloudflareEventsByType;
	daily?: CloudflareDaily;
	workers?: CloudflareWorkers;
	appOpens?: CloudflareAppOpens;
	sessions?: CloudflareSessions;
	connectedBackendName?: string;
	error?: string;
	loading: boolean;
	fetchedAtUtc?: string;
};

export type LoginFormState = {
	username: string;
	password: string;
	backendUrl: string;
	rememberMe: boolean;
};
