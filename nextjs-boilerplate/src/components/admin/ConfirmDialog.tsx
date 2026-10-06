'use client';

/**
 * Kolo 12 — potvrzení nevratných / dopadových akcí v okně aplikace (místo window.confirm / window.prompt).
 *
 * Říká, CO se stane (důsledky v bodech), a volitelně se zeptá na doplňující údaj (např. variabilní symbol, důvod).
 * Tlačítka: „Zpět" (nic se nestane) a potvrzovací akce s konkrétním názvem („Uvolnit 5 míst", „Zrušit objednávku").
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

export interface ConfirmRequest {
  title: string;
  /** Důsledky — každá položka jeden řádek („Místa se vrátí do volného prodeje."). */
  consequences: string[];
  confirmLabel: string;
  /** Destruktivní akce (zrušení, storno) — červené tlačítko. */
  danger?: boolean;
  /** Volitelné pole (např. „Variabilní symbol platby"). */
  input?: { label: string; placeholder?: string; required?: boolean; initial?: string };
  onConfirm: (value: string) => void | Promise<void>;
}

export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }): JSX.Element | null {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setValue(request?.input?.initial ?? '');
    setBusy(false);
    if (request && !request.input) setTimeout(() => confirmRef.current?.focus(), 0);
  }, [request]);
  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, onClose]);
  if (!request) return null;
  const disabled = busy || (request.input?.required === true && value.trim() === '');
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" onClick={onClose}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        data-testid="confirm-dialog"
        className="w-full max-w-md rounded-lg bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="text-lg font-semibold">{request.title}</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {request.consequences.map((c) => <li key={c}>{c}</li>)}
        </ul>
        {request.input ? (
          <label className="mt-4 block text-sm font-medium">
            {request.input.label}
            <input
              autoFocus
              className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder={request.input.placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Zpět</Button>
          <Button
            ref={confirmRef}
            type="button"
            variant={request.danger ? 'destructive' : 'default'}
            disabled={disabled}
            onClick={async () => {
              setBusy(true);
              try { await request.onConfirm(value.trim()); } finally { onClose(); }
            }}
          >
            {request.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
