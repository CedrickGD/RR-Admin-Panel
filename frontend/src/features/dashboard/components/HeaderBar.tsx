import { Moon, RefreshCw, Search, Sun } from 'lucide-react';
import goodLogo from '@/Images/goodlogo.png';
import type { ThemeMode } from '@/shared/types/dashboard';

type HeaderBarProps = {
	sectionTitle: string;
	syncLabel: string;
	isLive: boolean;
	theme: ThemeMode;
	onThemeToggle: () => void;
	searchQuery: string;
	onSearchQueryChange: (value: string) => void;
	backendName: string;
	backendOnline: boolean;
	resultCount: number;
	onRefresh: () => void;
	refreshing: boolean;
};

export function HeaderBar({
	sectionTitle,
	syncLabel,
	isLive,
	theme,
	onThemeToggle,
	searchQuery,
	onSearchQueryChange,
	backendName,
	backendOnline,
	resultCount,
	onRefresh,
	refreshing,
}: HeaderBarProps) {
	return (
		<header className="glass-header">
			<div className="glass-header__title-wrap">
				<h1>{sectionTitle}</h1>
			</div>
			<div className="glass-header__search">
				<Search size={16} />
				<input
					type="text"
					value={searchQuery}
					onChange={(event) => onSearchQueryChange(event.target.value)}
					placeholder="Search events, dates, KPIs..."
					aria-label="Global search"
				/>
			</div>
			<div className="glass-header__actions">
				<span className="header-range">Range: Last 24h / Zone: Global</span>
				{searchQuery.trim().length > 0 && (
					<span className="search-results-pill">{resultCount} matches</span>
				)}
				<span className={`sync-pill ${isLive ? 'sync-pill--live' : 'sync-pill--fallback'}`}>
					{isLive ? 'Live' : 'Fallback'}
				</span>
				<span className="sync-text">{syncLabel}</span>
				<div className="backend-status" title={backendName}>
					<span className={`backend-status__dot ${backendOnline ? 'backend-status__dot--online' : 'backend-status__dot--offline'}`} />
					<span className="backend-status__label">{backendName}</span>
				</div>
				<button type="button" className="theme-toggle" onClick={onThemeToggle}>
					{theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
					<span>{theme === 'dark' ? 'White' : 'Dark'}</span>
				</button>
				<button type="button" className="refresh-button" onClick={onRefresh} disabled={refreshing} aria-label="Refresh data">
					<RefreshCw size={14} className={refreshing ? 'refresh-button__icon refresh-button__icon--spinning' : 'refresh-button__icon'} />
					<span>{refreshing ? 'Refreshing' : 'Refresh'}</span>
				</button>
				<div className="header-avatar" aria-hidden>
					<img src={goodLogo} alt="" className="header-avatar__logo" />
				</div>
			</div>
		</header>
	);
}
