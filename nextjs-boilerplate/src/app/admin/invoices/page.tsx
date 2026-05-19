'use client';

import { useEffect, useState } from 'react';
import { Download, Receipt } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Invoice {
  id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  subtotal_minor: number;
  vat_amount_minor: number;
  total_minor: number;
  currency: string;
  customer_name: string;
  paid_at: string | null;
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

function formatCzk(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kč`;
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch('/api/admin/invoices');
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { invoices: Invoice[] };
      setInvoices(data.invoices ?? []);
    } finally {
      setBusy(false);
    }
  }

  async function downloadIsdoc(invoiceId: string, invoiceNumber: string) {
    try {
      const res = await authFetch(`/api/admin/invoices/${invoiceId}/isdoc`);
      if (!res.ok) {
        setError(`ISDOC HTTP ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${invoiceNumber}.isdoc`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Síťová chyba');
    }
  }

  async function exportCsv() {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await authFetch(`/api/admin/invoices/export?${params.toString()}`);
      if (!res.ok) {
        setError(`Export HTTP ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tixly-invoices-${from || 'all'}-${to || 'now'}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  const filtered = invoices.filter((i) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      i.invoice_number.toLowerCase().includes(q) ||
      i.customer_name.toLowerCase().includes(q)
    );
  });

  const totalNet = filtered.reduce((s, i) => s + i.subtotal_minor, 0);
  const totalVat = filtered.reduce((s, i) => s + i.vat_amount_minor, 0);
  const totalGross = filtered.reduce((s, i) => s + i.total_minor, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Faktury"
        description="Faktury vydané kupcům (B2B). Pro daňový rozpis tržeb (B2C) použij Pokladnu → Export CSV."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">Počet faktur</p>
            <p className="mt-1 text-2xl font-bold">{filtered.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">Základ daně</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{formatCzk(totalNet)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">DPH</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{formatCzk(totalVat)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">Celkem s DPH</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{formatCzk(totalGross)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtry + export pro účetní</CardTitle>
          <CardDescription>CSV podle období (default = vše).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <label className="mb-1 block text-xs font-medium">Hledat</label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Číslo faktury nebo jméno kupce"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Od</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Do</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <Button onClick={exportCsv} disabled={busy} className="mt-3">
            <Download className="mr-2 h-4 w-4" aria-hidden />
            Stáhnout CSV
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Seznam faktur ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
              {error}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <Receipt className="mb-2 h-10 w-10 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">
                {busy ? 'Načítám…' : 'Žádné faktury pro vybrané filtry.'}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Faktura se vystaví manuálně z order detailu (Customer support →
                Vystavit fakturu) nebo automaticky pro hospitality inquiries.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Číslo</th>
                  <th>Datum</th>
                  <th>Kupec</th>
                  <th className="text-right">Základ</th>
                  <th className="text-right">DPH</th>
                  <th className="text-right">Celkem</th>
                  <th>Stav</th>
                  <th className="text-right">ISDOC</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr key={i.id} className="border-b hover:bg-muted/30">
                    <td className="py-2 font-mono text-xs">{i.invoice_number}</td>
                    <td className="text-xs">
                      {new Date(i.issue_date).toLocaleDateString('cs-CZ')}
                    </td>
                    <td>{i.customer_name}</td>
                    <td className="text-right tabular-nums">{formatCzk(i.subtotal_minor)}</td>
                    <td className="text-right tabular-nums">{formatCzk(i.vat_amount_minor)}</td>
                    <td className="text-right font-medium tabular-nums">
                      {formatCzk(i.total_minor)}
                    </td>
                    <td>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          i.paid_at
                            ? 'bg-emerald-100 text-emerald-900'
                            : new Date(i.due_date) < new Date()
                              ? 'bg-rose-100 text-rose-900'
                              : 'bg-amber-100 text-amber-900'
                        }`}
                      >
                        {i.paid_at
                          ? 'zaplacena'
                          : new Date(i.due_date) < new Date()
                            ? 'po splatnosti'
                            : 'nevyrovnaná'}
                      </span>
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => void downloadIsdoc(i.id, i.invoice_number)}
                        className="text-xs text-primary hover:underline"
                        title="Stáhnout ISDOC XML pro Pohoda/Money S3/Helios"
                      >
                        .isdoc
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
