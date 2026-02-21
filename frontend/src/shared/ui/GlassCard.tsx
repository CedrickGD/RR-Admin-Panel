import type { ReactNode } from 'react';
import clsx from 'clsx';

type GlassCardProps = {
	title?: string;
	subtitle?: string;
	actions?: ReactNode;
	children: ReactNode;
	className?: string;
	hoverable?: boolean;
};

export function GlassCard({ title, subtitle, actions, children, className, hoverable = true }: GlassCardProps) {
	return (
		<section className={clsx('glass-card', hoverable && 'glass-card--hoverable', className)}>
			{(title || subtitle || actions) && (
				<header className="glass-card__header">
					<div>
						{title && <h3 className="glass-card__title">{title}</h3>}
						{subtitle && <p className="glass-card__subtitle">{subtitle}</p>}
					</div>
					{actions && <div className="glass-card__actions">{actions}</div>}
				</header>
			)}
			<div className="glass-card__body">{children}</div>
		</section>
	);
}
