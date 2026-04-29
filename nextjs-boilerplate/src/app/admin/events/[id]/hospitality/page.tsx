'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin/PageHeader';
import { formatMoney, isCurrency } from '@/lib/format';

interface Package {
  id: string;
  name: string;
  description: string | null;
  capacity: number;
  remaining_qty: number;
  price_minor: number;
  currency: string;
  visibility: string;
  active: boolean;
  includes: string[];
}

interface Inquiry {
  id: string;
  package_name: string;
  company_name: string;
  contact_email: string;
  quantity: number;
  status: string;
  total_amount_minor: number | null;
  currency: string;
  created_at: string;
}

const STATUS_VALUES = ['pending', 'confirmed', 'invoiced', 'paid', 'rejected', 'cancelled'] as const;

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

export default function HospitalityPage() {
  const params = useParams();
  const eventId = String(params.id);

  const [packages, setPackages] = useState<Package[]>([]);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Create form
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [capacity, setCapacity] = useState('20');
  const [priceMajor, setPriceMajor] = useState('150000');
  const [currency, setCurrency] = useState<'CZK' | 'EUR' | 'USD' | 'GBP' | 'PLN'>('CZK');
  const [includes, setIncludes] = useState('Welcome drink\nGastronomický servis\nVIP parking\nMatch program');
  const [visibility, setVisibility] = useState<'public' | 'invite_only'>('invite_only');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/hospitality`);
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const j = (await res.json()) as { packages: Package[]; inquiries: Inquiry[] };
      setPackages(j.packages.map((p) => ({ ...p, includes: (p as { includes: string[] }).includes ?? [] })));
      setInquiries(j.inquiries);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function createPackage(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/hospitality`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: description || null,
          capacity: Number(capacity),
          priceMinor: Math.round(Number(priceMajor) * 100),
          currency,
          includes: includes.split('\n').map((l) => l.trim()).filter(Boolean),
          visibility,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setFeedback('Package vytvořený.');
      setName('');
      setDescription('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function updateInquiry(id: string, status: string) {
    let invoiceRef: string | undefined;
    if (status === 'invoiced') {
      const ref = prompt('Číslo faktury (volitelné):');
      if (ref) invoiceRef = ref;
    }
    const res = await authFetch(`/api/admin/hospitality-inquiries/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, ...(invoiceRef ? { invoiceRef } : {}) }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? `HTTP ${res.status}`);
      return;
    }
    setFeedback(`Inquiry → ${status}`);
    await load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hospitality / corporate packages"
        description="Pro UEFA hospitality, sport boxes, VIP suites. Inquiry-based flow s offline invoicingem (žádná online platba — kontrakt + faktura)."
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {feedback ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {feedback}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Nový hospitality package</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={createPackage} className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Název</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="VIP Box (10 osob) — Lateral Premium"
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Popis</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Kapacita (osob)</label>
              <Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Cena (CZK)</label>
              <Input type="number" min={0} step={0.01} value={priceMajor} onChange={(e) => setPriceMajor(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Měna</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as typeof currency)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {(['CZK', 'EUR', 'USD', 'GBP', 'PLN'] as const).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Visibility</label>
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as 'public' | 'invite_only')}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="invite_only">Invite-only (jen kdo má direct link)</option>
                <option value="public">Public (zobrazí se na event detail)</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs uppercase text-muted-foreground">
                Co je v package (jeden řádek = jeden bullet)
              </label>
              <textarea
                value={includes}
                onChange={(e) => setIncludes(e.target.value)}
                rows={4}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={busy || !name}>
                {busy ? 'Vytvářím…' : 'Vytvořit package'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Packages ({packages.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {packages.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádný package.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Name</th>
                  <th>Kapacita</th>
                  <th>Zbývá</th>
                  <th className="text-right">Cena</th>
                  <th>Visibility</th>
                </tr>
              </thead>
              <tbody>
                {packages.map((p) => (
                  <tr key={p.id} className="border-b">
                    <td className="py-2 font-medium">{p.name}</td>
                    <td>{p.capacity}×</td>
                    <td>{p.remaining_qty}×</td>
                    <td className="text-right tabular-nums">
                      {formatMoney(p.price_minor, isCurrency(p.currency) ? p.currency : 'CZK')}
                    </td>
                    <td className="text-xs">{p.visibility}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Inquiries ({inquiries.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {inquiries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádné inquiries.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Firma</th>
                  <th>Package</th>
                  <th>Qty</th>
                  <th className="text-right">Total</th>
                  <th>Status</th>
                  <th>Vytvořeno</th>
                  <th className="text-right">Akce</th>
                </tr>
              </thead>
              <tbody>
                {inquiries.map((i) => (
                  <tr key={i.id} className="border-b">
                    <td className="py-2">
                      <div className="font-medium">{i.company_name}</div>
                      <div className="text-xs text-muted-foreground">{i.contact_email}</div>
                    </td>
                    <td>{i.package_name}</td>
                    <td>{i.quantity}×</td>
                    <td className="text-right tabular-nums">
                      {i.total_amount_minor !== null
                        ? formatMoney(i.total_amount_minor, isCurrency(i.currency) ? i.currency : 'CZK')
                        : '—'}
                    </td>
                    <td>
                      <select
                        value={i.status}
                        onChange={(e) => updateInquiry(i.id, e.target.value)}
                        className="rounded border bg-background px-2 py-1 text-xs"
                      >
                        {STATUS_VALUES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {new Date(i.created_at).toLocaleDateString('cs-CZ')}
                    </td>
                    <td className="text-right">
                      <a
                        href={`mailto:${i.contact_email}`}
                        className="text-xs text-primary hover:underline"
                      >
                        E-mail
                      </a>
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
