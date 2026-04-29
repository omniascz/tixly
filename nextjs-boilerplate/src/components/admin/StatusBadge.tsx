import { cn } from '@/lib/utils';
import type { OrderStatus } from '@/types/admin';

const labels: Record<OrderStatus, string> = {
  pending: 'Čeká na platbu',
  paid: 'Zaplaceno',
  cancelled: 'Zrušeno',
  refunded: 'Vráceno',
  expired: 'Vypršelo',
};

const tones: Record<OrderStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  paid: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-rose-100 text-rose-800',
  refunded: 'bg-slate-200 text-slate-800',
  expired: 'bg-slate-100 text-slate-600',
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tones[status] ?? 'bg-slate-100 text-slate-700',
      )}
    >
      {labels[status] ?? status}
    </span>
  );
}
