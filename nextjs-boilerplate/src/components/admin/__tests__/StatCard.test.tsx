import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCard } from '../StatCard';

describe('StatCard', () => {
  it('renders title and value', () => {
    render(<StatCard title="Tržby" value="12 345 Kč" />);
    expect(screen.getByText('Tržby')).toBeInTheDocument();
    expect(screen.getByText('12 345 Kč')).toBeInTheDocument();
  });

  it('renders positive trend with up arrow tone', () => {
    const { container } = render(<StatCard title="Růst" value="100" trend={5.4} />);
    expect(screen.getByText(/5\.4 %/)).toBeInTheDocument();
    expect(container.querySelector('.text-emerald-600')).not.toBeNull();
  });

  it('renders negative trend with down arrow tone', () => {
    const { container } = render(<StatCard title="Pokles" value="100" trend={-3.2} />);
    expect(screen.getByText(/3\.2 %/)).toBeInTheDocument();
    expect(container.querySelector('.text-rose-600')).not.toBeNull();
  });

  it('shows hint when provided', () => {
    render(<StatCard title="Akce" value="42" hint="Tento týden" />);
    expect(screen.getByText('Tento týden')).toBeInTheDocument();
  });
});
