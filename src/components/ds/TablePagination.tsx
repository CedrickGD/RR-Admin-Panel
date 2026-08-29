import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "./Button";

interface TablePaginationProps {
  page: number;
  pageCount: number;
  start: number;
  end: number;
  total: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
}

/** Small, keyboard-accessible pager used to keep large directory DOMs bounded. */
export function TablePagination({
  page,
  pageCount,
  start,
  end,
  total,
  itemLabel,
  onPageChange,
}: TablePaginationProps) {
  if (pageCount <= 1) return null;

  return (
    <nav className="table-pagination" aria-label={`${itemLabel} pagination`}>
      <span className="table-pagination-summary">
        {start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()} {itemLabel}
      </span>
      <div className="table-pagination-actions">
        <IconButton
          icon={<ChevronFirst />}
          disabled={page === 1}
          aria-label="First page"
          title="First page"
          onClick={() => onPageChange(1)}
        />
        <IconButton
          icon={<ChevronLeft />}
          disabled={page === 1}
          aria-label="Previous page"
          title="Previous page"
          onClick={() => onPageChange(page - 1)}
        />
        <span className="table-pagination-page">
          Page {page.toLocaleString()} of {pageCount.toLocaleString()}
        </span>
        <IconButton
          icon={<ChevronRight />}
          disabled={page === pageCount}
          aria-label="Next page"
          title="Next page"
          onClick={() => onPageChange(page + 1)}
        />
        <IconButton
          icon={<ChevronLast />}
          disabled={page === pageCount}
          aria-label="Last page"
          title="Last page"
          onClick={() => onPageChange(pageCount)}
        />
      </div>
    </nav>
  );
}
