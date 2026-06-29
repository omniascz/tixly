'use client';

import { FormEvent, useEffect, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Terminal {
  id: string;
  name: string;
  printer_type: string;
  printer_ip: string | null;
  printer_port: number;
  paper_width_mm: number;
  is_active: boolean;
  created_at: string;
}

function authHeaders(extra?: Record<string, string>) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

export default function PosTerminalsPage() {
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'zebra' | 'boca' | 'generic'>('zebra');
  const [formIp, setFormIp] = useState('');
  const [formPort, setFormPort] = useState('9100');
  const [formWidth, setFormWidth] = useState('104');
  const [formError, setFormError] = useState<string | null>(null);
  const [formSaving, setFormSaving] = useState(false);

  // Print test state
  const [printOrderId, setPrintOrderId] = useState('');
  const [printTerminalId, setPrintTerminalId] = useState('');
  const [printFormat, setPrintFormat] = useState<'zpl' | 'pdf'>('zpl');
  const [printResult, setPrintResult] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  async function loadTerminals() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/pos/terminals', { headers: authHeaders() });
      if (!res.ok) return;
      const d = (await res.json()) as { terminals: Terminal[] };
      setTerminals(d.terminals ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadTerminals(); }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormSaving(true);
    setFormError(null);
    try {
      const res = await fetch('/api/admin/pos/terminals', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name: formName.trim(),
          printerType: formType,
          printerIp: formIp.trim() || undefined,
          printerPort: parseInt(formPort, 10) || 9100,
          paperWidthMm: parseInt(formWidth, 10) || 104,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setFormError(d.message ?? d.error ?? `HTTP ${res.status}`);
        return;
      }
      setShowForm(false);
      setFormName('');
      setFormIp('');
      setFormPort('9100');
      setFormWidth('104');
      await loadTerminals();
    } finally {
      setFormSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Smazat terminál?')) return;
    const res = await fetch(`/api/admin/pos/terminals/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (res.ok) await loadTerminals();
  }

  async function handleToggleActive(t: Terminal) {
    await fetch(`/api/admin/pos/terminals/${t.id}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ isActive: !t.is_active }),
    });
    await loadTerminals();
  }

  async function handlePrint(e: FormEvent) {
    e.preventDefault();
    setPrinting(true);
    setPrintResult(null);
    setPrintError(null);
    try {
      const res = await fetch('/api/admin/pos/print', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          orderId: printOrderId.trim(),
          terminalId: printTerminalId,
          format: printFormat,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setPrintError(d.message ?? d.error ?? `HTTP ${res.status}`);
        return;
      }
      const preview = printFormat === 'zpl'
        ? `ZPL payload (${d.ticketCount} vstupenek):\n${String(d.payload).slice(0, 400)}…`
        : `PDF generován — ${d.ticketCount} vstupenek (base64, ${String(d.payload).length} B)`;
      setPrintResult(`Job ID: ${d.jobId}\n${preview}`);
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="POS Terminály — Tiskárny"
        description="Správa termálních tiskáren pro box office (Zebra, Boca)."
      />

      <div className="flex items-center gap-3">
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Zrušit' : '+ Přidat terminál'}
        </Button>
        <Button variant="outline" size="sm" onClick={loadTerminals} disabled={loading}>
          {loading ? 'Načítám…' : 'Obnovit'}
        </Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle>Nový terminál</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium">Název *</label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                  placeholder="Pokladna 1 — Foyer"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Typ tiskárny</label>
                <select
                  value={formType}
                  onChange={(e) => setFormType(e.target.value as 'zebra' | 'boca' | 'generic')}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                >
                  <option value="zebra">Zebra (GK420d / ZD420)</option>
                  <option value="boca">Boca Systems</option>
                  <option value="generic">Generická (ESC/POS)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">IP adresa</label>
                <Input
                  value={formIp}
                  onChange={(e) => setFormIp(e.target.value)}
                  placeholder="192.168.1.100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Port (default 9100)</label>
                <Input
                  type="number"
                  value={formPort}
                  onChange={(e) => setFormPort(e.target.value)}
                  min={1}
                  max={65535}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Šířka papíru (mm, default 104)</label>
                <Input
                  type="number"
                  value={formWidth}
                  onChange={(e) => setFormWidth(e.target.value)}
                  min={50}
                  max={200}
                />
              </div>
              {formError ? (
                <p className="sm:col-span-2 text-sm text-destructive">{formError}</p>
              ) : null}
              <div className="sm:col-span-2 flex gap-2">
                <Button type="submit" disabled={formSaving}>
                  {formSaving ? 'Ukládám…' : 'Přidat'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Zrušit
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Terminály ({terminals.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Název</th>
                  <th className="px-4 py-2 text-left font-medium">Typ</th>
                  <th className="px-4 py-2 text-left font-medium">IP adresa</th>
                  <th className="px-4 py-2 text-left font-medium">Port</th>
                  <th className="px-4 py-2 text-left font-medium">Šířka</th>
                  <th className="px-4 py-2 text-left font-medium">Stav</th>
                  <th className="px-4 py-2 text-left font-medium">Akce</th>
                </tr>
              </thead>
              <tbody>
                {terminals.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                      Žádné terminály. Přidejte první tiskárnu.
                    </td>
                  </tr>
                ) : null}
                {terminals.map((t) => (
                  <tr key={t.id} className="border-b hover:bg-muted/20">
                    <td className="px-4 py-2 font-medium">{t.name}</td>
                    <td className="px-4 py-2 capitalize">{t.printer_type}</td>
                    <td className="px-4 py-2 font-mono text-xs">{t.printer_ip ?? '—'}</td>
                    <td className="px-4 py-2">{t.printer_port}</td>
                    <td className="px-4 py-2">{t.paper_width_mm} mm</td>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(t)}
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          t.is_active
                            ? 'bg-green-100 text-green-900'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {t.is_active ? 'Aktivní' : 'Neaktivní'}
                      </button>
                    </td>
                    <td className="px-4 py-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDelete(t.id)}
                      >
                        Smazat
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Test print section */}
      <Card>
        <CardHeader>
          <CardTitle>Tisknout vstupenky z objednávky</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePrint} className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">ID objednávky (UUID) *</label>
              <Input
                value={printOrderId}
                onChange={(e) => setPrintOrderId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Terminál *</label>
              <select
                value={printTerminalId}
                onChange={(e) => setPrintTerminalId(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                required
              >
                <option value="">— Vyberte terminál —</option>
                {terminals.filter((t) => t.is_active).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.printer_type} · {t.printer_ip ?? 'bez IP'})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Formát</label>
              <select
                value={printFormat}
                onChange={(e) => setPrintFormat(e.target.value as 'zpl' | 'pdf')}
                className="w-full rounded-md border px-3 py-2 text-sm"
              >
                <option value="zpl">ZPL (Zebra Programming Language)</option>
                <option value="pdf">PDF (base64)</option>
              </select>
            </div>
            <div className="sm:col-span-2 flex gap-2">
              <Button type="submit" disabled={printing || !printTerminalId}>
                {printing ? 'Generuji…' : 'Tisknout / Generovat payload'}
              </Button>
            </div>
            {printError ? (
              <p className="sm:col-span-2 text-sm text-destructive">{printError}</p>
            ) : null}
            {printResult ? (
              <pre className="sm:col-span-2 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
                {printResult}
              </pre>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
