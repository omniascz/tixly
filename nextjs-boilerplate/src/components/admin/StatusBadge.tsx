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

/**
 * Stav konkrétní vstupenky.
 *
 * Dřív se sem posílaly stavy vstupenek do StatusBadge, který zná jen stavy
 * objednávky — českému uživateli se pak zobrazil syrový anglický řetězec
 * („valid", „used") v šedém štítku.
 */
export type TicketStatus = 'valid' | 'used' | 'revoked' | 'expired' | 'transferred' | 'resale_listed';

const ticketLabels: Record<TicketStatus, string> = {
  valid: 'Platná',
  used: 'Použitá',
  revoked: 'Zneplatněná',
  expired: 'Propadlá',
  transferred: 'Převedená',
  resale_listed: 'V přeprodeji',
};

const ticketTones: Record<TicketStatus, string> = {
  valid: 'bg-emerald-100 text-emerald-800',
  used: 'bg-slate-200 text-slate-800',
  revoked: 'bg-rose-100 text-rose-800',
  expired: 'bg-slate-100 text-slate-600',
  transferred: 'bg-sky-100 text-sky-800',
  resale_listed: 'bg-amber-100 text-amber-800',
};

export function TicketStatusBadge({ status }: { status: string }) {
  const known = status in ticketLabels ? (status as TicketStatus) : null;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        known ? ticketTones[known] : 'bg-slate-100 text-slate-700',
      )}
    >
      {known ? ticketLabels[known] : status}
    </span>
  );
}
