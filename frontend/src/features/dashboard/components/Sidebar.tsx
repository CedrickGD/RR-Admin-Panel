import clsx from 'clsx';
import {
	Activity,
	LayoutDashboard,
	type LucideIcon,
	PanelLeftClose,
	PanelLeftOpen,
	ShieldAlert,
} from 'lucide-react';
import goodLogo from '@/Images/goodlogo.png';
import type { DashboardSection } from '@/shared/types/dashboard';

type SidebarProps = {
	activeSection: DashboardSection;
	collapsed: boolean;
	onSectionChange: (section: DashboardSection) => void;
	onCollapseToggle: () => void;
};

const navItems: Array<{ id: DashboardSection; label: string; icon: LucideIcon }> = [
	{ id: 'overview', label: 'Overview', icon: LayoutDashboard },
	{ id: 'traffic', label: 'Traffic', icon: Activity },
	{ id: 'security', label: 'Security', icon: ShieldAlert },
];

export function Sidebar({ activeSection, collapsed, onSectionChange, onCollapseToggle }: SidebarProps) {
	return (
		<aside className={clsx('glass-sidebar', collapsed && 'glass-sidebar--collapsed')}>
			<div className="glass-sidebar__brand">
				<img src={goodLogo} alt="Razor Reaper logo" className="brand-logo" />
				<span className="brand-label">Razor Reaper</span>
			</div>
			<nav>
				{navItems.map((item) => {
					const Icon = item.icon;
					const isActive = item.id === activeSection;
					return (
						<button
							key={item.id}
							type="button"
							onClick={() => onSectionChange(item.id)}
							className={clsx('sidebar-link', isActive && 'sidebar-link--active')}
							title={collapsed ? item.label : undefined}
							data-tooltip={collapsed ? item.label : undefined}
						>
							<Icon size={18} />
							<span className="sidebar-link__label">{item.label}</span>
						</button>
					);
				})}
			</nav>
			<button type="button" className="sidebar-collapse" onClick={onCollapseToggle}>
				{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
				<span>{collapsed ? 'Expand' : 'Collapse'}</span>
			</button>
		</aside>
	);
}
