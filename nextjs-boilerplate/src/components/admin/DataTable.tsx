import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: string;
  className?: string;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
  loading?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyMessage = 'Žádná data',
  loading = false,
}: DataTableProps<T>) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr className="border-b text-left">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  'h-10 px-4 text-xs font-medium uppercase tracking-wide text-muted-foreground',
                  col.className,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <tr key={`loading-${i}`} className="border-b last:border-0">
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3">
                    <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-12 text-center text-sm text-muted-foreground"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="border-b last:border-0 hover:bg-muted/30">
                {columns.map((col) => (
                  <td key={col.key} className={cn('px-4 py-3', col.className)}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
