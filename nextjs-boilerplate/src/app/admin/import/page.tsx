'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, ChevronRight, AlertTriangle, CheckCircle2, Users, SkipForward, XCircle, ChevronDown, ChevronUp, FileText, Database, Ticket, Globe } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type Source = 'webticket' | 'colosseum' | 'smsticket' | 'csv';

interface PreviewResult {
  headers: string[];
  rows: string[][];
  delimiter: string;
  detectedMapping: Record<string, string>;
}

interface ColumnMapping {
  email: string;
  name: string;
  phone: string;
  purchases: string;
  spend: string;
  firstPurchase: string;
  lastPurchase: string;
}

interface ImportResult {
  jobId: string;
  importedUsers: number;
  skippedRows: number;
  errorRows: number;
  errors: Array<{ row: number; reason: string }>;
}

interface ImportJob {
  id: string;
  source: string;
  filename: string;
  status: string;
  imported_users: number;
  skipped_rows: number;
  error_rows: number;
  created_at: string;
  completed_at: string | null;
}

const SOURCE_OPTIONS: { value: Source; label: string; icon: React.ReactNode }[] = [
  { value: 'webticket', label: 'WebTicket', icon: <Ticket className="h-5 w-5" /> },
  { value: 'colosseum', label: 'Colosseum', icon: <Database className="h-5 w-5" /> },
  { value: 'smsticket', label: 'SMSticket', icon: <FileText className="h-5 w-5" /> },
  { value: 'csv', label: 'Obecný CSV', icon: <Globe className="h-5 w-5" /> },
];

const MAPPING_FIELDS: Array<{ key: keyof ColumnMapping; label: string; required: boolean }> = [
  { key: 'email', label: 'E-mail', required: true },
  { key: 'name', label: 'Jméno', required: true },
  { key: 'phone', label: 'Telefon', required: false },
  { key: 'purchases', label: 'Počet nákupů', required: false },
  { key: 'spend', label: 'Utraceno celkem', required: false },
  { key: 'firstPurchase', label: 'První nákup', required: false },
  { key: 'lastPurchase', label: 'Poslední nákup', required: false },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' });
}

function sourceLabel(s: string): string {
  return SOURCE_OPTIONS.find((o) => o.value === s)?.label ?? s;
}

