import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DataTable, Column } from '../DataTable';

interface Row {
  id: string;
  name: string;
  total: number;
}

const columns: Column<Row>[] = [
  { key: 'name', header: 'Název', render: (r) => <span>{r.name}</span> },
  { key: 'total', header: 'Částka', render: (r) => <span>{r.total} Kč</span> },
];

describe('DataTable', () => {
  it('renders headers and rows', () => {
    const rows: Row[] = [
      { id: '1', name: 'Alpha', total: 100 },
      { id: '2', name: 'Beta', total: 200 },
    ];
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);

    expect(screen.getByText('Název')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('200 Kč')).toBeInTheDocument();
  });

  it('shows empty message when no rows', () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        emptyMessage="Nic tu není"
      />,
    );
    expect(screen.getByText('Nic tu není')).toBeInTheDocument();
  });

  it('renders skeleton rows when loading', () => {
    const { container } = render(
      <DataTable columns={columns} rows={[]} rowKey={(r) => r.id} loading />,
    );
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});
