import clsx from 'clsx';
import { GlassCard } from './GlassCard';
import type { GenericRow, TableColumn } from '@/shared/types/dashboard';

type TableCardProps<T extends GenericRow> = {
	title: string;
	subtitle?: string;
	columns: Array<TableColumn<T>>;
	rows: T[];
	onRowClick?: (row: T) => void;
	className?: string;
	emptyMessage?: string;
};

export function TableCard<T extends GenericRow>({
	title,
	subtitle,
	columns,
	rows,
	onRowClick,
	className,
	emptyMessage = 'No rows available.',
}: TableCardProps<T>) {
	return (
		<GlassCard title={title} subtitle={subtitle} className={`table-card ${className ?? ''}`.trim()} hoverable={false}>
			<div className="table-card__container">
				<table>
					<thead>
						<tr>
							{columns.map((column) => (
								<th
									key={String(column.key)}
									style={column.width ? { width: column.width } : undefined}
									className={clsx(column.align && `align-${column.align}`)}
								>
									{column.label}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.length > 0 ? (
							rows.map((row, rowIndex) => (
								<tr key={`row-${rowIndex}`} onClick={onRowClick ? () => onRowClick(row) : undefined}>
									{columns.map((column) => (
										<td key={`${rowIndex}-${String(column.key)}`} className={clsx(column.align && `align-${column.align}`)}>
											{column.render ? column.render(row) : String(row[column.key as string] ?? '')}
										</td>
									))}
								</tr>
							))
						) : (
							<tr>
								<td className="table-card__empty" colSpan={columns.length}>
									{emptyMessage}
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</GlassCard>
	);
}