export default function ImportPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [source, setSource] = useState<Source>('webticket');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({
    email: '',
    name: '',
    phone: '',
    purchases: '',
    spend: '',
    firstPurchase: '',
    lastPurchase: '',
  });
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/admin/import')
      .then((r) => r.json())
      .then((d) => setJobs(d.jobs ?? []));
  }, [result]);

  const handleFile = useCallback(
    async (f: File) => {
      setFile(f);
      const form = new FormData();
      form.append('file', f);
      const res = await fetch('/api/admin/import/preview', { method: 'POST', body: form });
      if (!res.ok) return;
      const data: PreviewResult = await res.json();
      setPreview(data);
      setMapping({
        email: data.detectedMapping.email ?? '',
        name: data.detectedMapping.name ?? '',
        phone: data.detectedMapping.phone ?? '',
        purchases: data.detectedMapping.purchases ?? '',
        spend: data.detectedMapping.spend ?? '',
        firstPurchase: '',
        lastPurchase: '',
      });
      setStep(2);
    },
    [],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile],
  );

  async function runImport() {
    if (!file || !preview) return;
    setImporting(true);
    const form = new FormData();
    form.append('file', file);
    form.append('source', source);
    form.append(
      'columnMapping',
      JSON.stringify({
        email: mapping.email,
        name: mapping.name,
        ...(mapping.phone ? { phone: mapping.phone } : {}),
        ...(mapping.purchases ? { purchases: mapping.purchases } : {}),
        ...(mapping.spend ? { spend: mapping.spend } : {}),
        ...(mapping.firstPurchase ? { firstPurchase: mapping.firstPurchase } : {}),
        ...(mapping.lastPurchase ? { lastPurchase: mapping.lastPurchase } : {}),
      }),
    );
    const res = await fetch('/api/admin/import', { method: 'POST', body: form });
    const data: ImportResult = await res.json();
    setResult(data);
    setImporting(false);
    setStep(3);
  }

  function resetWizard() {
    setStep(1);
    setFile(null);
    setPreview(null);
    setResult(null);
    setErrorsOpen(false);
    setSource('webticket');
    setMapping({ email: '', name: '', phone: '', purchases: '', spend: '', firstPurchase: '', lastPurchase: '' });
  }

  const previewRows = preview
    ? preview.rows.slice(0, 3).map((row) => ({
        email: mapping.email ? row[preview.headers.indexOf(mapping.email)] ?? '—' : '—',
        name: mapping.name ? row[preview.headers.indexOf(mapping.name)] ?? '—' : '—',
        phone: mapping.phone ? row[preview.headers.indexOf(mapping.phone)] ?? '—' : '—',
      }))
    : [];

  const total = result ? result.importedUsers + result.skippedRows + result.errorRows : 0;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Import zákazníků"
        description="Přeneste zákaznickou databázi z WebTicketu, ComNetu nebo jiného systému."
      />

      <div className="flex items-center gap-2 mb-8 text-sm">
        {([1, 2, 3] as const).map((n, i) => (
          <div key={n} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                step === n
                  ? 'bg-primary text-primary-foreground'
                  : step > n
                    ? 'bg-emerald-500 text-white'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {n}
            </div>
            <span className={step === n ? 'font-medium' : 'text-muted-foreground'}>
              {n === 1 ? 'Nahrání souboru' : n === 2 ? 'Mapování sloupců' : 'Výsledek'}
            </span>
            {i < 2 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <div className="flex gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                Podle GDPR máte jako správce dat právo požádat ComNet/WebTicket o export vaší zákaznické databáze ve strojitelném formátu (čl. 20 GDPR). Export vám musí poskytnout do 30 dnů.
              </p>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-3">Zdroj dat</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {SOURCE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSource(opt.value)}
                  className={`flex flex-col items-center gap-2 rounded-lg border p-4 text-sm font-medium transition-colors ${
                    source === opt.value
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border hover:bg-muted/50'
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 cursor-pointer transition-colors ${
              dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30'
            }`}
          >
            <Upload className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm font-medium">Přetáhněte CSV soubor nebo klikněte pro výběr</p>
            <p className="text-xs text-muted-foreground mt-1">Maximální velikost: 10 MB</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
          </div>
        </div>
      )}

      {step === 2 && preview && (
        <div className="space-y-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileText className="h-4 w-4" />
            <span>{file?.name}</span>
            <Badge variant="outline">Oddělovač: {preview.delimiter === '\t' ? 'TAB' : preview.delimiter}</Badge>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  {preview.headers.map((h, i) => (
                    <th key={i} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, ri) => (
                  <tr key={ri} className="border-t">
                    {preview.headers.map((_, ci) => (
                      <td key={ci} className="px-3 py-2 whitespace-nowrap text-muted-foreground">{row[ci] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <p className="text-sm font-medium mb-3">Mapování sloupců</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {MAPPING_FIELDS.map((field) => (
                <div key={field.key} className="flex items-center gap-3">
                  <label className="w-40 text-sm shrink-0">
                    {field.label}
                    {field.required && <span className="text-destructive ml-0.5">*</span>}
                  </label>
                  <select
                    className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={mapping[field.key]}
                    onChange={(e) => setMapping((m) => ({ ...m, [field.key]: e.target.value }))}
                  >
                    <option value="">— nevyužít —</option>
                    {preview.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {previewRows.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Náhled importu (první 3 záznamy)</p>
              <div className="overflow-x-auto rounded-lg border">
                <table className="min-w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">E-mail</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Jméno</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Telefon</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-2">{r.email}</td>
                        <td className="px-3 py-2">{r.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.phone}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep(1)}>Zpět</Button>
            <Button
              onClick={runImport}
              disabled={importing || !mapping.email || !mapping.name}
            >
              {importing ? 'Importuji…' : 'Importovat'}
            </Button>
          </div>
        </div>
      )}

      {step === 3 && result && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                <div className="text-3xl font-bold text-emerald-600">{result.importedUsers}</div>
                <div className="text-sm text-muted-foreground mt-1">Importováno</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <SkipForward className="h-8 w-8 text-amber-500 mx-auto mb-2" />
                <div className="text-3xl font-bold text-amber-600">{result.skippedRows}</div>
                <div className="text-sm text-muted-foreground mt-1">Přeskočeno (duplicity)</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <XCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
                <div className="text-3xl font-bold text-destructive">{result.errorRows}</div>
                <div className="text-sm text-muted-foreground mt-1">Chyby</div>
              </CardContent>
            </Card>
          </div>

          {total > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Zpracováno {total} řádků</span>
                <span>{Math.round((result.importedUsers / total) * 100)} % úspěšně</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${(result.importedUsers / total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {result.errorRows > 0 && (
            <div className="rounded-lg border border-destructive/30 overflow-hidden">
              <button
                onClick={() => setErrorsOpen((o) => !o)}
                className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/30"
              >
                <span className="text-destructive">Zobrazit chyby ({result.errors.length})</span>
                {errorsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {errorsOpen && (
                <div className="border-t">
                  <table className="min-w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">Řádek</th>
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">Důvod</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.errors.map((e, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-4 py-2">{e.row}</td>
                          <td className="px-4 py-2 text-destructive">{e.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <Button asChild>
              <a href="/admin/customers">
                <Users className="h-4 w-4 mr-2" />
                Zobrazit importované zákazníky
              </a>
            </Button>
            <Button variant="outline" onClick={resetWizard}>Importovat další soubor</Button>
          </div>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="mt-12">
          <h3 className="text-base font-semibold mb-4">Předchozí importy</h3>
          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Datum</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Zdroj</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Soubor</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Importováno</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Přeskočeno</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Chyby</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatDate(job.created_at)}</td>
                    <td className="px-4 py-3">{sourceLabel(job.source)}</td>
                    <td className="px-4 py-3 max-w-[200px] truncate text-muted-foreground">{job.filename}</td>
                    <td className="px-4 py-3 text-right font-medium text-emerald-600">{job.imported_users}</td>
                    <td className="px-4 py-3 text-right text-amber-600">{job.skipped_rows}</td>
                    <td className="px-4 py-3 text-right text-destructive">{job.error_rows}</td>
                    <td className="px-4 py-3">
                      <Badge variant={job.status === 'completed' ? 'default' : 'secondary'}>
                        {job.status === 'completed' ? 'Hotovo' : job.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
