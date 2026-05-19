'use client';

import { useEffect, useState } from 'react';
import { Upload, FileCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface VenueOption {
  id: string;
  name: string;
}

interface ParsedRow {
  title: string;
  dateStart: string;
  venueId: string;
  category?: string;
  ticketTypeName: string;
  ticketPriceHalire: number;
  totalQty: number;
  zone?: string;
  isSeated: boolean;
  description?: string;
}

interface RowResult {
  index: number;
  title: string;
  success: boolean;
  eventId?: string;
  error?: string;
  seatsInserted?: number;
}

interface BatchResponse {
  dryRun: boolean;
  totalRows: number;
  successCount: number;
  failureCount: number;
  results: RowResult[];
}

// Minimal CSV parser — semicolon, double-quote escape.
function parseCsv(text: string): string[][] {
  const lines: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ';') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      lines.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    lines.push(row);
  }
  return lines.filter((r) => r.some((c) => c.trim().length > 0));
}

const TEMPLATE_CSV = `title;date_start;venue_id;category;ticket_type_name;ticket_price_czk;total_qty;zone;is_seated;description
"Romeo a Julie";"2026-09-15T19:30:00+02:00";"00000000-0000-4000-a000-000000000500";theatre;"Plné vstupné";390;117;HLEDIŠTĚ;true;"Klasika v moderním pojetí"
"Tartuffe";"2026-09-22T19:30:00+02:00";"00000000-0000-4000-a000-000000000500";theatre;"Plné vstupné";390;117;HLEDIŠTĚ;true;
"Stand-up večer";"2026-10-05T20:00:00+02:00";"00000000-0000-4000-a000-000000000502";comedy;"Vstupné";290;80;;false;`;

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

