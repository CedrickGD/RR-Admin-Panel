/**
 * @startingPoint section="Data" subtitle="Sessions/users directory table with expandable detail rows" viewport="700x320"
 */
export interface DataTableProps {
  /** mono → JetBrains Mono cell; muted → secondary text color */
  columns: Array<{
    key: string;
    header: string;
    render?: (row: any, index: number) => React.ReactNode;
    mono?: boolean;
    muted?: boolean;
    width?: number | string;
  }>;
  rows: any[];
  rowKey?: (row: any, index: number) => string | number;
  /** Key of the currently expanded row (controlled), or null */
  expandedKey?: string | number | null;
  renderExpanded?: (row: any, index: number) => React.ReactNode;
  /** true when the table sits inside a Panel with padding="flush" */
  flush?: boolean;
}

export interface DetailGridProps {
  /** Label/value pairs rendered as inset mono cells, e.g. { k: "Session ID", v: "s_9f2e81c4" } */
  items: Array<{ k: string; v: string }>;
}
