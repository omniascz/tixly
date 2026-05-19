import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SalesSparkline } from '../SalesSparkline';

describe('SalesSparkline', () => {
  it('renders fallback when no data', () => {
    render(<SalesSparkline data={[]} />);
    expect(screen.getByText('Žádná data')).toBeInTheDocument();
  });

  it('renders SVG with polyline for non-empty data', () => {
    const data = [
      { date: '2026-04-15', value: 100 },
      { date: '2026-04-16', value: 250 },
      { date: '2026-04-17', value: 180 },
    ];
    const { container } = render(<SalesSparkline data={data} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    const polyline = container.querySelector('polyline');
    expect(polyline).not.toBeNull();
    expect(polyline?.getAttribute('points')?.split(' ')).toHaveLength(3);
  });

  it('renders area polygon under the line', () => {
    const data = [
      { date: '2026-04-15', value: 100 },
      { date: '2026-04-16', value: 200 },
    ];
    const { container } = render(<SalesSparkline data={data} />);
    expect(container.querySelector('polygon')).not.toBeNull();
  });

  it('uses ARIA role and label for screen readers', () => {
    const data = [{ date: '2026-04-15', value: 100 }];
    render(<SalesSparkline data={data} />);
    expect(screen.getByRole('img', { name: 'Graf prodejů' })).toBeInTheDocument();
  });
});
