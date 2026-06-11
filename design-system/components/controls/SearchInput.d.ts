export interface SearchInputProps {
  value: string;
  onChange: (next: string) => void;
  /** e.g. "Search user, Discord, session id…" */
  placeholder?: string;
  style?: React.CSSProperties;
  className?: string;
}
