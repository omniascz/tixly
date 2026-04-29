'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Preferences {
  email_enabled: boolean;
  sms_enabled: boolean;
  push_enabled: boolean;
  order_confirmations: boolean;
  pre_event_reminders: boolean;
  marketing: boolean;
  promoter_news: boolean;
  abandoned_cart: boolean;
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

export function NotificationPreferencesClient() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const res = await authFetch('/api/buyer/notification-preferences');
    if (res.status === 401) {
      setError('Pro nastavení se musíš přihlásit.');
      return;
    }
    if (!res.ok) {
      setError(`HTTP ${res.status}`);
      return;
    }
    const j = (await res.json()) as { preferences: Preferences };
    setPrefs(j.preferences);
  }

  function update<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    if (!prefs) return;
    setPrefs({ ...prefs, [key]: value });
  }

  async function save() {
    if (!prefs) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch('/api/buyer/notification-preferences', {
        method: 'PUT',
        body: JSON.stringify({
          emailEnabled: prefs.email_enabled,
          smsEnabled: prefs.sms_enabled,
          pushEnabled: prefs.push_enabled,
          orderConfirmations: prefs.order_confirmations,
          preEventReminders: prefs.pre_event_reminders,
          marketing: prefs.marketing,
          promoterNews: prefs.promoter_news,
          abandonedCart: prefs.abandoned_cart,
        }),
      });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      setFeedback('Uloženo.');
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
        {error}
      </div>
    );
  }
  if (!prefs) return <p className="text-sm text-muted-foreground">Načítání…</p>;

  return (
    <div className="space-y-4">
      {feedback ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {feedback}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Kanály</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Toggle
            label="E-mail"
            description="Hlavní kanál"
            checked={prefs.email_enabled}
            onChange={(v) => update('email_enabled', v)}
          />
          <Toggle
            label="SMS"
            description="Pro důležité reminders (1h před akcí)"
            checked={prefs.sms_enabled}
            onChange={(v) => update('sms_enabled', v)}
          />
          <Toggle
            label="Push notifikace"
            description="V mobilní appce / PWA"
            checked={prefs.push_enabled}
            onChange={(v) => update('push_enabled', v)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Typy zpráv</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Toggle
            label="Potvrzení nákupu"
            description="Vždy posíláme — transakční"
            checked={prefs.order_confirmations}
            onChange={(v) => update('order_confirmations', v)}
            disabled
          />
          <Toggle
            label="Připomínky před akcí"
            description="7 dní, 1 den, 1 hodina před"
            checked={prefs.pre_event_reminders}
            onChange={(v) => update('pre_event_reminders', v)}
          />
          <Toggle
            label="Připomínka nedokončené objednávky"
            description="Po 30 min, pokud jsi nezaplatil"
            checked={prefs.abandoned_cart}
            onChange={(v) => update('abandoned_cart', v)}
          />
          <Toggle
            label="Marketingové novinky"
            description="Doporučené akce, exkluzivní pre-sale"
            checked={prefs.marketing}
            onChange={(v) => update('marketing', v)}
          />
          <Toggle
            label="Pořadatelské novinky"
            description="Změny programu, oznámení"
            checked={prefs.promoter_news}
            onChange={(v) => update('promoter_news', v)}
          />
        </CardContent>
      </Card>

      <Button onClick={save} disabled={busy} className="w-full">
        {busy ? 'Ukládám…' : 'Uložit'}
      </Button>
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start justify-between gap-3 rounded-md border p-3 ${
        disabled ? 'opacity-60' : 'cursor-pointer hover:bg-muted/30'
      }`}
    >
      <div className="flex-1">
        <div className="text-sm font-medium">{label}</div>
        {description ? <div className="text-xs text-muted-foreground">{description}</div> : null}
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-1 h-5 w-5"
      />
    </label>
  );
}
