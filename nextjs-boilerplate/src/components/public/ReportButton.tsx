'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Props {
  eventId?: string;
  promoterId?: string;
  reportedUrl?: string;
  locale?: 'cs' | 'sk' | 'en';
}

const STRINGS = {
  cs: {
    trigger: '🚩 Nahlásit obsah',
    title: 'Nahlásit obsah',
    description: 'Per DSA — pokud je obsah v rozporu se zákonem, je podvodný nebo nevhodný.',
    category: 'Kategorie',
    reason: 'Důvod (popis problému)',
    email: 'Tvůj email (volitelné — pro feedback)',
    submit: 'Odeslat hlášení',
    sending: 'Odesílám…',
    cancel: 'Zrušit',
    success: 'Děkujeme. Hlášení doručeno, vyřídíme do 7 dní.',
    successUrgent: 'Děkujeme. Urgentní hlášení řešíme okamžitě.',
    error: 'Chyba odeslání',
    categories: {
      illegal_content: 'Protizákonný obsah',
      extremism: 'Propagace extremismu',
      hate_speech: 'Nenávistné projevy',
      scam: 'Podvodná akce',
      copyright: 'Porušení autorských práv',
      impersonation: 'Vydávání se za někoho',
      inappropriate: 'Nevhodný / pro děti',
      spam: 'Spam / opakované akce',
      fake_event: 'Akce neexistuje',
      safety: 'Bezpečnostní hrozba',
      other: 'Jiné',
    },
  },
  sk: {
    trigger: '🚩 Nahlásiť obsah',
    title: 'Nahlásiť obsah',
    description: 'Per DSA — ak je obsah v rozpore so zákonom, podvodný alebo nevhodný.',
    category: 'Kategória',
    reason: 'Dôvod (popis problému)',
    email: 'Tvoj email (voliteľné)',
    submit: 'Odoslať hlásenie',
    sending: 'Odosielam…',
    cancel: 'Zrušiť',
    success: 'Ďakujeme. Hlásenie doručené, vyriešime do 7 dní.',
    successUrgent: 'Ďakujeme. Urgentné hlásenie riešime okamžite.',
    error: 'Chyba odoslania',
    categories: {
      illegal_content: 'Protizákonný obsah',
      extremism: 'Propagácia extrémizmu',
      hate_speech: 'Nenávistné prejavy',
      scam: 'Podvodná akcia',
      copyright: 'Porušenie autorských práv',
      impersonation: 'Vydávanie sa za niekoho',
      inappropriate: 'Nevhodný / pre deti',
      spam: 'Spam / opakované akcie',
      fake_event: 'Akcia neexistuje',
      safety: 'Bezpečnostná hrozba',
      other: 'Iné',
    },
  },
  en: {
    trigger: '🚩 Report content',
    title: 'Report content',
    description: 'Per DSA — if the content is illegal, fraudulent or inappropriate.',
    category: 'Category',
    reason: 'Reason (describe the issue)',
    email: 'Your email (optional)',
    submit: 'Submit report',
    sending: 'Sending…',
    cancel: 'Cancel',
    success: 'Thanks. Your report was received, we will respond within 7 days.',
    successUrgent: 'Thanks. Urgent reports are handled immediately.',
    error: 'Submission failed',
    categories: {
      illegal_content: 'Illegal content',
      extremism: 'Extremism',
      hate_speech: 'Hate speech',
      scam: 'Scam / fraud',
      copyright: 'Copyright violation',
      impersonation: 'Impersonation',
      inappropriate: 'Inappropriate / minor',
      spam: 'Spam / repeated',
      fake_event: 'Fake event',
      safety: 'Safety threat',
      other: 'Other',
    },
  },
};

type Category = keyof (typeof STRINGS)['cs']['categories'];

export function ReportButton({ eventId, promoterId, reportedUrl, locale = 'cs' }: Props) {
  const s = STRINGS[locale] ?? STRINGS.cs;
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>('inappropriate');
  const [reason, setReason] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'ok' | 'urgent' | 'err' | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrMsg(null);
    try {
      const res = await fetch('/api/public/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          promoterId,
          reportedUrl: reportedUrl ?? (typeof window !== 'undefined' ? window.location.href : undefined),
          category,
          reason,
          reporterEmail: email || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setResult('err');
        setErrMsg(j.message ?? `HTTP ${res.status}`);
        return;
      }
      setResult(j.priority === 'urgent' ? 'urgent' : 'ok');
      setReason('');
      setEmail('');
    } catch (err) {
      setResult('err');
      setErrMsg(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-muted-foreground hover:text-rose-700 hover:underline"
      >
        {s.trigger}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-lg bg-card p-5 shadow-lg">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">{s.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{s.description}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setResult(null);
            }}
            className="text-muted-foreground hover:text-foreground"
            aria-label={s.cancel}
          >
            ✕
          </button>
        </div>

        {result === 'ok' || result === 'urgent' ? (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
            {result === 'urgent' ? s.successUrgent : s.success}
            <div className="mt-3 text-right">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                OK
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">{s.category}</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {(Object.keys(s.categories) as Category[]).map((k) => (
                  <option key={k} value={k}>
                    {s.categories[k]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">{s.reason}</label>
              <textarea
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                rows={4}
                minLength={10}
                maxLength={5000}
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">{s.email}</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            {result === 'err' ? (
              <div className="rounded-md border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900">
                {errMsg ?? s.error}
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                {s.cancel}
              </Button>
              <Button type="submit" disabled={busy || reason.trim().length < 10}>
                {busy ? s.sending : s.submit}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
