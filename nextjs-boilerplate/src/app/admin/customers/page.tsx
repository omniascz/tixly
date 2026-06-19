'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Mail, Search, Upload, Users, X } from 'lucide-react';
import { DataTable, Column } from '@/components/admin/DataTable';
import { PageHeader } from '@/components/admin/PageHeader';
import { StatCard } from '@/components/admin/StatCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCzk, formatCzechDateShort } from '@/lib/format';

interface Customer {
  email: string;
  name: string | null;
  phone: string | null;
  historicalPurchases: number;
  historicalSpendHalire: number;
  importSource: string | null;
  optedOut: boolean;
  userId: string | null;
  livePurchases: number;
  liveSpendHalire: number;
  totalVisits: number;
  totalLtvHalire: number;
  lastSeenAt: string | null;
}

interface Stats {
  totalContacts: number;
  totalFromImport: number;
  totalLiveBuyers: number;
  avgLtv: number;
}

interface DetailContact {
  email: string;
  name: string | null;
  phone: string | null;
  historicalPurchases: number;
  historicalSpendHalire: number;
  importSource: string | null;
  optedOut: boolean;
  optedOutAt: string | null;
  notes: string | null;
  firstPurchaseAt: string | null;
  lastPurchaseAt: string | null;
  createdAt: string;
}

interface DetailOrder {
  id: string;
  createdAt: string;
  totalAmount: number;
  status: string;
  eventTitle: string;
}

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

function SourceBadge({ source }: { source: string | null }) {
  if (!source) {
    return (
      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
        Tixly
      </span>
    );
  }
  return (
    <span
      className="inline-flex max-w-[120px] truncate rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800"
      title={source}
    >
      {source}
    </span>
  );
}

