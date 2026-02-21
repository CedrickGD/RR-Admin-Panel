import clsx from 'clsx';
import type { FilterChip, FilterDropdown } from '@/shared/types/dashboard';

type FilterBarProps = {
	chips: FilterChip[];
	activeChipId: string;
	onChipSelect: (id: string) => void;
	dropdowns?: FilterDropdown[];
	onDropdownClick?: (id: string) => void;
};

export function FilterBar({ chips, activeChipId, onChipSelect, dropdowns, onDropdownClick }: FilterBarProps) {
	return (
		<div className="filter-bar">
			<div className="filter-bar__chips">
				{chips.map((chip) => (
					<button
						key={chip.id}
						type="button"
						onClick={() => onChipSelect(chip.id)}
						className={clsx('filter-chip', chip.id === activeChipId && 'filter-chip--active')}
					>
						{chip.label}
					</button>
				))}
			</div>
			{dropdowns && dropdowns.length > 0 && (
				<div className="filter-bar__dropdowns">
					{dropdowns.map((dropdown) => (
						<button
							key={dropdown.id}
							type="button"
							onClick={() => onDropdownClick?.(dropdown.id)}
							className="filter-dropdown"
						>
							<span>{dropdown.label}</span>
							<strong>{dropdown.value}</strong>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
