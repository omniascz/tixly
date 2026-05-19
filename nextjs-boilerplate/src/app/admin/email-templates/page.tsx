'use client';

import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Template {
  type: 'order_confirmation' | 'refund' | 'daily_stats';
  custom: boolean;
  subject: string;
  bodyHtml: string;
  active: boolean;
  updatedAt: string | null;
}

const LABELS = {
  order_confirmation: 'Potvrzení objednávky',
  refund: 'Refund',
  daily_stats: 'Denní statistiky',
};

const VARS = {
  order_confirmation: ['{{eventTitle}}', '{{buyerName}}', '{{totalAmount}}', '{{orderId}}'],
  refund: ['{{orderId}}', '{{amount}}', '{{reason}}', '{{eventTitle}}'],
  daily_stats: ['{{revenue}}', '{{ordersCount}}', '{{tickets}}', '{{date}}'],
};

const SNIPPETS = [
  {
    label: 'CTA tlačítko',
    title: 'Brandované tlačítko s odkazem',
    html: '<a href="https://example.com" style="display:inline-block;padding:12px 24px;background:#10b981;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Otevřít vstupenku</a>',
  },
  {
    label: 'Info box',
    title: 'Šedý box s upozorněním',
    html: '<div style="margin:16px 0;padding:12px;background:#f3f4f6;border-left:4px solid #6b7280;color:#374151;font-size:14px"><strong>Info:</strong> Vyplň text…</div>',
  },
  {
    label: 'Detail řádek',
    title: 'Řádek "Štítek: hodnota"',
    html: '<p style="margin:4px 0"><strong>Štítek:</strong> hodnota</p>',
  },
  {
    label: 'Footer',
    title: 'Standardní patička',
    html: '<hr style="margin:24px 0;border:0;border-top:1px solid #e5e7eb"><p style="color:#6b7280;font-size:12px;text-align:center">Tento e-mail je transakční. Pokud máš dotaz, odpověz na něj.</p>',
  },
];

