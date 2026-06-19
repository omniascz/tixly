'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Eye, Send } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { escapeHtml } from '@/lib/html-escape/escape';

type Target = 'all' | 'buyers_only' | 'contacts_only' | 'subscribers' | 'event';

interface EventOption {
  id: string;
  title: string;
  date_start: string;
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

const TARGET_OPTIONS: { value: Target; label: string }[] = [
  { value: 'all', label: 'Všichni zákazníci (importovaní + kupující)' },
  { value: 'buyers_only', label: 'Pouze kupující přes Tixly' },
  { value: 'contacts_only', label: 'Pouze importovaná databáze' },
  { value: 'subscribers', label: 'Pouze předplatitelé' },
  { value: 'event', label: 'Zákazníci konkrétní akce' },
];

function buildPreviewHtml(subject: string, body: string, promoterName: string): string {
  const paragraphs = body
    .split('\n')
    .map((line) => `<p style="margin:0 0 8px">${escapeHtml(line) || '&nbsp;'}</p>`)
    .join('');
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px">
      <div style="border-bottom:2px solid #1a1a1a;padding-bottom:12px;margin-bottom:16px">
        <p style="margin:0;font-size:13px;color:#666">${escapeHtml(promoterName)}</p>
        <h2 style="margin:4px 0 0;font-size:18px;font-weight:600">${escapeHtml(subject || '(předmět)')}</h2>
      </div>
      <div style="font-size:14px;color:#1a1a1a;line-height:1.6">
        ${paragraphs || '<p style="color:#999">Zpráva bude zde…</p>'}
      </div>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
      <p style="font-size:11px;color:#999;margin:0">Tato zpráva byla odeslána pořadatelem akce přes platformu Tixly.</p>
      <p style="font-size:11px;margin:4px 0 0"><a href="#" style="color:#6b7280">Odhlásit se z novinek</a></p>
    </div>
  `;
}

export default function NewBroadcastPage() {
  const router = useRouter();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [target, setTarget] = useState<Target>('all');
  const [eventId, setEventId] = useState('');
  const [events, setEvents] = useState<EventOption[]>([]);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [promoterName] = useState('Váš pořadatel');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const previewCountRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch('/api/admin/pos/events');
        if (res.ok) {
          const data = (await res.json()) as { events: EventOption[] };
          setEvents(data.events ?? []);
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    if (!draftId) return;
    if (previewCountRef.current) clearTimeout(previewCountRef.current);
    previewCountRef.current = setTimeout(async () => {
      setCountLoading(true);
      try {
        const res = await authFetch(`/api/admin/broadcasts/${draftId}/preview`);
        if (res.ok) {
          const data = (await res.json()) as { recipientCount: number };
          setRecipientCount(data.recipientCount);
        }
      } finally {
        setCountLoading(false);
      }
    }, 400);
    return () => {
      if (previewCountRef.current) clearTimeout(previewCountRef.current);
    };
  }, [draftId, target, eventId]);

  async function saveDraft() {
    setError(null);
    if (!subject.trim() || !body.trim()) {
      setError('Vyplňte předmět a zprávu.');
      return null;
    }
    if (body.trim().length < 20) {
      setError('Zpráva musí mít alespoň 20 znaků.');
      return null;
    }
    if (target === 'event' && !eventId) {
      setError('Vyberte akci.');
      return null;
    }
    setBusy(true);
    try {
      const res = await authFetch('/api/admin/broadcasts', {
        method: 'POST',
        body: JSON.stringify({
          subject,
          body,
          target,
          eventId: target === 'event' ? eventId : undefined,
        }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return null;
      }
      setDraftId(data.id ?? null);
      return data.id ?? null;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Síťová chyba');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveDraft() {
    const id = draftId ?? (await saveDraft());
    if (id) router.push('/admin/broadcasts');
  }

  async function handleSend() {
    let id = draftId;
    if (!id) {
      id = await saveDraft();
    }
    if (!id) return;
    setShowConfirm(true);
  }

  async function confirmSend() {
    if (!draftId) return;
    setShowConfirm(false);
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/admin/broadcasts/${draftId}/send`, { method: 'POST' });
      const data = (await res.json()) as { sent?: number; error?: string };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess(true);
      setTimeout(() => router.push('/admin/broadcasts'), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Síťová chyba');
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <CheckCircle2 className="mb-4 h-12 w-12 text-emerald-500" aria-hidden />
        <h2 className="text-xl font-semibold">Email odeslán</h2>
        <p className="mt-1 text-sm text-muted-foreground">Přesměrovávám…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nový hromadný email"
        description="Napište zprávu pro zákazníky vašeho divadla."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Obsah zprávy</CardTitle>
            <CardDescription>Vyplňte předmět, text a cílovou skupinu.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label htmlFor="br-subject" className="mb-1 block text-xs font-medium">
                Předmět *
              </label>
              <Input
                id="br-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Připomínka: Romeo a Julie zítra v 19:30"
                maxLength={200}
              />
            </div>

            <div>
              <label htmlFor="br-body" className="mb-1 block text-xs font-medium">
                Zpráva *
              </label>
              <Textarea
                id="br-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={9}
                minLength={20}
                maxLength={10000}
                placeholder={
                  'Milí přátelé,\n\npřipomínáme, že zítra ve 19:30 se těšíme na setkání v Hlavním sále. ' +
                  'Doporučujeme dorazit 20 minut před začátkem.\n\nHezky se mějte,\nDivadlo Verze'
                }
              />
              <p className="mt-1 text-xs text-muted-foreground">{body.length}/10 000 znaků</p>
            </div>

            <fieldset className="space-y-2">
              <legend className="mb-1 block text-xs font-medium">Cílová skupina</legend>
              {TARGET_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-md border p-2.5 text-sm transition-colors ${
                    target === opt.value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="target"
                    value={opt.value}
                    checked={target === opt.value}
                    onChange={() => setTarget(opt.value)}
                    className="accent-primary"
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </fieldset>

            {target === 'event' && (
              <div>
                <label htmlFor="br-event" className="mb-1 block text-xs font-medium">
                  Akce *
                </label>
                <select
                  id="br-event"
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">— vyberte akci —</option>
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {draftId && (
              <p className="text-sm text-muted-foreground">
                {countLoading
                  ? 'Počítám příjemce…'
                  : recipientCount !== null
                    ? `Odesláno přibližně ${recipientCount} lidem`
                    : null}
              </p>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
                {error}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={() => void handleSaveDraft()} disabled={busy}>
                Uložit jako draft
              </Button>
              <Button
                className="bg-rose-600 hover:bg-rose-700 text-white"
                onClick={() => void handleSend()}
                disabled={busy || !subject.trim() || !body.trim() || body.length < 20}
              >
                <Send className="mr-1.5 h-4 w-4" aria-hidden />
                {busy ? 'Odesílám…' : 'Odeslat nyní'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4" aria-hidden />
              Náhled e-mailu
            </CardTitle>
            <CardDescription>Takto uvidí zprávu příjemci.</CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="rounded-md border bg-white p-1 text-sm"
              dangerouslySetInnerHTML={{
                __html: buildPreviewHtml(subject, body, promoterName),
              }}
            />
          </CardContent>
        </Card>
      </div>

      {showConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowConfirm(false);
          }}
        >
          <Card className="w-full max-w-sm">
            <CardHeader>
              <CardTitle>Potvrdit odeslání</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Opravdu chcete odeslat email{' '}
                {recipientCount !== null ? (
                  <strong>{recipientCount} lidem</strong>
                ) : (
                  'zákazníkům'
                )}
                ? Tuto akci nelze vrátit zpět.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowConfirm(false)}>
                  Zrušit
                </Button>
                <Button
                  className="bg-rose-600 hover:bg-rose-700 text-white"
                  onClick={() => void confirmSend()}
                  disabled={busy}
                >
                  {busy ? 'Odesílám…' : 'Odeslat'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
