'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin/PageHeader';

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

export default function EmailTemplatesPage() {
  const [list, setList] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewSubject, setPreviewSubject] = useState<string>('');
  const [testEmail, setTestEmail] = useState('');

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
                    <textarea
                      className="flex min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
                      value={editing.bodyHtml}
                      onChange={(e) =>
                        setEditing({ ...editing, bodyHtml: e.target.value })
                      }
                    />
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
