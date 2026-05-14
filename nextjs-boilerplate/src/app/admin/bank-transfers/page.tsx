'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin/PageHeader';

interface ParsedLine {
  amountHalire: number;
  variableSymbol?: string;
  payerName?: string;
  message?: string;
  paidAt?: string;
}

interface ReconcileResult {
  ok: boolean;
  importId?: string;
  matched: number;
  unmatched: number;
  duplicates: number;
  total: number;
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

/**
 * Parsuje CSV (semicolon nebo comma separated) výpis bankovních transakcí.
 * Heuristika column mappingu — hledá běžné CZ bank export sloupce.
 */
function parseCsv(text: string): ParsedLine[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const headerLine = lines[0]!.toLowerCase();
  const delim = headerLine.includes(';') ? ';' : ',';
  const headers = headerLine.split(delim).map((h) => h.trim().replace(/^"|"$/g, ''));

  const findIdx = (...candidates: string[]): number => {
    for (const c of candidates) {
      const idx = headers.findIndex((h) => h.includes(c));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const amountIdx = findIdx('částka', 'amount', 'castka', 'sum');
  const vsIdx = findIdx('vs', 'variabilní', 'variabilni', 'symbol');
  const payerIdx = findIdx('název', 'nazev', 'protistrana', 'partner', 'name');
  const messageIdx = findIdx('zpráva', 'zprava', 'message', 'note', 'popis');
  const dateIdx = findIdx('datum', 'date', 'kdy');

  const results: ParsedLine[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cells.length === 0) continue;
    const amountStr = amountIdx >= 0 ? cells[amountIdx] ?? '' : '';
    const amount = Number(amountStr.replace(/[\s ,]/g, '').replace(',', '.'));
    if (!isFinite(amount) || amount <= 0) continue;
    results.push({
      amountHalire: Math.round(amount * 100),
      variableSymbol: vsIdx >= 0 ? cells[vsIdx]?.trim() || undefined : undefined,
      payerName: payerIdx >= 0 ? cells[payerIdx]?.trim() || undefined : undefined,
      message: messageIdx >= 0 ? cells[messageIdx]?.trim() || undefined : undefined,
      paidAt: dateIdx >= 0 ? parseCzDate(cells[dateIdx] ?? '') : undefined,
    });
  }
  return results;
}

function parseCzDate(raw: string): string | undefined {
  // CZ format: DD.MM.YYYY nebo DD/MM/YYYY
  const m = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) {
    const [, d, mo, y] = m;
    return new Date(`${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}T12:00:00Z`).toISOString();
  }
  // ISO fallback
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return new Date(raw).toISOString();
  }
  return undefined;
}

export default function BankTransfersPage() {
  const [filename, setFilename] = useState('');
  const [csvText, setCsvText] = useState('');
  const [lines, setLines] = useState<ParsedLine[]>([]);
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setCsvText(text);
      setLines(parseCsv(text));
    };
    reader.readAsText(file, 'utf-8');
  }

  async function reconcile(): Promise<void> {
    if (lines.length === 0) {
      setError('Žádné řádky k zpracování.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await authFetch('/api/admin/bank-transfers/reconcile', {
        method: 'POST',
        body: JSON.stringify({
          source: 'manual_csv',
          filename: filename || undefined,
          lines,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as ReconcileResult & {
        error?: string;
      };
      if (!res.ok || !j.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(j);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Bankovní výpisy"
        description="Nahraj CSV výpis z banky. Systém automaticky spáruje platby s objednávkami čekajícími na bankovní převod (přes variabilní symbol a částku)."
      />

      <Card>
        <CardHeader>
          <CardTitle>1. Nahrát výpis</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              className="block text-sm"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Podporované sloupce (case-insensitive): Datum, Částka, Variabilní symbol /
              VS, Zpráva / Popis, Název / Protistrana. Delimiter ; nebo , se detekuje
              automaticky.
            </p>
          </div>
          {filename ? (
            <p className="text-sm text-muted-foreground">
              📄 {filename} · rozpoznáno {lines.length} platebních řádků
            </p>
          ) : null}
        </CardContent>
      </Card>

      {lines.length > 0 ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>2. Náhled rozpoznaných plateb</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2">Datum</th>
                      <th className="py-2">Plátce</th>
                      <th className="py-2 text-right">Částka</th>
                      <th className="py-2">VS</th>
                      <th className="py-2">Zpráva</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.slice(0, 50).map((l, i) => (
                      <tr key={i} className="border-t">
                        <td className="py-1 text-xs">
                          {l.paidAt ? new Date(l.paidAt).toLocaleDateString('cs-CZ') : '—'}
                        </td>
                        <td className="py-1 text-xs">{l.payerName ?? '—'}</td>
                        <td className="py-1 text-right tabular-nums">
                          {(l.amountHalire / 100).toLocaleString('cs-CZ')} Kč
                        </td>
                        <td className="py-1 font-mono text-xs">{l.variableSymbol ?? '—'}</td>
                        <td className="py-1 text-xs">{l.message ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {lines.length > 50 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    … a dalších {lines.length - 50} řádků (max 1000 per import).
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3. Spárovat platby</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Systém najde objednávky s odpovídajícím VS + částkou + statusem=pending
                a markne je jako zaplacené. Vstupenky a emaily se vystaví automaticky.
              </p>
              <Button onClick={reconcile} disabled={busy}>
                {busy ? 'Páruji…' : `Spárovat ${lines.length} plateb`}
              </Button>
            </CardContent>
          </Card>
        </>
      ) : null}

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>Výsledek</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Celkem řádků" value={result.total} />
              <Stat label="Spárováno" value={result.matched} color="emerald" />
              <Stat label="Duplicitní" value={result.duplicates} color="amber" />
              <Stat label="Nespárováno" value={result.unmatched} color="slate" />
            </div>
            {result.matched > 0 ? (
              <p className="mt-3 text-sm text-emerald-700">
                ✓ {result.matched} objednávek je nyní zaplaceno. Vstupenky se rozesílají
                emailem.
              </p>
            ) : null}
            {result.unmatched > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Nespárované řádky (chybný VS, nedohledaný order nebo částka neodpovídá)
                — řeš manuálně.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  const palette: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-900 border-emerald-300',
    amber: 'bg-amber-50 text-amber-900 border-amber-300',
    slate: 'bg-slate-50 text-slate-900 border-slate-300',
  };
  return (
    <div className={`rounded-md border p-3 ${color ? palette[color] : ''}`}>
      <div className="text-xs uppercase opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
