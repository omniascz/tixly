'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin/PageHeader';

interface KycData {
  promoter: {
    id: string;
    name: string;
    kyc_status: string;
    kyc_submitted_at: string | null;
    kyc_rejection_reason: string | null;
    company_ico: string | null;
    company_dic: string | null;
    company_address: string | null;
    bank_account: string | null;
    vat_rate_pct: number;
    vat_payer: boolean;
    ares_data: { companyName?: string; address?: string; dic?: string; active?: boolean } | null;
  };
  documents: {
    id: string;
    type: string;
    file_url: string;
    file_name: string | null;
    created_at: string;
  }[];
}

const DOC_TYPES = ['contract', 'bank_statement', 'id_proof', 'business_license', 'other'] as const;

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

export default function KycSettingsPage() {
  const [data, setData] = useState<KycData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Form
  const [ico, setIco] = useState('');
  const [dic, setDic] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [vatRatePct, setVatRatePct] = useState('21');
  const [vatPayer, setVatPayer] = useState(true);
  const [busy, setBusy] = useState(false);

  // Document upload
  const [docType, setDocType] = useState<string>('contract');
  const [docUrl, setDocUrl] = useState('');
  const [docName, setDocName] = useState('');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const res = await authFetch('/api/admin/kyc');
    if (!res.ok) {
      setError(`HTTP ${res.status}`);
      return;
    }
    const j = (await res.json()) as KycData;
    setData(j);
    setIco(j.promoter.company_ico ?? '');
    setDic(j.promoter.company_dic ?? '');
    setCompanyName(j.promoter.ares_data?.companyName ?? j.promoter.name ?? '');
    setCompanyAddress(j.promoter.company_address ?? '');
    setBankAccount(j.promoter.bank_account ?? '');
    setVatRatePct(String(j.promoter.vat_rate_pct ?? 21));
    setVatPayer(j.promoter.vat_payer ?? true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch('/api/admin/kyc', {
        method: 'POST',
        body: JSON.stringify({
          ico,
          dic: dic || undefined,
          companyName,
          companyAddress,
          bankAccount,
          vatRatePct: Number(vatRatePct),
          vatPayer,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        aresData?: { companyName?: string; address?: string };
        error?: string;
        details?: string;
      };
      if (!res.ok) {
        setError(j.details ? `${j.error}: ${j.details}` : j.error ?? `HTTP ${res.status}`);
        return;
      }
      setFeedback(
        `KYC odesláno. ARES: ${j.aresData?.companyName ?? ''} (${j.aresData?.address ?? ''}). Čeká schválení.`,
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function uploadDocument(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await authFetch('/api/admin/kyc/documents', {
      method: 'POST',
      body: JSON.stringify({
        type: docType,
        fileUrl: docUrl,
        fileName: docName || undefined,
      }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? `HTTP ${res.status}`);
      return;
    }
    setDocUrl('');
    setDocName('');
    setFeedback('Dokument přidán.');
    await load();
  }

  async function deleteDoc(id: string) {
    if (!confirm('Opravdu smazat dokument?')) return;
    await authFetch(`/api/admin/kyc/documents?id=${id}`, { method: 'DELETE' });
    await load();
  }

  if (!data) return <p className="text-sm text-muted-foreground">Načítání…</p>;

  const status = data.promoter.kyc_status;
  const isSubmitted = status === 'submitted' || status === 'approved';

  return (
    <div className="space-y-6">
      <PageHeader
        title="KYC — Ověření účtu"
        description="Vyplň firemní údaje. IČO ověřujeme přes ARES, master admin schválí do 24 hodin."
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
          <CardTitle className="flex items-center justify-between">
            <span>Status</span>
            <StatusBadge status={status} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {status === 'rejected' && data.promoter.kyc_rejection_reason ? (
            <p className="text-sm text-rose-900">
              <strong>Zamítnuto:</strong> {data.promoter.kyc_rejection_reason}
            </p>
          ) : null}
          {status === 'submitted' ? (
            <p className="text-sm text-amber-900">
              KYC odesláno {data.promoter.kyc_submitted_at ? new Date(data.promoter.kyc_submitted_at).toLocaleString('cs-CZ') : ''}, čeká na master admina.
            </p>
          ) : null}
          {data.promoter.ares_data?.companyName ? (
            <div className="mt-2 rounded-md border bg-emerald-50 p-3 text-xs text-emerald-900">
              <strong>ARES verified:</strong> {data.promoter.ares_data.companyName}
              {data.promoter.ares_data.address ? ` · ${data.promoter.ares_data.address}` : ''}
              {data.promoter.ares_data.active === false ? ' · ⚠ subjekt zaniklý' : ''}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Firemní údaje</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">IČO</label>
              <Input
                value={ico}
                onChange={(e) => setIco(e.target.value.replace(/\D/g, '').slice(0, 8))}
                pattern="\d{8}"
                required
                placeholder="12345678"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">DIČ (volitelné)</label>
              <Input value={dic} onChange={(e) => setDic(e.target.value)} placeholder="CZ12345678" />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs uppercase text-muted-foreground">
                Název firmy
              </label>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Adresa</label>
              <Input
                value={companyAddress}
                onChange={(e) => setCompanyAddress(e.target.value)}
                required
                placeholder="Václavské nám. 1, 110 00 Praha 1"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">
                Bankovní účet
              </label>
              <Input
                value={bankAccount}
                onChange={(e) => setBankAccount(e.target.value)}
                required
                placeholder="123456789/0100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">
                DPH sazba %
              </label>
              <Input
                type="number"
                min={0}
                max={50}
                value={vatRatePct}
                onChange={(e) => setVatRatePct(e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={vatPayer}
                  onChange={(e) => setVatPayer(e.target.checked)}
                />
                Plátce DPH
              </label>
            </div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? 'Odesílám…' : isSubmitted ? 'Aktualizovat údaje' : 'Odeslat ke schválení'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dokumenty ({data.documents.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={uploadDocument} className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            >
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <Input
              type="url"
              value={docUrl}
              onChange={(e) => setDocUrl(e.target.value)}
              placeholder="https://... (S3, Drive, imgur)"
              required
            />
            <div className="flex gap-2">
              <Input
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                placeholder="Název (volit.)"
              />
              <Button type="submit" disabled={!docUrl}>
                Přidat
              </Button>
            </div>
          </form>
          {data.documents.length > 0 ? (
            <ul className="mt-4 divide-y">
              {data.documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{d.type}</span>{' '}
                    <a
                      href={d.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {d.file_name ?? d.file_url}
                    </a>
                  </span>
                  <button
                    type="button"
                    onClick={() => deleteDoc(d.id)}
                    className="text-xs text-rose-700 hover:underline"
                  >
                    Smazat
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-700',
    submitted: 'bg-amber-100 text-amber-800',
    approved: 'bg-emerald-100 text-emerald-800',
    rejected: 'bg-rose-100 text-rose-800',
  };
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${map[status] ?? 'bg-muted'}`}>
      {status}
    </span>
  );
}
