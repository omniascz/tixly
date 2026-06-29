'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

interface Verification {
  id: string;
  user_id: string;
  legal_name: string;
  document_type: string;
  status: string;
  submitted_at: string;
  reviewed_at: string | null;
  reviewer_notes: string | null;
  email: string;
  user_name: string | null;
  fan_id_verified: boolean;
}

const DOC_LABEL: Record<string, string> = {
  id_card: 'OP',
  passport: 'Pas',
  driving_licence: 'ŘP',
};

export default function FanIdAdminPage() {
  const [items, setItems] = useState<Verification[]>([]);
  const [status, setStatus] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  function load(s: string) {
    setLoading(true);
    fetch(`/api/platform/identity-verifications?status=${s}`)
      .then((r) => r.json())
      .then((d: { verifications: Verification[] }) => setItems(d.verifications ?? []))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(status); }, [status]);

  async function act(id: string, action: 'approve' | 'reject') {
    setActing(id);
    try {
      const r = await fetch(`/api/platform/identity-verifications?id=${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, notes: notes[id] ?? undefined }),
      });
      if (r.ok) {
        setItems((prev) => prev.filter((v) => v.id !== id));
      }
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold">Fan ID — Identity Verifications</h1>

      <div className="mb-6 flex gap-2">
        {['pending', 'approved', 'rejected', 'all'].map((s) => (
          <Button
            key={s}
            variant={status === s ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setStatus(s); load(s); }}
          >
            {s}
          </Button>
        ))}
      </div>

      {loading ? (
        <p className="text-muted-foreground">Načítám…</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">Žádné žádosti se statusem „{status}".</p>
      ) : (
        <div className="space-y-4">
          {items.map((v) => (
            <div key={v.id} className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-bold text-lg">{v.legal_name}</p>
                  <p className="text-sm text-muted-foreground">{v.email} · {v.user_name ?? '—'}</p>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                    <span className="rounded bg-muted px-2 py-0.5">{DOC_LABEL[v.document_type] ?? v.document_type}</span>
                    <span className="rounded bg-muted px-2 py-0.5">Podáno {new Date(v.submitted_at).toLocaleDateString('cs-CZ')}</span>
                    {v.reviewed_at ? (
                      <span className="rounded bg-muted px-2 py-0.5">Rozhodnuto {new Date(v.reviewed_at).toLocaleDateString('cs-CZ')}</span>
                    ) : null}
                    <span className={`rounded px-2 py-0.5 font-semibold ${
                      v.status === 'approved' ? 'bg-green-100 text-green-700' :
                      v.status === 'rejected' ? 'bg-red-100 text-red-700' :
                      'bg-amber-100 text-amber-700'
                    }`}>{v.status}</span>
                  </div>
                  {v.reviewer_notes ? (
                    <p className="mt-2 text-sm text-muted-foreground">Poznámka: {v.reviewer_notes}</p>
                  ) : null}
                </div>

                {v.status === 'pending' ? (
                  <div className="flex flex-col gap-2">
                    <input
                      placeholder="Poznámka (volitelné)"
                      value={notes[v.id] ?? ''}
                      onChange={(e) => setNotes((n) => ({ ...n, [v.id]: e.target.value }))}
                      className="rounded border px-2 py-1 text-sm w-52"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700"
                        disabled={acting === v.id}
                        onClick={() => void act(v.id, 'approve')}
                      >
                        Schválit
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={acting === v.id}
                        onClick={() => void act(v.id, 'reject')}
                      >
                        Zamítnout
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
