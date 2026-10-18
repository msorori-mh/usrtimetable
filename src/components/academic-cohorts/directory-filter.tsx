import type { ReactNode } from "react";


/** Labelled native select used by the cohort directory filters. */
export function DirectoryFilter({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children?: ReactNode;
}) {
  return (
    <label className="min-w-0 space-y-1.5 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {children}
      </select>
    </label>
  );
}
