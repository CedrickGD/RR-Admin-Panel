import { type FormEvent, useEffect, useMemo, useState } from 'react';
import {
	Activity,
	AlertTriangle,
	ArrowDown,
	ArrowUp,
	BarChart3,
	ChevronLeft,
	Cpu,
	Eye,
	EyeOff,
	Gauge,
	Globe,
	LayoutDashboard,
	LogOut,
	Moon,
	RefreshCw,
	Settings,
	Shield,
	ShieldCheck,
	ShieldX,
	Sun,
	type LucideIcon,
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetchCloudflareSnapshot } from '@/features/dashboard/services/cloudflareApi';
import type { CloudflareSnapshot } from '@/shared/types/dashboard';

type ThemeMode = 'dark' | 'light';
type NavigationView = 'Overview' | 'Analytics' | 'DNS' | 'Firewall' | 'Workers' | 'Settings';
type TrendDirection = 'up' | 'down' | 'neutral';
type EventType = 'blocked' | 'allowed' | 'challenged';

type NavItem = {
	label: NavigationView;
	icon: LucideIcon;
};

type KpiCardItem = {
	title: string;
	value: string;
	change: string;
	trend: TrendDirection;
	icon: LucideIcon;
};

type TrafficRow = {
	time: string;
	requests: number;
	installs: number;
};

type FirewallEventRow = {
	id: string;
	type: EventType;
	event: string;
	total: string;
	share: string;
	lastSeen: string;
};

type DonutSlice = {
	name: string;
	value: number;
	color: string;
};

type DonutPanel = {
	title: string;
	subtitle: string;
	data: DonutSlice[];
	delay: number;
};

type ChartTooltipPayloadItem = {
	color?: string;
	fill?: string;
	stroke?: string;
	name?: string;
	value?: number | string;
	payload?: {
		color?: string;
		fill?: string;
		stroke?: string;
	};
};

type DonutTooltipProps = {
	active?: boolean;
	payload?: ChartTooltipPayloadItem[];
	total: number;
};

type TrafficTooltipProps = {
	active?: boolean;
	label?: string | number;
	payload?: ChartTooltipPayloadItem[];
};

const THEME_STORAGE_KEY = 'cf_dashboard_theme';

const DEFAULT_BACKEND_URL = 'http://localhost:5035/api';
const CLOUDFLARE_POLL_MS = 15_000;

const NAV_ITEMS: NavItem[] = [
	{ icon: LayoutDashboard, label: 'Overview' },
	{ icon: BarChart3, label: 'Analytics' },
	{ icon: Globe, label: 'DNS' },
	{ icon: Shield, label: 'Firewall' },
	{ icon: Cpu, label: 'Workers' },
	{ icon: Settings, label: 'Settings' },
];

const DONUT_COLORS = ['hsl(270 95% 60%)', 'hsl(200 95% 55%)', 'hsl(150 80% 50%)', 'hsl(40 95% 55%)', 'hsl(220 15% 50%)'];

const formatTooltipNumber = (value: number | string | undefined): string => {
	const parsed = typeof value === 'number' ? value : Number(value ?? 0);
	const numericValue = Number.isFinite(parsed) ? parsed : 0;
	return numericValue.toLocaleString();
};

const isTooltipEntry = (value: unknown): value is ChartTooltipPayloadItem =>
	Boolean(value) && typeof value === 'object';

const normalizeTooltipColor = (value: unknown): string | undefined => {
	if (typeof value !== 'string') {
		return undefined;
	}

	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return undefined;
	}

	const normalized = trimmed.toLowerCase();
	if (
		normalized === 'currentcolor' ||
		normalized === 'inherit' ||
		normalized === 'initial' ||
		normalized === 'unset' ||
		normalized === 'revert'
	) {
		return undefined;
	}

	return trimmed;
};

