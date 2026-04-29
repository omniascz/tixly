import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="Nic tu není" />);
    expect(screen.getByText('Nic tu není')).toBeInTheDocument();
  });

  it('renders description and action when provided', () => {
    render(
      <EmptyState
        title="Žádná akce"
        description="Vytvořte první akci"
        action={<button type="button">Přidat</button>}
      />,
    );
    expect(screen.getByText('Vytvořte první akci')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Přidat' })).toBeInTheDocument();
  });
});
