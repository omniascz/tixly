'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface AuthState {
  user: { id: string; email: string; name: string } | null;
  isPlatformAdmin: boolean;
  hasPromoterMembership: boolean;
}

export function TopNav({ locale }: { locale: string }) {
  const router = useRouter();
  const [auth, setAuth] = useState<AuthState | null>(null);

  useEffect(() => {
    // Načti REÁLNÝ stav session z /api/auth/me (ověří accessToken cookie),
    // ne ze stale localStorage. Tím je hlavička vždy v souladu s realitou.
    let cancelled = false;
    const loggedOut = { user: null, isPlatformAdmin: false, hasPromoterMembership: false };
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data: { user: AuthState['user']; roles?: { isPlatformAdmin?: boolean; promoterMemberships?: unknown[] } }) => {
        if (cancelled) return;
        if (!data?.user) {
          setAuth(loggedOut);
          return;
        }
        setAuth({
          user: data.user,
          isPlatformAdmin: !!data.roles?.isPlatformAdmin,
          hasPromoterMembership:
            Array.isArray(data.roles?.promoterMemberships) && data.roles.promoterMemberships.length > 0,
        });
      })
      .catch(() => {
        if (!cancelled) setAuth(loggedOut);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Pokračujeme i když API selhalo — vyčistíme stav každopádně.
    }
    // Vyčisti i případné staré localStorage (zpětná kompatibilita) + aktualizuj hlavičku.
    localStorage.removeItem('accessToken');
    localStorage.removeItem('user');
    localStorage.removeItem('roles');
    setAuth({ user: null, isPlatformAdmin: false, hasPromoterMembership: false });
    router.push(`/${locale}/events`);
    router.refresh();
  }

  // Před hydratací (auth=null) renderujeme neutrální stav, ať nebliká SSR vs client.
  if (auth === null) {
    return (
      <nav className="flex items-center gap-4 text-sm">
        <Link href={`/${locale}/events`}>Akce</Link>
      </nav>
    );
  }

  return (
    <nav className="flex items-center gap-4 text-sm">
      <Link href={`/${locale}/events`}>Akce</Link>

      {auth.user ? (
        <>
          <Link href={`/${locale}/my-tickets`} className="text-muted-foreground">
            Moje vstupenky
          </Link>
          {auth.isPlatformAdmin && (
            <Link href="/platform" className="font-medium text-primary">
              🛡 Master admin
            </Link>
          )}
          {auth.hasPromoterMembership && (
            <Link href="/admin" className="font-medium text-primary">
              Admin
            </Link>
          )}
          <span className="text-muted-foreground">
            {auth.user.name}
          </span>
          <button
            onClick={logout}
            className="text-muted-foreground hover:text-foreground"
            type="button"
          >
            Odhlásit
          </button>
        </>
      ) : (
        <>
          <Link href={`/${locale}/pricing`} className="text-muted-foreground">
            Ceník
          </Link>
          <Link href={`/${locale}/login`}>Přihlásit</Link>
          <Link
            href={`/${locale}/register-promoter`}
            className="text-muted-foreground"
          >
            Pro promotéry
          </Link>
        </>
      )}
    </nav>
  );
}
