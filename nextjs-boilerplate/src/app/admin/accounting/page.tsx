'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function authFetch(url: string): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

type Format = 'pohoda' | 'money_s3' | 'csv';

export default function AccountingPage() {
  const now = new Date();
  const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const defaultTo = now.toISOString().slice(0, 10);

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(format: Format) {
    setBusy(format);
    setError(null);
    try {
      const params = new URLSearchParams({ format, from, to });
      const res = await authFetch(`/api/admin/accounting/export?${params.toString()}`);
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cd = res.headers.get('Content-Disposition') ?? '';
      const match = cd.match(/filename="([^"]+)"/);
      a.download = match?.[1] ?? `export.${format === 'pohoda' ? 'xml' : 'csv'}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="ERP Export / Účetnictví"
        description="Export faktur pro účetní systémy POHODA, Money S3 a CSV."
      />

      <Card>
        <CardHeader>
          <CardTitle>Rozsah exportu</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Od</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Do</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {error ? (
            <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
              {error}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button onClick={() => void download('pohoda')} disabled={busy !== null}>
              <Download className="mr-2 h-4 w-4" aria-hidden />
              {busy === 'pohoda' ? 'Generuji…' : 'POHODA XML'}
            </Button>
            <Button
              variant="outline"
              onClick={() => void download('money_s3')}
              disabled={busy !== null}
            >
              <Download className="mr-2 h-4 w-4" aria-hidden />
              {busy === 'money_s3' ? 'Generuji…' : 'Money S3 CSV'}
            </Button>
            <Button
              variant="outline"
              onClick={() => void download('csv')}
              disabled={busy !== null}
            >
              <Download className="mr-2 h-4 w-4" aria-hidden />
              {busy === 'csv' ? 'Generuji…' : 'CSV'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Jak importovat</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">POHODA:</span>{' '}
            import přes Soubor → Datová komunikace → Příjem dat XML
          </p>
          <p>
            <span className="font-medium text-foreground">Money S3:</span>{' '}
            import přes Účetnictví → Faktury vydané → Import
          </p>
          <p>
            <span className="font-medium text-foreground">CSV:</span>{' '}
            obecný formát (Excel, Google Sheets) — kódování UTF-8 BOM, oddělovač čárka
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
