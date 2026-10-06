'use client';

import { useEffect, useRef, useState } from 'react';
import { Settings, LogOut, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { NotificationsBell } from './NotificationsBell';

interface TopbarProps {
  title: string;
  subtitle?: string;
}

interface UserData {
  email: string;
  name: string | null;
}

export function Topbar({ title, subtitle }: TopbarProps) {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) return;
    // Decode payload (no signature verification — UI only)
    try {
      const part = token.split('.')[1];
      if (!part) return;
      const payload = JSON.parse(atob(part)) as { email?: string; name?: string };
      setUser({
        email: payload.email ?? 'unknown',
        name: payload.name ?? null,
      });
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (!open) return undefined;
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    localStorage.removeItem('accessToken');
    document.cookie = 'accessToken=; path=/; max-age=0; samesite=lax';
    router.push('/cs/login');
  }

  const initial = (user?.name ?? user?.email ?? '?').slice(0, 1).toUpperCase();

  return (
    <header className="flex h-16 items-center justify-between border-b bg-card pl-16 pr-4 md:px-6">
      <div>
        {/* Kolo 12: ne <h1> — hlavní nadpis má každá stránka (PageHeader) */}
        <p className="text-lg font-semibold">{title}</p>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3">
        <NotificationsBell />

        <div ref={ref} className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 rounded-md p-1 hover:bg-secondary"
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-medium text-brand-700">
              {initial}
            </div>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>

          {open ? (
            <div className="absolute right-0 mt-1 w-56 rounded-md border bg-card shadow-lg">
              {user ? (
                <div className="border-b px-3 py-2 text-xs">
                  <div className="font-medium">{user.name ?? '—'}</div>
                  <div className="text-muted-foreground">{user.email}</div>
                </div>
              ) : null}
              <Link
                href="/admin/settings"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
              >
                <Settings className="h-3.5 w-3.5" />
                Nastavení
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50"
              >
                <LogOut className="h-3.5 w-3.5" />
                Odhlásit
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
