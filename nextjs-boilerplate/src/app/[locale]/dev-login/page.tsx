'use client';

/**
 * Dev quick-login — bez ručního zadávání hesla.
 *
 * URLs:
 *   /cs/dev-login?as=platform   → superadmin@tixly.cz, redirect na /platform
 *   /cs/dev-login?as=admin      → verze@divadlovceletne.cz, redirect na /admin
 *
 * Vrátí 404 v produkci (NODE_ENV === 'production'). V dev mode automaticky
 * volá /api/auth/login s pevně danými demo credentials, uloží JWT do cookie
 * + localStorage a redirectne.
 */

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface LoginResponse {
  accessToken: string;
  user: unknown;
  roles: unknown;
}

const CREDENTIALS: Record<string, { email: string; password: string; redirect: string }> = {
  platform: {
    email: 'superadmin@tixly.cz',
    password: 'Demo2026!',
    redirect: '/platform',
  },
  admin: {
    email: 'verze@divadlovceletne.cz',
    password: 'Demo2026!',
    redirect: '/admin',
  },
};

export default function DevLoginPage(): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState('Přihlašuji...');

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      setStatus('Nedostupné v produkci.');
      return;
    }
    const as = params.get('as') ?? 'admin';
    const creds = CREDENTIALS[as];
    if (!creds) {
      setStatus('Neznámé "as": použij ?as=platform nebo ?as=admin');
      return;
    }

    void (async () => {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: creds.email, password: creds.password }),
        });
        if (!res.ok) {
          setStatus(`Login selhal: HTTP ${res.status}`);
          return;
        }
        const data = (await res.json()) as LoginResponse;
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('user', JSON.stringify(data.user));
        localStorage.setItem('roles', JSON.stringify(data.roles));
        setStatus(`Přihlášen jako ${creds.email} → přesměrování...`);
        router.push(creds.redirect);
        router.refresh();
      } catch (err) {
        setStatus(`Síťová chyba: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }, [params, router]);

  return (
    <div className="mx-auto mt-12 max-w-md px-4 text-center">
      <h1 className="text-2xl font-bold">Dev login</h1>
      <p className="mt-4 text-sm text-muted-foreground">{status}</p>
      <div className="mt-8 space-y-2 text-left text-xs text-muted-foreground">
        <p><strong>Použití (jen dev mode):</strong></p>
        <ul className="list-disc pl-5 space-y-1">
          <li><code>/cs/dev-login?as=platform</code> — Master admin (superadmin@tixly.cz)</li>
          <li><code>/cs/dev-login?as=admin</code> — Promotér (Divadlo Verze)</li>
        </ul>
      </div>
    </div>
  );
}
