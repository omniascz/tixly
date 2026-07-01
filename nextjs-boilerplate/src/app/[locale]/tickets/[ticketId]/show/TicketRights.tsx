'use client';

import { useEffect, useState } from 'react';

/**
 * Zobrazí AKTIVNÍ programmable rights lístku (časovaný kredit / upgrade / auto-resale).
 * Read-only nad /api/buyer/tickets/[ticketId]/rights. Nezobrazí nic, když žádná práva.
 */

interface ActiveRight {
  kind: 'credit' | 'auto_resale' | 'upgrade';
  label: string;
}

const ICON: Record<ActiveRight['kind'], string> = {
  credit: '⏱️',
  upgrade: '⬆️',
  auto_resale: '🔁',
};

export function TicketRights({ ticketId }: { ticketId: string }) {
  const [rights, setRights] = useState<ActiveRight[]>([]);

  useEffect(() => {
    let alive = true;
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    fetch(`/api/buyer/tickets/${ticketId}/rights`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.json() : { rights: [] }))
      .then((j: { rights?: ActiveRight[] }) => { if (alive) setRights(j.rights ?? []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [ticketId]);

  if (rights.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
      <div className="font-semibold">🎟️ Aktivní výhody lístku</div>
      <ul className="mt-1 space-y-1">
        {rights.map((r, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span aria-hidden>{ICON[r.kind]}</span>
            <span>{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