export default function AdminCustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'ltv' | 'visits' | 'last_purchase'>('ltv');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [detailEmail, setDetailEmail] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ contact: DetailContact; orders: DetailOrder[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  const load = useCallback(async (q: string, s: string, p: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ sort: s, page: String(p) });
      if (q) params.set('q', q);
      const res = await authFetch(`/api/admin/customers?${params}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        customers: Customer[];
        stats: Stats;
        page: number;
        limit: number;
      };
      if (p === 1) {
        setCustomers(data.customers);
        setStats(data.stats);
      } else {
        setCustomers((prev) => [...prev, ...data.customers]);
      }
      setHasMore(data.customers.length === data.limit);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      void load(search, sort, 1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, sort, load]);

  async function openDetail(email: string) {
    setDetailEmail(email);
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await authFetch(`/api/admin/customers/${encodeURIComponent(email)}`);
      if (res.ok) {
        const data = (await res.json()) as { contact: DetailContact; orders: DetailOrder[] };
        setDetail(data);
        setNotes(data.contact.notes ?? '');
      }
    } finally {
      setDetailLoading(false);
    }
  }

  async function saveNotes() {
    if (!detailEmail) return;
    setSavingNotes(true);
    try {
      await authFetch(`/api/admin/customers/${encodeURIComponent(detailEmail)}`, {
        method: 'PATCH',
        body: JSON.stringify({ notes }),
      });
      if (detail) {
        setDetail({ ...detail, contact: { ...detail.contact, notes } });
      }
    } finally {
      setSavingNotes(false);
    }
  }

  async function toggleOptOut() {
    if (!detailEmail || !detail) return;
    const newVal = !detail.contact.optedOut;
    await authFetch(`/api/admin/customers/${encodeURIComponent(detailEmail)}`, {
      method: 'PATCH',
      body: JSON.stringify({ optedOut: newVal }),
    });
    setDetail({ ...detail, contact: { ...detail.contact, optedOut: newVal } });
  }

  function exportCsv() {
    const a = document.createElement('a');
    a.href = `/api/admin/customers/export`;
    a.click();
  }

  const columns: Column<Customer>[] = [
    {
      key: 'name',
      header: 'Jméno',
      render: (c) => (
        <div>
          <div className="font-medium">{c.name ?? '—'}</div>
          <div className="text-xs text-muted-foreground">{c.email}</div>
          {c.optedOut && <div className="text-xs text-rose-600">odhlášen</div>}
        </div>
      ),
    },
    {
      key: 'phone',
      header: 'Telefon',
      render: (c) => <span className="text-muted-foreground">{c.phone ?? '—'}</span>,
    },
    {
      key: 'visits',
      header: 'Návštěvy',
      className: 'text-right',
      render: (c) => <div className="text-right font-medium">{c.totalVisits}</div>,
    },
    {
      key: 'ltv',
      header: 'LTV celkem',
      className: 'text-right',
      render: (c) => <div className="text-right font-semibold">{formatCzk(c.totalLtvHalire)}</div>,
    },
    {
      key: 'last',
      header: 'Poslední nákup',
      render: (c) => (
        <span className="text-muted-foreground">
          {c.lastSeenAt ? formatCzechDateShort(c.lastSeenAt) : '—'}
        </span>
      ),
    },
    {
      key: 'source',
      header: 'Zdroj',
      render: (c) => <SourceBadge source={c.importSource} />,
    },
    {
      key: 'action',
      header: 'Akce',
      render: (c) => (
        <Button variant="outline" size="sm" onClick={() => void openDetail(c.email)}>
          Detail
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Zákazníci"
        description="Vaše zákaznická databáze — importovaní i aktivní kupující."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push('/admin/import')}>
              <Upload className="mr-1.5 h-4 w-4" aria-hidden />
              Importovat zákazníky
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="mr-1.5 h-4 w-4" aria-hidden />
              Export CSV
            </Button>
            <Button size="sm" onClick={() => router.push('/admin/broadcasts/new')}>
              <Mail className="mr-1.5 h-4 w-4" aria-hidden />
              Hromadný email
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          title="Celkem zákazníků"
          value={String(stats?.totalContacts ?? '—')}
          icon={<Users className="h-4 w-4" aria-hidden />}
        />
        <StatCard
          title="Aktivní kupující"
          value={String(stats?.totalLiveBuyers ?? '—')}
          hint="Přes Tixly"
        />
        <StatCard
          title="Importovaní"
          value={String(stats?.totalFromImport ?? '—')}
          hint="CSV / jiný systém"
        />
        <StatCard
          title="Průměrné LTV"
          value={stats ? formatCzk(Math.round(stats.avgLtv)) : '—'}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Hledat jméno nebo e-mail…"
            className="pl-9"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="ltv">LTV (nejvyšší)</option>
          <option value="visits">Počet návštěv</option>
          <option value="last_purchase">Poslední nákup</option>
        </select>
      </div>

      <DataTable
        columns={columns}
        rows={customers}
        rowKey={(c) => c.email}
        loading={loading && customers.length === 0}
        emptyMessage="Žádní zákazníci"
      />

      {hasMore && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => {
              const next = page + 1;
              setPage(next);
              void load(search, sort, next);
            }}
            disabled={loading}
          >
            Načíst další
          </Button>
        </div>
      )}

      {detailEmail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetailEmail(null);
          }}
        >
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Detail zákazníka</CardTitle>
                <button
                  onClick={() => setDetailEmail(null)}
                  className="rounded-md p-1 hover:bg-muted"
                  aria-label="Zavřít"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              {detailLoading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Načítám…</p>
              ) : detail ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Jméno</p>
                      <p className="font-medium">{detail.contact.name ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">E-mail</p>
                      <p className="font-medium">{detail.contact.email}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Telefon</p>
                      <p>{detail.contact.phone ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Zdroj</p>
                      <SourceBadge source={detail.contact.importSource} />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Objednávky (import)</p>
                      <p>{detail.contact.historicalPurchases}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Útrata (import)</p>
                      <p>{formatCzk(detail.contact.historicalSpendHalire)}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-sm">Marketingové e-maily:</span>
                    {detail.contact.optedOut ? (
                      <Badge variant="destructive">Odhlášen</Badge>
                    ) : (
                      <Badge variant="secondary">Přihlášen</Badge>
                    )}
                    <Button variant="outline" size="sm" onClick={() => void toggleOptOut()}>
                      {detail.contact.optedOut ? 'Znovu přihlásit' : 'Odhlásit'}
                    </Button>
                  </div>

                  {detail.orders.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Objednávky ({detail.orders.length})
                      </p>
                      <div className="max-h-48 space-y-1.5 overflow-y-auto">
                        {detail.orders.map((o) => (
                          <div
                            key={o.id}
                            className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                          >
                            <div>
                              <p className="font-medium">{o.eventTitle}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatCzechDateShort(o.createdAt)}
                              </p>
                            </div>
                            <span className="font-semibold">{formatCzk(o.totalAmount)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="mb-1.5 block text-xs font-medium">Interní poznámky</label>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                      placeholder="Poznámky viditelné pouze vám…"
                    />
                    <Button
                      size="sm"
                      className="mt-2"
                      onClick={() => void saveNotes()}
                      disabled={savingNotes}
                    >
                      {savingNotes ? 'Ukládám…' : 'Uložit poznámky'}
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