export default function EmailTemplatesPage() {
  const [list, setList] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewSubject, setPreviewSubject] = useState<string>('');
  const [testEmail, setTestEmail] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  function insertAtCursor(text: string): void {
    if (!editing) return;
    const ta = bodyRef.current;
    if (!ta) {
      setEditing({ ...editing, bodyHtml: editing.bodyHtml + text });
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = editing.bodyHtml.slice(0, start);
    const after = editing.bodyHtml.slice(end);
    const newBody = before + text + after;
    setEditing({ ...editing, bodyHtml: newBody });
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + text.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  function wrapSelection(prefix: string, suffix: string, fallback?: string): void {
    if (!editing) return;
    const ta = bodyRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = editing.bodyHtml.slice(start, end);
    const content = selected || fallback || '';
    const before = editing.bodyHtml.slice(0, start);
    const after = editing.bodyHtml.slice(end);
    const newBody = before + prefix + content + suffix + after;
    setEditing({ ...editing, bodyHtml: newBody });
    requestAnimationFrame(() => {
      ta.focus();
      const newStart = start + prefix.length;
      const newEnd = newStart + content.length;
      ta.setSelectionRange(newStart, newEnd);
    });
  }

  async function preview(sendTo?: string) {
    if (!editing) return;
    const token = localStorage.getItem('accessToken');
    const r = await fetch('/api/admin/email-templates/preview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        type: editing.type,
        subject: editing.subject,
        bodyHtml: editing.bodyHtml,
        sendTestTo: sendTo,
      }),
    });
    if (!r.ok) {
      setFeedback('Preview selhalo.');
      return;
    }
    const j = (await r.json()) as {
      renderedHtml: string;
      renderedSubject: string;
      testSent?: boolean;
      testSentTo?: string;
    };
    setPreviewHtml(j.renderedHtml);
    setPreviewSubject(j.renderedSubject);
    if (j.testSent) {
      setFeedback(`Test mail odeslán na ${j.testSentTo}.`);
    }
  }

  async function reload() {
    const token = localStorage.getItem('accessToken');
    const r = await fetch('/api/admin/email-templates', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (r.ok) {
      const d = (await r.json()) as { templates: Template[] };
      setList(d.templates);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function save() {
    if (!editing) return;
    setLoading(true);
    setFeedback(null);
    try {
      const token = localStorage.getItem('accessToken');
      const r = await fetch('/api/admin/email-templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          type: editing.type,
          subject: editing.subject,
          bodyHtml: editing.bodyHtml,
        }),
      });
      if (!r.ok) {
        const d = await r.json();
        setFeedback(`Chyba: ${d.error ?? r.status}`);
        return;
      }
      setFeedback('Šablona uložena.');
      setEditing(null);
      await reload();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="E-mailové šablony"
        description="Customizovaný subject + HTML body pro 3 typy e-mailů. Pokud nevyplníš, použije se default."
      />

      {feedback ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
          {feedback}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4">
        {list.map((t) => (
          <Card key={t.type}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{LABELS[t.type]}</span>
                <span
                  className={`text-xs font-medium ${t.custom ? 'text-emerald-700' : 'text-muted-foreground'}`}
                >
                  {t.custom ? 'Customizované' : 'Default'}
                </span>
              </CardTitle>
              <CardDescription>
                Dostupné proměnné:{' '}
                {VARS[t.type].map((v) => (
                  <code
                    key={v}
                    className="mr-1 rounded bg-muted px-1 text-[11px]"
                  >
                    {v}
                  </code>
                ))}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {editing?.type === t.type ? (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium">Subject</label>
                    <Input
                      value={editing.subject}
                      onChange={(e) =>
                        setEditing({ ...editing, subject: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium">
                      Body (HTML)
                    </label>

                    {/* Toolbar — quick-insert proměnných */}
                    <div className="mb-2 flex flex-wrap items-center gap-1 rounded-md border bg-muted/40 p-1">
                      <span className="px-1 text-[11px] uppercase text-muted-foreground">
                        Vlož:
                      </span>
                      {VARS[t.type].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => insertAtCursor(v)}
                          className="rounded bg-background px-2 py-0.5 font-mono text-[11px] hover:bg-emerald-100"
                          title={`Vlož ${v} na pozici kurzoru`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>

                    {/* Toolbar — formátovací tlačítka */}
                    <div className="mb-2 flex flex-wrap items-center gap-1 rounded-md border bg-muted/40 p-1">
                      <span className="px-1 text-[11px] uppercase text-muted-foreground">
                        Formát:
                      </span>
                      <button
                        type="button"
                        onClick={() => wrapSelection('<strong>', '</strong>', 'tučný text')}
                        className="rounded bg-background px-2 py-0.5 text-xs font-bold hover:bg-emerald-100"
                        title="Tučný (Ctrl+B)"
                      >
                        B
                      </button>
                      <button
                        type="button"
                        onClick={() => wrapSelection('<em>', '</em>', 'kurzíva')}
                        className="rounded bg-background px-2 py-0.5 text-xs italic hover:bg-emerald-100"
                        title="Kurzíva"
                      >
                        I
                      </button>
                      <button
                        type="button"
                        onClick={() => wrapSelection('<h2 style="margin:16px 0 8px;font-size:18px;color:#111">', '</h2>', 'Nadpis')}
                        className="rounded bg-background px-2 py-0.5 text-xs font-semibold hover:bg-emerald-100"
                        title="Nadpis úrovně 2"
                      >
                        H2
                      </button>
                      <button
                        type="button"
                        onClick={() => wrapSelection('<a href="https://example.com" style="color:#10b981">', '</a>', 'odkaz')}
                        className="rounded bg-background px-2 py-0.5 text-xs underline hover:bg-emerald-100"
                        title="Odkaz"
                      >
                        🔗
                      </button>
                      <button
                        type="button"
                        onClick={() => insertAtCursor('<p style="margin:8px 0">Odstavec textu.</p>\n')}
                        className="rounded bg-background px-2 py-0.5 text-xs hover:bg-emerald-100"
                        title="Vlož odstavec"
                      >
                        ¶
                      </button>
                      <button
                        type="button"
                        onClick={() => insertAtCursor('<br>\n')}
                        className="rounded bg-background px-2 py-0.5 text-xs hover:bg-emerald-100"
                        title="Odřádkování"
                      >
                        ↵
                      </button>
                    </div>

                    {/* Toolbar — bloky / snippets */}
                    <div className="mb-2 flex flex-wrap items-center gap-1 rounded-md border bg-muted/40 p-1">
                      <span className="px-1 text-[11px] uppercase text-muted-foreground">
                        Bloky:
                      </span>
                      {SNIPPETS.map((s) => (
                        <button
                          key={s.label}
                          type="button"
                          onClick={() => insertAtCursor('\n' + s.html + '\n')}
                          className="rounded bg-background px-2 py-0.5 text-[11px] hover:bg-emerald-100"
                          title={s.title}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>

                    <textarea
                      ref={bodyRef}
                      className="flex min-h-48 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
                      value={editing.bodyHtml}
                      onChange={(e) =>
                        setEditing({ ...editing, bodyHtml: e.target.value })
                      }
                      onKeyDown={(e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
                          e.preventDefault();
                          wrapSelection('<strong>', '</strong>', 'tučný text');
                        }
                      }}
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Tip: označ text v editoru a klikni na formátovací tlačítko —
                      wrapne selekci. Ctrl+B pro tučný.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={save} disabled={loading}>
                      {loading ? 'Ukládám…' : 'Uložit'}
                    </Button>
                    <Button variant="outline" onClick={() => preview()}>
                      👁 Preview
                    </Button>
                    <Button variant="outline" onClick={() => { setEditing(null); setPreviewHtml(null); }}>
                      Zrušit
                    </Button>
                  </div>

                  {previewHtml ? (
                    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs uppercase text-muted-foreground">Preview subject</p>
                          <p className="font-mono text-sm">{previewSubject}</p>
                        </div>
                        <div className="flex gap-2">
                          <Input
                            type="email"
                            placeholder="test@example.com"
                            value={testEmail}
                            onChange={(e) => setTestEmail(e.target.value)}
                            className="w-48"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => preview(testEmail)}
                            disabled={!testEmail.trim()}
                          >
                            Pošli test mail
                          </Button>
                        </div>
                      </div>
                      <iframe
                        srcDoc={previewHtml}
                        title="Preview"
                        className="h-96 w-full rounded border bg-white"
                        sandbox=""
                      />
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-xs uppercase text-muted-foreground">
                      Subject
                    </span>
                    <p className="font-mono">{t.subject}</p>
                  </div>
                  <div>
                    <span className="text-xs uppercase text-muted-foreground">
                      Body preview
                    </span>
                    <pre className="overflow-x-auto rounded bg-muted p-2 text-[11px]">
                      {t.bodyHtml}
                    </pre>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(t)}
                  >
                    Upravit
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
