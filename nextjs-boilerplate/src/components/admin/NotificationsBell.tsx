'use client';

import { useEffect, useState, type JSX } from 'react';
import { Bell } from 'lucide-react';
import Link from 'next/link';

function authFetch(url: string): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

export function NotificationsBell(): JSX.Element {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function poll(): Promise<void> {
      try {
        const r = await authFetch('/api/admin/notifications?unread=1&limit=1');
        if (!r.ok || cancelled) return;
        const data = (await r.json()) as { unreadCount: number };
        setCount(data.unreadCount ?? 0);
      } catch {
        // network blip — silent
      }
    }

    void poll();
    const t = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <Link
      href="/admin/notifications"
      aria-label={`Notifikace: ${count} nepřečtených`}
      className="relative rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
    >
      <Bell className="h-4 w-4" />
      {count > 0 ? (
        <span
          aria-hidden
          className="absolute right-0.5 top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white"
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  );
}