function downloadTemplate() {
  const blob = new Blob(['﻿' + TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tixly-batch-import-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function BatchImportPage() {
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BatchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await authFetch('/api/admin/venues');
      if (!res.ok) return;
      const data = (await res.json()) as { venues: VenueOption[] };
      setVenues(data.venues ?? []);
    })();
  }, []);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseErrors([]);
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      // Strip BOM
      const cleaned = text.replace(/^﻿/, '');
      const parsed = parseCsv(cleaned);
      if (parsed.length < 2) {
        setParseErrors(['Soubor je prázdný nebo nemá řádky s daty.']);
        return;
      }
      const [headerRow, ...dataRows] = parsed;
      const header = headerRow.map((h) => h.trim().toLowerCase());
      const idx = (col: string) => header.indexOf(col);
      const required = [
        'title',
        'date_start',
        'venue_id',
        'ticket_type_name',
        'ticket_price_czk',
        'total_qty',
        'is_seated',
      ];
      const missing = required.filter((c) => idx(c) < 0);
      if (missing.length > 0) {
        setParseErrors([`Chybějící sloupce: ${missing.join(', ')}`]);
        return;
      }

      const errs: string[] = [];
      const out: ParsedRow[] = [];
      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const get = (col: string) => (row[idx(col)] ?? '').trim();
        try {
          const priceCzkRaw = get('ticket_price_czk').replace(',', '.');
          const totalQtyRaw = get('total_qty');
          if (!get('title')) throw new Error('chybí title');
          if (!get('date_start')) throw new Error('chybí date_start');
          if (!get('venue_id')) throw new Error('chybí venue_id');
          const priceCzk = Number(priceCzkRaw);
          if (!Number.isFinite(priceCzk) || priceCzk < 0) {
            throw new Error(`neplatná cena: ${priceCzkRaw}`);
          }
          const totalQty = Number(totalQtyRaw);
          if (!Number.isInteger(totalQty) || totalQty < 1) {
            throw new Error(`neplatný počet kusů: ${totalQtyRaw}`);
          }
          const isSeatedRaw = get('is_seated').toLowerCase();
          const isSeated = isSeatedRaw === 'true' || isSeatedRaw === '1' || isSeatedRaw === 'ano';
          out.push({
            title: get('title'),
            dateStart: new Date(get('date_start')).toISOString(),
            venueId: get('venue_id'),
            category: get('category') || undefined,
            ticketTypeName: get('ticket_type_name'),
            ticketPriceHalire: Math.round(priceCzk * 100),
            totalQty,
            zone: get('zone') || undefined,
            isSeated,
            description: get('description') || undefined,
          });
        } catch (e) {
          errs.push(
            `Řádek ${i + 2}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      setRows(out);
      setParseErrors(errs);
    };
    reader.readAsText(file, 'utf-8');
  }

  async function submit(dryRun: boolean) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await authFetch('/api/admin/events/batch-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, dryRun }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? data.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(data as BatchResponse);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hromadný import představení"
        description="Načti CSV se seznamem představení (sezónní kalendář). Server udělá dry-run validaci, pak commit. Limit 200 řádků."
      />

      <Card>
        <CardHeader>
          <CardTitle>1. Šablona CSV</CardTitle>
          <CardDescription>
            Stáhni si vzor s 3 ukázkovými řádky. Oddělovač je <code>;</code>, kódování UTF-8.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={downloadTemplate}>
            <Upload className="mr-2 h-4 w-4 rotate-180" aria-hidden />
            Stáhnout šablonu
          </Button>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div>
              <strong>title</strong> — název představení
            </div>
            <div>
              <strong>date_start</strong> — ISO datum (např. 2026-09-15T19:30:00+02:00)
            </div>
            <div>
              <strong>venue_id</strong> — UUID sálu (viz seznam dole)
            </div>
            <div>
              <strong>ticket_type_name</strong> — např. Plné vstupné
            </div>
            <div>
              <strong>ticket_price_czk</strong> — celé Kč (např. 390)
            </div>
            <div>
              <strong>total_qty</strong> — počet lístků k prodeji
            </div>
            <div>
              <strong>zone</strong> — pro seated event (např. HLEDIŠTĚ); jinak prázdné
            </div>
            <div>
              <strong>is_seated</strong> — true/false
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Nahrát soubor</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleFile}
            className="text-sm"
          />
          {fileName ? (
            <p className="text-xs text-muted-foreground">
              <FileCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden />
              {fileName} · {rows.length} validních řádků
              {parseErrors.length > 0 ? ` · ${parseErrors.length} chyb` : ''}
            </p>
          ) : null}
          {parseErrors.length > 0 ? (
            <div className="rounded-md border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900">
              <p className="mb-1 font-medium">Chyby v souboru:</p>
              <ul className="list-inside list-disc">
                {parseErrors.slice(0, 10).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
                {parseErrors.length > 10 ? (
                  <li>+ {parseErrors.length - 10} dalších</li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {rows.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>3. Náhled ({rows.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-64 overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="p-2 text-left">Titul</th>
                    <th className="p-2 text-left">Datum</th>
                    <th className="p-2 text-left">Sál</th>
                    <th className="p-2 text-right">Cena</th>
                    <th className="p-2 text-right">Ks</th>
                    <th className="p-2 text-left">Sedadla</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 50).map((r, i) => {
                    const venue = venues.find((v) => v.id === r.venueId);
                    return (
                      <tr key={i} className="border-t">
                        <td className="p-2">{r.title}</td>
                        <td className="p-2">
                          {new Date(r.dateStart).toLocaleString('cs-CZ', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </td>
                        <td className="p-2">
                          {venue?.name ?? <span className="text-rose-700">{r.venueId.slice(0, 8)}…</span>}
                        </td>
                        <td className="p-2 text-right">{(r.ticketPriceHalire / 100).toLocaleString('cs-CZ')} Kč</td>
                        <td className="p-2 text-right">{r.totalQty}</td>
                        <td className="p-2">{r.isSeated ? r.zone ?? '⚠ chybí zone' : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length > 50 ? (
                <p className="border-t p-2 text-center text-xs text-muted-foreground">
                  + {rows.length - 50} dalších řádků (commit zpracuje všechny)
                </p>
              ) : null}
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="outline" onClick={() => void submit(true)} disabled={busy}>
                Dry-run validace
              </Button>
              <Button onClick={() => void submit(false)} disabled={busy}>
                Importovat ({rows.length})
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          <AlertTriangle className="mt-0.5 h-4 w-4" aria-hidden /> {error}
        </div>
      ) : null}

      {result ? (
        <Card className={result.failureCount === 0 ? 'border-emerald-300' : 'border-amber-300'}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {result.failureCount === 0 ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden />
              )}
              {result.dryRun ? 'Dry-run výsledek' : 'Import dokončen'}
            </CardTitle>
            <CardDescription>
              Úspěch {result.successCount} / {result.totalRows}
              {result.failureCount > 0 ? ` · ${result.failureCount} selhalo` : ''}
              {result.dryRun ? ' (nic se neuložilo — klikni Importovat pro commit)' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {result.results.map((r) => (
                <li
                  key={r.index}
                  className={`flex items-start gap-2 rounded p-1 ${r.success ? 'text-emerald-900' : 'text-rose-900'}`}
                >
                  {r.success ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden />
                  )}
                  <span>
                    <strong>{r.title}</strong>
                    {r.success
                      ? ` · ${r.seatsInserted ? r.seatsInserted + ' sedadel' : 'vytvořeno'}`
                      : ` · ${r.error}`}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Sály k dispozici (ID)</CardTitle>
          <CardDescription>Zkopíruj UUID do sloupce <code>venue_id</code>.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-xs">
            {venues.map((v) => (
              <li key={v.id} className="flex justify-between gap-2 border-b py-1">
                <span>{v.name}</span>
                <code className="text-muted-foreground">{v.id}</code>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
