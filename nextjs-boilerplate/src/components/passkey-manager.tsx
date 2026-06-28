'use client';
import { useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { Button } from '@/components/ui/button';

interface Passkey {
  id:         string;
  deviceName: string;
  isSynced:   boolean;
  lastUsedAt: string | null;
  createdAt:  string;
}

export function PasskeyManager() {
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [adding,   setAdding]   = useState(false);
  const [addMsg,   setAddMsg]   = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function fetchPasskeys() {
    setLoading(true);
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    const res = await fetch('/api/buyer/passkeys', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) {
      const data = await res.json() as { passkeys: Passkey[] };
      setPasskeys(data.passkeys);
    }
    setLoading(false);
  }

  useEffect(() => { void fetchPasskeys(); }, []);

  async function addPasskey() {
    setAdding(true);
    setAddMsg(null);
    setError(null);
    try {
      const token = localStorage.getItem('accessToken');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;

      // 1. Načti options
      const optRes = await fetch('/api/buyer/passkeys/register', { headers });
      if (!optRes.ok) { setError('Nepodařilo se načíst options.'); return; }

      const { challengeId, publicKeyOptions } = await optRes.json() as {
        challengeId: string;
        publicKeyOptions: Parameters<typeof startRegistration>[0];
      };

      // 2. Spusť registraci
      let credential;
      try {
        credential = await startRegistration(publicKeyOptions);
      } catch {
        setError('Registrace passkey byla zrušena nebo se nezdařila.');
        return;
      }

      // 3. Pošli na server
      const saveRes = await fetch('/api/buyer/passkeys/register', {
        method:  'POST',
        headers,
        body:    JSON.stringify({
          challengeId,
          credential,
          deviceName: (credential as { clientExtensionResults?: { credProps?: { rk?: boolean } } })
            .clientExtensionResults?.credProps?.rk
            ? 'Passkey (synchronized)'
            : navigator.userAgent.includes('iPhone') ? 'iPhone'
              : navigator.userAgent.includes('Android') ? 'Android'
              : 'Passkey',
        }),
      });

      if (!saveRes.ok) {
        const err = await saveRes.json().catch(() => ({})) as { error?: string };
        setError(err.error === 'CREDENTIAL_ALREADY_REGISTERED'
          ? 'Tento autentikátor je již zaregistrován.'
          : 'Registrace selhala.');
        return;
      }

      setAddMsg('Passkey byl přidán!');
      await fetchPasskeys();
    } finally {
      setAdding(false);
    }
  }

  async function removePasskey(id: string) {
    setDeleting(id);
    const token = localStorage.getItem('accessToken');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch('/api/buyer/passkeys', {
      method:  'DELETE',
      headers,
      body:    JSON.stringify({ id }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string; detail?: string };
      setError(err.detail ?? err.error ?? 'Nepodařilo se smazat passkey.');
    } else {
      await fetchPasskeys();
    }
    setDeleting(null);
  }

  if (loading) return <p className="text-sm text-muted-foreground">Načítám passkeys…</p>;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {passkeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">Žádné passkeys zatím nezaregistrovány.</p>
        ) : passkeys.map((pk) => (
          <div key={pk.id} className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2">
            <div>
              <p className="text-sm font-medium">{pk.deviceName}</p>
              <p className="text-xs text-muted-foreground">
                {pk.isSynced ? 'Synchronizovaný (cloud)' : 'Pouze toto zařízení'}
                {pk.lastUsedAt && ` · naposledy ${new Date(pk.lastUsedAt).toLocaleDateString('cs-CZ')}`}
              </p>
            </div>
            <button
              type="button"
              disabled={deleting === pk.id}
              onClick={() => removePasskey(pk.id)}
              className="text-xs text-destructive hover:underline disabled:opacity-50"
            >
              {deleting === pk.id ? '…' : 'Odebrat'}
            </button>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {addMsg && <p className="text-sm text-green-600">{addMsg}</p>}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={adding}
        onClick={addPasskey}
      >
        {adding ? 'Přidávám…' : '+ Přidat passkey'}
      </Button>
    </div>
  );
}
