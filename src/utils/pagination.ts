export interface PaginatedSlice<T> {
  items: T[];
  page: number;
  pageCount: number;
  pageSize: number;
  start: number;
  end: number;
  total: number;
}

/**
 * Returns one bounded render window while preserving the full collection for
 * filtering, sorting, exports, maps, and access-control operations.
 */
export function paginate<T>(
  items: readonly T[],
  requestedPage: number,
  requestedPageSize: number,
): PaginatedSlice<T> {
  const pageSize = Math.max(1, Math.floor(requestedPageSize));
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.floor(requestedPage) || 1));
  const offset = (page - 1) * pageSize;
  const pageItems = items.slice(offset, offset + pageSize);

  return {
    items: pageItems,
    page,
    pageCount,
    pageSize,
    start: total === 0 ? 0 : offset + 1,
    end: offset + pageItems.length,
    total,
  };
}
