'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin/PageHeader';

interface Campaign {
  id: string;
  name: string;
  messageText: string;
  status: string;
  recipientsCount: number;
  deliveredCount: number;
  failedCount: number;
  createdAt: string;
}

export default function SmsCampaignsPage() {
  const [list, setList] = useState<Campaign[]>([]);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [minOrders, setMinOrders] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function reload() {
    const token = localStorage.getItem('accessToken');
    const r = await fetch('/api/admin/sms-campaigns', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (r.ok) {
      const d = (await r.json()) as { campaigns: Campaign[] };
      setList(d.campaigns);
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    setLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const r = await fetch('/api/admin/sms-campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name,
          messageText: text,
          segmentMinOrders: parseInt(minOrders, 10),
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setFeedback(
        `Kampaň odeslána: ${d.deliveredCount}/${d.recipientsCount} doručeno (${d.failedCount} chyb).`,
      );
      setName('');
      setText('');
      await reload();
    } catch {
      setError('Síťová chyba');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="SMS kampaně"
        description="Hromadné SMS na segmenty kupců (BulkGate). 160 znaků = 1 segment."
      />

      <Card>
        <CardHeader>
          <CardTitle>Nová kampaň</CardTitle>
          <CardDescription>
            Pošle se okamžitě po odeslání. Příjemci: kupci s telefonem a
            ≥ N zaplacených objednávek.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium">Název kampaně</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Letní festival 2026 — early bird"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                Min. objednávek (segment)
              </label>
              <Input
                type="number"
                min={1}
                value={minOrders}
                onChange={(e) => setMinOrders(e.target.value)}
                required
              />
            </div>
            <div className="md:col-span-3">
              <label className="mb-1 block text-xs font-medium">
                Text SMS ({text.length}/160)
              </label>
              <textarea
                className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={480}
                placeholder="Tixly: Akce X má early bird slevu 20 % do neděle. https://tixly.cz/e/abc"
                required
              />
            </div>
            {error && (
              <p className="md:col-span-3 text-sm text-destructive">{error}</p>
            )}
            <div className="md:col-span-3 flex justify-end">
              <Button type="submit" disabled={loading}>
                {loading ? 'Odesílám…' : 'Odeslat kampaň'}
              </Button>
            </div>
          </form>
          {feedback && (
            <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
              {feedback}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historie kampaní</CardTitle>
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádné kampaně.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Název</th>
                  <th>Text</th>
                  <th>Příjemci</th>
                  <th>Doručeno</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="border-b">
                    <td className="py-2 font-medium">{c.name}</td>
                    <td className="max-w-md text-xs text-muted-foreground">
                      {c.messageText.slice(0, 80)}
                      {c.messageText.length > 80 ? '…' : ''}
                    </td>
                    <td>{c.recipientsCount}</td>
                    <td>
                      {c.deliveredCount} / {c.recipientsCount}
                      {c.failedCount > 0 ? (
                        <span className="ml-1 text-rose-700">
                          ({c.failedCount} fail)
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                        {c.status}
                      </span>
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
