'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Refundace na jednom místě.
 *
 * Dřív existovaly dvě různé implementace téhož: detail objednávky měl pořádný
 * formulář s výběrem důvodu, poznámkou do auditu a potvrzením s přesnou
 * částkou — zatímco seznam objednávek použil window.confirm a důvod posílal
 * natvrdo ('customer_request' u jednotlivé, 'event_cancelled' u hromadné).
 * Audit log tak obsahoval důvod, který nikdo nevybral.
 *
 * RefundForm jsou samotná pole (používá je detail inline), RefundDialog je
 * tentýž formulář v modálním okně (používá ho seznam).
 */

export type RefundReason =
  | 'event_cancelled'
  | 'customer_request'
  | 'duplicate_order'
  | 'fraud'
  | 'chargeback';

export const REFUND_REASON_LABELS: Record<RefundReason, string> = {
  event_cancelled: 'Akce byla zrušena',
  customer_request: 'Žádost zákazníka',
  duplicate_order: 'Duplicitní objednávka',
  fraud: 'Podezření z podvodu',
  chargeback: 'Chargeback',
};

export interface RefundSubmit {
  reason: RefundReason;
  note?: string;
}

interface RefundFormProps {
  /** Věta popisující, co se přesně stane. Musí obsahovat částku. */
  consequence: string;
  /** Text u potvrzovacího zaškrtnutí. */
  confirmLabel: string;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  defaultReason?: RefundReason;
  onSubmit: (values: RefundSubmit) => void;
  onCancel?: () => void;
}

export function RefundForm({
  consequence,
  confirmLabel,
  submitLabel,
  busy = false,
  error,
  defaultReason = 'customer_request',
  onSubmit,
  onCancel,
}: RefundFormProps) {
  const reasonId = useId();
  const noteId = useId();
  const [reason, setReason] = useState<RefundReason>(defaultReason);
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{consequence}</p>

      <div>
        <label htmlFor={reasonId} className="mb-1 block text-xs font-medium">
          Důvod
        </label>
        <select
          id={reasonId}
          value={reason}
          onChange={(e) => setReason(e.target.value as RefundReason)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          {(Object.keys(REFUND_REASON_LABELS) as RefundReason[]).map((r) => (
            <option key={r} value={r}>
              {REFUND_REASON_LABELS[r]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={noteId} className="mb-1 block text-xs font-medium">
          Poznámka do audit logu (volitelné)
        </label>
        <Input
          id={noteId}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Např. zákazník volal, nemůže dorazit"
          maxLength={500}
        />
      </div>

      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5"
        />
        <span>{confirmLabel}</span>
      </label>

      {error ? (
        <p className="rounded-md border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button
          variant="destructive"
          disabled={busy || !confirmed}
          onClick={() => onSubmit({ reason, note: note || undefined })}
        >
          {busy ? 'Vracím…' : submitLabel}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Zrušit
          </Button>
        ) : null}
      </div>
    </div>
  );
}

interface RefundDialogProps extends RefundFormProps {
  title: string;
  onCancel: () => void;
}

/** Tentýž formulář v modálním okně — pro seznam objednávek. */
export function RefundDialog({ title, onCancel, ...formProps }: RefundDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="w-full max-w-md rounded-lg border bg-card p-5 shadow-lg outline-none"
      >
        <h2 className="mb-3 text-lg font-semibold">{title}</h2>
        <RefundForm {...formProps} onCancel={onCancel} />
      </div>
    </div>
  );
}
