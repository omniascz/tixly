'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { startAuthentication } from '@simplewebauthn/browser';

interface Props {
  email?: string;
  locale?: string;
  next?: string;
}

export function PasskeyButton({ email, locale = 'cs', next }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePasskey() {
    setLoading(true);
    setError(null);
    try {
      // 1. Získej authentication options ze serveru
      const optUrl = email
        ? `/api/buyer/passkeys/authenticate?email=${encodeURIComponent(email)}`
        : '/api/buyer/passkeys/authenticate';

      const optRes = await fetch(optUrl);
      if (!optRes.ok) {
        setError('Nepodařilo se načíst challenge.');
        return;
      }
      const { challengeId, publicKeyOptions } = await optRes.json() as {
        challengeId: string;
        publicKeyOptions: Parameters<typeof startAuthentication>[0];
      };

      // 2. Spusť WebAuthn dialog
      let credential;
      try {
        credential = await startAuthentication(publicKeyOptions);
      } catch {
        setError('Přihlášení passkey bylo zrušeno nebo se nezdařilo.');
        return;
      }

      // 3. Ověř na serveru
      const verifyRes = await fetch('/api/buyer/passkeys/authenticate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ challengeId, credential }),
      });

      if (!verifyRes.ok) {
        const err = await verifyRes.json().catch(() => ({})) as { error?: string };
        setError(err.error === 'COUNTER_REPLAY'
          ? 'Bezpečnostní chyba: passkey mohl být zkopírován.'
          : 'Passkey ověření selhalo.');
        return;
      }

      const data = await verifyRes.json() as {
        accessToken: string;
        user: unknown;
        roles: { isPlatformAdmin?: boolean; promoterMemberships?: unknown[] };
      };

      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('roles', JSON.stringify(data.roles));

      let target = next ?? null;
      if (!target) {
        if (data.roles?.isPlatformAdmin) target = '/platform';
        else if ((data.roles?.promoterMemberships?.length ?? 0) > 0) target = '/admin';
        else target = `/${locale}/events`;
      }
      router.push(target);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={handlePasskey}
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-muted transition-colors disabled:opacity-50"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
        </svg>
        {loading ? '...' : 'Přihlásit passkey'}
      </button>
      {error && <p className="text-xs text-destructive text-center">{error}</p>}
    </div>
  );
}
