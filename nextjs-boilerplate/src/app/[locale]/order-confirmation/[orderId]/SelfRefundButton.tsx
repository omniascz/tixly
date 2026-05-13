'use client';

/**
 * Self-service refund tlačítko v order confirmation.
 *
 * Pokud promotér v settings povolil `allow_customer_self_refund`,
 * kupec si může v rámci refund okna sám zažádat o storno.
 *
 * Server endpoint validuje policy → vrátí 403 SELF_REFUND_DISABLED nebo 409
 * REFUND_WINDOW_EXPIRED jinak. UI se rozhodne podle response.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

export function SelfRefundButton({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`/api/buyer/orders/${orderId}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ reason: reason || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? data.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess(
        `Refund proběhl. Vráceno ${(data.refundedHalire / 100).toLocaleString('cs-CZ')} Kč na původní platební metodu (může trvat 3–5 pracovních dní).`,
      );
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
        <CheckCircle2 className="mt-0.5 h-4 w-4" aria-hidden /> {success}
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-muted/20 p-3 text-sm">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-rose-700 hover:underline"
        >
          Vrátit lístky a peníze
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Pokud pořadatel povolil samostatné storno a jsi v rámci refund okna,
            tvé lístky budou znehodnoceny a peníze ti budou vráceny.
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Důvod (volitelné)"
            rows={2}
            maxLength={500}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900">
              <AlertTriangle className="mt-0.5 h-4 w-4" aria-hidden /> {error}
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Zrušit
            </Button>
            <Button
              size="sm"
              onClick={() => void submit()}
              disabled={busy}
              className="bg-rose-700 hover:bg-rose-800"
            >
              {busy ? 'Žádám…' : 'Potvrdit a vrátit'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
