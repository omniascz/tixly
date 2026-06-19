'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { DataTable, Column } from '@/components/admin/DataTable';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';

interface Broadcast {
  id: string;
  subject: string;
  target: string;
  eventId: string | null;
  eventTitle: string | null;
  status: 'draft' | 'sending' | 'sent' | 'failed';
  recipientCount: number;
  sentAt: string | null;
  createdAt: string;
}

const TARGET_LABELS: Record<string, string> = {
  all: 'Všichni zákazníci',
  buyers_only: 'Pouze kupující',
  contacts_only: 'Pouze importovaná DB',
  subscribers: 'Předplatitelé',
  event: 'Konkrétní akce',
};

const STATUS_INFO: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Rozepsaný', cls: 'bg-slate-100 text-slate-700' },
  sending: { label: 'Odesílá se', cls: 'bg-amber-100 text-amber-800' },
  sent: { label: 'Odesláno', cls: 'bg-emerald-100 text-emerald-800' },
  failed: { label: 'Selhalo', cls: 'bg-rose-100 text-rose-800' },
};

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

const columns: Column<Broadcast>[] = [
  {
    key: 'subject',
    header: 'Předmět',
    render: (b) => <span className="font-medium">{b.subject}</span>,
  },
  {
    key: 'target',
    header: 'Cílová skupina',
    render: (b) => (
      <span className="text-muted-foreground">
        {b.target === 'event' && b.eventTitle
          ? b.eventTitle
          : (TARGET_LABELS[b.target] ?? b.target)}
      </span>
    ),
  },
  {
    key: 'recipients',
    header: 'Příjemci',
    className: 'text-right',
    render: (b) => (
      <span className="text-right block">{b.recipientCount > 0 ? b.recipientCount : '—'}</span>
    ),
  },
  {
    key: 'sent',
    header: 'Odesláno',
    render: (b) => (
      <span className="text-muted-foreground">
        {b.sentAt
          ? new Date(b.sentAt).toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' })
          : '—'}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (b) => {
      const info = STATUS_INFO[b.status] ?? STATUS_INFO.draft;
      return (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${info.cls}`}>
          {info.label}
        </span>
      );
    },
  },
];

export default function BroadcastsPage() {
  const router = useRouter();
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch('/api/admin/broadcasts');
        if (res.ok) {
          const data = (await res.json()) as { broadcasts: Broadcast[] };
          setBroadcasts(data.broadcasts ?? []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hromadné emaily"
        description="Napište všem zákazníkům divadla najednou."
        actions={
          <Button onClick={() => router.push('/admin/broadcasts/new')}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            Nový email
          </Button>
        }
      />

      <DataTable
        columns={columns}
        rows={broadcasts}
        rowKey={(b) => b.id}
        loading={loading}
        emptyMessage="Žádné hromadné emaily zatím"
      />
    </div>
  );
}
