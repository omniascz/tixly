import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatusBadge } from '../StatusBadge';

describe('StatusBadge', () => {
  it.each([
    ['paid', 'Zaplaceno', 'bg-emerald-100'],
    ['pending', 'Čeká na platbu', 'bg-amber-100'],
    ['cancelled', 'Zrušeno', 'bg-rose-100'],
    ['refunded', 'Vráceno', 'bg-slate-200'],
    ['expired', 'Vypršelo', 'bg-slate-100'],
  ] as const)('renders %s with Czech label and tone class', (status, label, tone) => {
    const { container } = render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.querySelector(`.${tone}`)).not.toBeNull();
  });
});