const getTooltipDotColor = (entry: unknown): string => {
	if (!isTooltipEntry(entry)) {
		return 'hsl(var(--primary))';
	}

	const nestedPayload = isTooltipEntry(entry.payload) ? entry.payload : undefined;
	const colorCandidate =
		normalizeTooltipColor(nestedPayload?.color) ??
		normalizeTooltipColor(nestedPayload?.fill) ??
		normalizeTooltipColor(nestedPayload?.stroke) ??
		normalizeTooltipColor(entry.fill) ??
		normalizeTooltipColor(entry.stroke) ??
		normalizeTooltipColor(entry.color);

	return colorCandidate ?? 'hsl(var(--primary))';
};

function DonutTooltip({ active, payload, total }: DonutTooltipProps) {
	if (!active || !payload || payload.length === 0) {
		return null;
	}

	const entry = payload.find(isTooltipEntry);
	if (!entry) {
		return null;
	}

	const parsedValue = typeof entry.value === 'number' ? entry.value : Number(entry.value ?? 0);
	const numericValue = Number.isFinite(parsedValue) ? parsedValue : 0;
	const share = total > 0 ? (numericValue / total) * 100 : 0;

	return (
		<div className="cp-chart-tooltip" role="presentation">
			<div className="cp-chart-tooltip-row">
				<div className="cp-chart-tooltip-series">
					<span className="cp-chart-tooltip-dot" style={{ color: getTooltipDotColor(entry) }}>
						●
					</span>
					<span className="cp-chart-tooltip-name">{String(entry.name ?? 'Value')}</span>
				</div>
				<span className="cp-chart-tooltip-value">
					{formatTooltipNumber(numericValue)} ({share.toFixed(1)}%)
				</span>
			</div>
		</div>
	);
}

function TrafficTooltip({ active, label, payload }: TrafficTooltipProps) {
	if (!active || !payload || payload.length === 0) {
		return null;
	}

	const rows = payload.filter(isTooltipEntry);
	if (rows.length === 0) {
		return null;
	}

	return (
		<div className="cp-chart-tooltip" role="presentation">
			{label !== undefined && label !== null && <div className="cp-chart-tooltip-label">{String(label)}</div>}
			{rows.map((entry, index) => (
				<div className="cp-chart-tooltip-row" key={`traffic-tooltip-${String(entry.name ?? index)}`}>
					<div className="cp-chart-tooltip-series">
						<span className="cp-chart-tooltip-dot" style={{ color: getTooltipDotColor(entry) }}>
							●
						</span>
						<span className="cp-chart-tooltip-name">{String(entry.name ?? 'Value')}</span>
					</div>
					<span className="cp-chart-tooltip-value">{formatTooltipNumber(entry.value)}</span>
				</div>
			))}
		</div>
	);
}

const EVENT_META: Record<EventType, { icon: LucideIcon; className: string }> = {
	blocked: { icon: ShieldX, className: 'is-blocked' },
	allowed: { icon: ShieldCheck, className: 'is-allowed' },
	challenged: { icon: AlertTriangle, className: 'is-challenged' },
};

