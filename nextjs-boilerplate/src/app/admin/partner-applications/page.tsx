'use client';

import { useEffect, useState } from 'react';
import { Check, X, Globe, Mail, Phone, Clock, Copy } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { typedGet } from '@/lib/typed-fetch';

interface Application {
  id: string;
  name: string;
  contact_email: string;
  contact_phone: string | null;
  website_url: string | null;
  partner_type: string | null;
  apply_note: string | null;
  status: string;
  commission_pct: string;
  applied_at: string | null;
  created_at: string;
}

const TYPE_LABEL: Record<string, string> = {
  media: 'Média', travel: 'Cestovní', ticketshop: 'Pokladna', agency: 'Agentura', other: 'Jiné',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  active: 'bg-emerald-100 text-emerald-800',
  terminated: 'bg-rose-100 text-rose-700',
  suspended: 'bg-slate-100 text-slate-600',
};

export default function PartnerApplicationsPage(): JSX.Element {
  const [apps, setApps]           = useState<Application[]>([]);
  const [filter, setFilter]       = useState<'pending' | 'active' | 'all'>('pending');
  const [busy, setBusy]           = useState<string | null>(null);
  const [token, setToken]         = useState<{ id: string; value: string } | null>(null);
  const [commission, setCommission] = useState<Record<string, string>>({});
  const [error, setError]         = useState<string | null>(null);

  async function load() {
    try {
      const r = await typedGet<{ applications: Application[] }>(`/api/admin/partner-applications?status=${filter}`);
      setApps(r.applications);
    } catch {
      setError('Nepodařilo se načíst žádosti');
    }
  }

  useEffect(() => { void load(); }, [filter]);

  async function act(id: string, action: 'approve' | 'reject') {
    setBusy(id); setError(null);
    try {
      const body: Record<string, unknown> = { action };
      if (action === 'approve') body.commissionPct = Number(commission[id] ?? 5);
      const res = await fetch(`/api/admin/partner-applications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json() as { ok?: boolean; partnerToken?: string };
      if (d.partnerToken) setToken({ id, value: d.partnerToken });
      await load();
    } catch {
      setError('Chyba při zpracování žádosti');
    } finally { setBusy(null); }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Partner žádosti"
        description="Správa affiliates a reseller partnerů"
      />

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(['pending', 'active', 'all'] as const).map((s) => (
          <Button key={s} variant={filter === s ? 'default' : 'outline'} size="sm" onClick={() => setFilter(s)}>
            {s === 'pending' ? 'Čekající' : s === 'active' ? 'Aktivní' : 'Vše'}
          </Button>
        ))}
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      {/* Token reveal */}
      {token && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="mb-2 text-sm font-semibold text-emerald-800">Partner token vygenerován — uložte si ho, nebude znovu zobrazen:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-white px-3 py-2 text-xs text-emerald-900 break-all">{token.value}</code>
            <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(token.value); }}>
              <Copy className="h-3 w-3" />
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="mt-2 text-xs" onClick={() => setToken(null)}>Zavřít</Button>
        </div>
      )}

      {/* Applications list */}
      <div className="space-y-3">
        {apps.length === 0 && (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            Žádné žádosti v tomto filtru.
          </div>
        )}

        {apps.map((app) => (
          <div key={app.id} className="rounded-xl border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold">{app.name}</h3>
                  {app.partner_type && (
                    <Badge variant="outline" className="text-xs">{TYPE_LABEL[app.partner_type] ?? app.partner_type}</Badge>
                  )}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[app.status] ?? ''}`}>
                    {app.status}
                  </span>
                </div>
                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{app.contact_email}</span>
                  {app.contact_phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{app.contact_phone}</span>}
                  {app.website_url && (
                    <a href={app.website_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground">
                      <Globe className="h-3 w-3" />{app.website_url.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(app.applied_at ?? app.created_at).toLocaleDateString('cs-CZ')}
                  </span>
                </div>
                {app.apply_note && (
                  <p className="mt-2 text-sm text-muted-foreground italic">{app.apply_note}</p>
                )}
              </div>

              {app.status === 'pending' && (
                <div className="flex shrink-0 items-center gap-2">
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">Provize %</span>
                    <input
                      type="number" min={0} max={50} defaultValue={5}
                      onChange={(e) => setCommission((c) => ({ ...c, [app.id]: e.target.value }))}
                      className="w-14 rounded border px-2 py-1 text-xs"
                    />
                  </div>
                  <Button size="sm" onClick={() => void act(app.id, 'approve')} disabled={busy === app.id}>
                    <Check className="mr-1 h-3 w-3" /> Schválit
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => void act(app.id, 'reject')} disabled={busy === app.id}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}

              {app.status === 'active' && (
                <div className="text-sm text-muted-foreground">
                  Provize: <strong>{app.commission_pct} %</strong>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
