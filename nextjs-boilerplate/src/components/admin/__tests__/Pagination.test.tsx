import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pagination } from '../Pagination';

describe('Pagination', () => {
  it('renders nothing when totalPages <= 1', () => {
    const { container } = render(
      <Pagination page={1} totalPages={1} onChange={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows current page indicator', () => {
    render(<Pagination page={3} totalPages={10} onChange={() => {}} />);
    expect(screen.getByText('Stránka 3 z 10')).toBeInTheDocument();
  });

  it('disables Previous on first page', () => {
    render(<Pagination page={1} totalPages={5} onChange={() => {}} />);
    const prev = screen.getByRole('button', { name: /předchozí/i });
    expect(prev).toBeDisabled();
  });

  it('disables Next on last page', () => {
    render(<Pagination page={5} totalPages={5} onChange={() => {}} />);
    const next = screen.getByRole('button', { name: /další/i });
    expect(next).toBeDisabled();
  });

  it('calls onChange with next page', async () => {
    const onChange = vi.fn();
    render(<Pagination page={2} totalPages={5} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /další/i }));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('calls onChange with previous page', async () => {
    const onChange = vi.fn();
    render(<Pagination page={2} totalPages={5} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /předchozí/i }));
    expect(onChange).toHaveBeenCalledWith(1);
  });
});