const getInitialTheme = (): ThemeMode => {
	if (typeof window === 'undefined') {
		return 'dark';
	}

	const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
	if (storedTheme === 'light' || storedTheme === 'dark') {
		return storedTheme;
	}

	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const compactNumber = (value?: number): string => {
	if (typeof value !== 'number' || Number.isNaN(value)) {
		return '--';
	}

	return new Intl.NumberFormat('en-US', {
		notation: 'compact',
		maximumFractionDigits: 1,
	}).format(value);
};

const percentDelta = (current?: number, previous?: number): { text: string; trend: TrendDirection } => {
	if (typeof current !== 'number' || typeof previous !== 'number' || previous <= 0) {
		return { text: 'No baseline', trend: 'neutral' };
	}

	const delta = ((current - previous) / previous) * 100;
	if (Math.abs(delta) < 0.05) {
		return { text: '0.0%', trend: 'neutral' };
	}

	return {
		text: `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`,
		trend: delta >= 0 ? 'up' : 'down',
	};
};

const classifyEventType = (eventName: string): EventType => {
	const normalized = eventName.toLowerCase();
	if (normalized.includes('allow') || normalized.includes('success') || normalized.includes('pass')) {
		return 'allowed';
	}
	if (normalized.includes('challenge') || normalized.includes('captcha') || normalized.includes('rate')) {
		return 'challenged';
	}
	return 'blocked';
};

const humanizeEventName = (value: string): string =>
	value
		.replace(/_/g, ' ')
		.trim()
		.split(' ')
		.map((word) => (word.length > 0 ? `${word[0].toUpperCase()}${word.slice(1)}` : word))
		.join(' ');

const toTimeLabel = (value?: string): string => {
	if (!value) {
		return '--';
	}

	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return '--';
	}

	return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const buildEventTypeSlices = (items: Array<{ event_name: string; total: number }>): DonutSlice[] => {
	if (items.length === 0) {
		return [{ name: 'No Data', value: 1, color: 'hsl(220 15% 50%)' }];
	}

	const topItems = items.slice(0, 5);
	const remainder = items.slice(5).reduce((sum, item) => sum + item.total, 0);
	const slices = topItems.map((item, index) => ({
		name: humanizeEventName(item.event_name),
		value: item.total,
		color: DONUT_COLORS[index % DONUT_COLORS.length],
	}));

	if (remainder > 0) {
		slices.push({
			name: 'Other',
			value: remainder,
			color: DONUT_COLORS[slices.length % DONUT_COLORS.length],
		});
	}

	return slices;
};

const buildInstallWindowSlices = (snapshot: CloudflareSnapshot): DonutSlice[] => {
	const active24 = Math.max(snapshot.overview?.active_installs_24h ?? 0, 0);
	const active7 = Math.max(snapshot.overview?.active_installs_7d ?? 0, 0);
	const active30 = Math.max(snapshot.overview?.active_installs_30d ?? 0, 0);

	const slices: DonutSlice[] = [
		{ name: 'Active 24h', value: active24, color: 'hsl(270 95% 60%)' },
		{ name: '2-7 Days', value: Math.max(active7 - active24, 0), color: 'hsl(200 95% 55%)' },
		{ name: '8-30 Days', value: Math.max(active30 - active7, 0), color: 'hsl(150 80% 50%)' },
	];

	const hasData = slices.some((slice) => slice.value > 0);
	return hasData ? slices : [{ name: 'No Data', value: 1, color: 'hsl(220 15% 50%)' }];
};

const buildRequestWindowSlices = (snapshot: CloudflareSnapshot): DonutSlice[] => {
	const daily = snapshot.daily?.items ?? [];
	if (daily.length === 0) {
		return [{ name: 'No Data', value: 1, color: 'hsl(220 15% 50%)' }];
	}

	const last7 = daily.slice(-7).reduce((sum, item) => sum + item.total_events, 0);
	const prev7 = daily.slice(-14, -7).reduce((sum, item) => sum + item.total_events, 0);
	const older = daily.slice(0, -14).reduce((sum, item) => sum + item.total_events, 0);

	const slices = [
		{ name: 'Last 7 Days', value: last7, color: 'hsl(270 95% 60%)' },
		{ name: 'Previous 7 Days', value: prev7, color: 'hsl(200 95% 55%)' },
		{ name: 'Older', value: older, color: 'hsl(220 15% 50%)' },
	];

	const hasData = slices.some((slice) => slice.value > 0);
	return hasData ? slices : [{ name: 'No Data', value: 1, color: 'hsl(220 15% 50%)' }];
};

function App() {
	const [isAuthenticated, setIsAuthenticated] = useState(false);
	const [accessKey, setAccessKey] = useState('');
	const [backendUrl] = useState(DEFAULT_BACKEND_URL);
	const [showAccessKey, setShowAccessKey] = useState(false);
	const [loginError, setLoginError] = useState('');
	const [isAuthenticating, setIsAuthenticating] = useState(false);
	const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
	const [activeView, setActiveView] = useState<NavigationView>('Overview');
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [cloudflare, setCloudflare] = useState<CloudflareSnapshot>({ loading: false });

	useEffect(() => {
		document.documentElement.classList.toggle('dark', theme === 'dark');
		localStorage.setItem(THEME_STORAGE_KEY, theme);
	}, [theme]);

	const syncCloudflareData = async () => {
		setCloudflare((current) => ({ ...current, loading: true }));
		const snapshot = await fetchCloudflareSnapshot({
			backendUrl,
			adminApiKey: accessKey.trim().length > 0 ? accessKey.trim() : undefined,
			enabled: true,
		});
		setCloudflare(snapshot);
	};

	useEffect(() => {
		if (!isAuthenticated) {
			return;
		}

		let cancelled = false;

		const runSync = async (showLoading: boolean) => {
			if (showLoading) {
				setCloudflare((current) => ({ ...current, loading: true }));
			}
			const snapshot = await fetchCloudflareSnapshot({
				backendUrl,
				adminApiKey: accessKey.trim().length > 0 ? accessKey.trim() : undefined,
				enabled: true,
			});

			if (!cancelled) {
				setCloudflare(snapshot);
			}
		};

		void runSync(true);
		const timer = window.setInterval(() => {
			void runSync(false);
		}, CLOUDFLARE_POLL_MS);

		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
	}, [isAuthenticated, backendUrl, accessKey]);

	const handleAuthenticate = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setLoginError('');

		const trimmedKey = accessKey.trim();
		if (!trimmedKey) {
			setLoginError('Key is required.');
			return;
		}

		setIsAuthenticating(true);
		await new Promise((resolve) => {
			window.setTimeout(resolve, 500);
		});

		setAccessKey(trimmedKey);
		setIsAuthenticated(true);
		setIsAuthenticating(false);
	};

	const handleLogout = () => {
		setIsAuthenticated(false);
		setAccessKey('');
		setShowAccessKey(false);
		setLoginError('');
		setActiveView('Overview');
		setCloudflare({ loading: false });
	};

	const toggleTheme = () => {
		setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
	};

	const dashboardData = useMemo(() => {
		const overview = cloudflare.overview;
		const events = cloudflare.eventsByType?.items ?? [];
		const daily = cloudflare.daily?.items ?? [];

		const latestDay = daily.at(-1);
		const previousDay = daily.at(-2);
		const totalEventRows = events.reduce((sum, row) => sum + row.total, 0);
		const topEvent = events[0];
		const backendName = cloudflare.connectedBackendName ?? 'Cloudflare upstream';
		const lastSeen = toTimeLabel(cloudflare.fetchedAtUtc);
		const requestDelta = percentDelta(latestDay?.total_events, previousDay?.total_events);
		const installDelta = percentDelta(latestDay?.unique_installs, previousDay?.unique_installs);

		const totalRequests = overview?.total_events ?? daily.reduce((sum, row) => sum + row.total_events, 0);

		const kpis: KpiCardItem[] = [
			{
				title: 'Total Requests',
				value: compactNumber(totalRequests),
				change: requestDelta.text,
				trend: requestDelta.trend,
				icon: Globe,
			},
			{
				title: 'Active Installs (24h)',
				value: compactNumber(overview?.active_installs_24h),
				change:
					typeof overview?.active_installs_7d === 'number'
						? `${compactNumber(overview.active_installs_7d)} in 7d`
						: 'No data',
				trend: 'up',
				icon: Shield,
			},
			{
				title: 'Unique Installs',
				value: compactNumber(overview?.total_unique_installs),
				change: installDelta.text,
				trend: installDelta.trend,
				icon: Activity,
			},
			{
				title: 'Event Types',
				value: events.length > 0 ? events.length.toString() : '--',
				change: topEvent ? `${humanizeEventName(topEvent.event_name)}` : 'No data',
				trend: 'neutral',
				icon: Gauge,
			},
		];

		const trafficSeries: TrafficRow[] = daily.slice(-12).map((item) => ({
			time: item.day_utc.slice(5),
			requests: item.total_events,
			installs: item.unique_installs,
		}));

		const firewallRows: FirewallEventRow[] = events.slice(0, 6).map((item, index) => ({
			id: `${item.event_name}-${index}`,
			type: classifyEventType(item.event_name),
			event: humanizeEventName(item.event_name),
			total: item.total.toLocaleString(),
			share: totalEventRows > 0 ? `${((item.total / totalEventRows) * 100).toFixed(1)}%` : '0.0%',
			lastSeen,
		}));

		const donutPanels: DonutPanel[] = [
			{
				title: 'Event Type Split',
				subtitle: 'Top Cloudflare events by share',
				data: buildEventTypeSlices(events),
				delay: 300,
			},
			{
				title: 'Active Install Window',
				subtitle: '24h vs 7d vs 30d activity',
				data: buildInstallWindowSlices(cloudflare),
				delay: 350,
			},
			{
				title: 'Request Window',
				subtitle: 'Recent daily request buckets',
				data: buildRequestWindowSlices(cloudflare),
				delay: 400,
			},
		];

		const syncText = cloudflare.loading
			? 'Syncing Cloudflare data'
			: cloudflare.error
				? 'Cloudflare sync issue'
				: `${backendName} live`;

		return {
			backendName,
			donutPanels,
			firewallRows,
			kpis,
			syncText,
			trafficSeries,
			lastSeen,
		};
	}, [cloudflare]);

	if (!isAuthenticated) {
		return (
			<div className="cp-auth-shell">
				<div className="cp-auth-card cp-fade-in">
					<div className="cp-auth-intro">
						<div className="cp-logo-badge">
							<Shield className="icon-lg" />
						</div>
						<h1>CloudPanel</h1>
						<p>Private Backend Dashboard</p>
					</div>

					<form className="cp-auth-form" onSubmit={handleAuthenticate}>
						<label htmlFor="access-key">Private Backend Key</label>
						<div className="cp-auth-input-wrap">
							<input
								autoFocus
								id="access-key"
								maxLength={256}
								onChange={(event) => {
									setAccessKey(event.target.value);
									setLoginError('');
								}}
								placeholder="Enter your private backend key"
								type={showAccessKey ? 'text' : 'password'}
								value={accessKey}
							/>
							<button
								aria-label={showAccessKey ? 'Hide access key' : 'Show access key'}
								type="button"
								onClick={() => setShowAccessKey((current) => !current)}
							>
								{showAccessKey ? <EyeOff className="icon-sm" /> : <Eye className="icon-sm" />}
							</button>
						</div>

						<div className="cp-auth-hint-row">
							<span>Required. Sent as X-Admin-Key on each backend request.</span>
							<span className="cp-valid">Secure session only</span>
						</div>

						{loginError && (
							<div className="cp-auth-error">
								<AlertTriangle className="icon-sm" />
								{loginError}
							</div>
						)}

						<button
							disabled={!accessKey.trim() || isAuthenticating}
							type="submit"
						>
							{isAuthenticating ? (
								<span className="cp-auth-loading">
									<span className="cp-spinner" />
									Connecting...
								</span>
							) : (
								'Open Dashboard'
							)}
						</button>
					</form>

					<p className="cp-auth-footnote">Secured connection . Cloudflare-backed data</p>
				</div>
			</div>
		);
	}

	return (
		<div className="cp-shell">
			<aside className={`cp-sidebar ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
				<div className="cp-sidebar-brand">
					<div className="cp-logo-badge is-small">
						<Shield className="icon-sm" />
					</div>
					<span>CloudPanel</span>
				</div>

				<nav className="cp-sidebar-nav">
					{NAV_ITEMS.map((item) => {
						const isActive = activeView === item.label;
						const ItemIcon = item.icon;
						return (
							<button
								className={`cp-sidebar-link ${isActive ? 'is-active' : ''}`}
								key={item.label}
								onClick={() => setActiveView(item.label)}
								type="button"
							>
								<ItemIcon className="icon-sm" />
								<span>{item.label}</span>
							</button>
						);
					})}
				</nav>

				<div className="cp-sidebar-actions">
					<button className="cp-sidebar-link" onClick={() => setSidebarCollapsed((current) => !current)} type="button">
						<ChevronLeft className={`icon-sm cp-chevron ${sidebarCollapsed ? 'is-rotated' : ''}`} />
						<span>Collapse</span>
					</button>
					<button className="cp-sidebar-link is-danger" onClick={handleLogout} type="button">
						<LogOut className="icon-sm" />
						<span>Logout</span>
					</button>
				</div>
			</aside>

			<div className="cp-main">
				<header className="cp-header">
					<h1>{activeView}</h1>
					<div className="cp-header-right">
						<div className="cp-system-status" title={dashboardData.backendName}>
							<span className={`cp-system-dot ${cloudflare.error ? 'is-error' : ''}`} />
							{dashboardData.syncText}
						</div>
						<button className="cp-refresh-button" onClick={() => void syncCloudflareData()} type="button">
							<RefreshCw className={`icon-sm ${cloudflare.loading ? 'cp-spin' : ''}`} />
						</button>
						<button className="cp-theme-toggle" onClick={toggleTheme} type="button">
							{theme === 'dark' ? <Moon className="icon-sm" /> : <Sun className="icon-sm" />}
						</button>
					</div>
				</header>

				<main className="cp-content">
					{cloudflare.error && !cloudflare.loading && (
						<div className="cp-banner is-error">{cloudflare.error}</div>
					)}
					{cloudflare.loading && <div className="cp-banner">Syncing Cloudflare data...</div>}

					{activeView !== 'Overview' ? (
						<section className="cp-placeholder cp-fade-in">
							<BarChart3 className="icon-lg" />
							<h2>{activeView}</h2>
							<p>This section is intentionally left as a placeholder in the reference design.</p>
						</section>
					) : (
						<>
							<section className="cp-kpi-grid">
								{dashboardData.kpis.map((item, index) => {
									const ItemIcon = item.icon;
									const TrendIcon = item.trend === 'down' ? ArrowDown : ArrowUp;
									return (
										<article className="cp-kpi-card cp-fade-in" key={item.title} style={{ animationDelay: `${index * 50}ms` }}>
											<div className="cp-kpi-head">
												<span>{item.title}</span>
												<div className="cp-kpi-icon">
													<ItemIcon className="icon-sm" />
												</div>
											</div>
											<strong>{item.value}</strong>
											<div className={`cp-kpi-trend is-${item.trend}`}>
												<TrendIcon className="icon-xs" />
												{item.change}
												<span>vs baseline</span>
											</div>
										</article>
									);
								})}
							</section>

							<section className="cp-overview-grid">
								<article className="cp-panel cp-fade-in" style={{ animationDelay: '200ms' }}>
									<div className="cp-panel-head">
										<div>
											<h2>Traffic Overview</h2>
											<p>Requests and unique installs (daily)</p>
										</div>
										<div className="cp-legend-inline">
											<span>
												<i className="dot dot-primary" />
												Requests
											</span>
											<span>
												<i className="dot dot-info" />
												Unique Installs
											</span>
										</div>
									</div>

									<div className="cp-chart-wrap">
										<ResponsiveContainer height="100%" width="100%">
											<AreaChart data={dashboardData.trafficSeries}>
												<defs>
													<linearGradient id="requestsGradient" x1="0" x2="0" y1="0" y2="1">
														<stop offset="0%" stopColor="hsl(270 95% 60%)" stopOpacity={0.32} />
														<stop offset="100%" stopColor="hsl(270 95% 60%)" stopOpacity={0} />
													</linearGradient>
													<linearGradient id="installsGradient" x1="0" x2="0" y1="0" y2="1">
														<stop offset="0%" stopColor="hsl(200 95% 55%)" stopOpacity={0.24} />
														<stop offset="100%" stopColor="hsl(200 95% 55%)" stopOpacity={0} />
													</linearGradient>
												</defs>
												<CartesianGrid stroke="hsl(var(--border) / 0.55)" strokeDasharray="3 3" vertical={false} />
												<XAxis axisLine={false} dataKey="time" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} tickLine={false} />
												<YAxis
													axisLine={false}
													tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
													tickFormatter={(value: number) => `${Math.round(value / 1000)}k`}
													tickLine={false}
												/>
												<Tooltip
													content={<TrafficTooltip />}
													cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
												/>
												<Area dataKey="requests" fill="url(#requestsGradient)" isAnimationActive={false} name="Requests" stroke="hsl(270 95% 60%)" strokeWidth={2} type="monotone" />
												<Area dataKey="installs" fill="url(#installsGradient)" isAnimationActive={false} name="Unique Installs" stroke="hsl(200 95% 55%)" strokeWidth={2} type="monotone" />
											</AreaChart>
										</ResponsiveContainer>
									</div>
								</article>

								<article className="cp-panel cp-fade-in" style={{ animationDelay: '300ms' }}>
									<div className="cp-panel-head">
										<div>
											<h2>Event Stream</h2>
											<p>Cloudflare events by type</p>
										</div>
									</div>

									<div className="cp-event-list">
										{dashboardData.firewallRows.length === 0 && (
											<div className="cp-event-empty">No event data returned yet.</div>
										)}
										{dashboardData.firewallRows.map((eventItem) => {
											const meta = EVENT_META[eventItem.type];
											const EventIcon = meta.icon;
											return (
												<div className="cp-event-row" key={eventItem.id}>
													<div className={`cp-event-icon ${meta.className}`}>
														<EventIcon className="icon-xs" />
													</div>
													<div className="cp-event-meta">
														<div className="cp-event-main">
															<span className="cp-event-path">{eventItem.event}</span>
														</div>
														<p>{eventItem.total} events</p>
													</div>
													<div className="cp-event-time">
														<strong>{eventItem.share}</strong>
														<span>{eventItem.lastSeen}</span>
													</div>
												</div>
											);
										})}
									</div>
								</article>
							</section>

							<section className="cp-donut-grid">
								{dashboardData.donutPanels.map((panel) => {
									const total = panel.data.reduce((sum, item) => sum + item.value, 0);
									return (
										<article className="cp-panel cp-fade-in" key={panel.title} style={{ animationDelay: `${panel.delay}ms` }}>
											<div className="cp-panel-head">
												<div>
													<h2>{panel.title}</h2>
													<p>{panel.subtitle}</p>
												</div>
											</div>

											<div className="cp-donut-chart-row">
												<div className="cp-donut-visual">
													<ResponsiveContainer height="100%" width="100%">
														<PieChart>
																<Pie
																	cx="50%"
																	cy="50%"
																	data={panel.data}
																	dataKey="value"
																	innerRadius={42}
																	isAnimationActive={false}
																	outerRadius={62}
																	paddingAngle={3}
																	stroke="none"
																>
																{panel.data.map((item) => (
																	<Cell fill={item.color} key={`${panel.title}-${item.name}`} />
																))}
															</Pie>
															<Tooltip
																content={<DonutTooltip total={total} />}
															/>
														</PieChart>
													</ResponsiveContainer>
												</div>

												<div className="cp-donut-breakdown">
													{panel.data.map((item) => {
														const share = total > 0 ? (item.value / total) * 100 : 0;
														return (
															<div className="cp-donut-breakdown-row" key={`${panel.title}-${item.name}-legend`}>
																<div className="cp-donut-label">
																	<span className="cp-donut-dot" style={{ backgroundColor: item.color }} />
																	<span>{item.name}</span>
																</div>
																<strong>{share.toFixed(1)}%</strong>
															</div>
														);
													})}
												</div>
											</div>
										</article>
									);
								})}
							</section>
						</>
					)}
				</main>
			</div>
		</div>
	);
}

export default App;
