'use client';
import {
  ShieldCheck,
  Building2,
  FileSearch,
  ScrollText,
  Webhook,
  MapPin,
  AlertOctagon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/platform', label: 'Dashboard', icon: ShieldCheck },
  { href: '/platform/promoters', label: 'Promotéři', icon: Building2 },
  { href: '/platform/venues', label: 'Sály a stadiony', icon: MapPin },
  { href: '/platform/event-moderation', label: 'Moderace akcí', icon: FileSearch },
  { href: '/platform/incidents', label: 'Incidenty', icon: AlertOctagon },
  { href: '/platform/audit-log', label: 'Audit log', icon: ScrollText },
  { href: '/platform/webhooks', label: 'Webhooks', icon: Webhook },
];

export function PlatformSidebar() {
  const path = usePathname();
  return (
    <aside className="w-56 shrink-0 border-r bg-card">
      <div className="border-b px-4 py-3">
        <div className="text-xs font-semibold uppercase text-muted-foreground">
          Tixly Platform
        </div>
        <div className="text-sm font-medium">Master Admin</div>
      </div>
      <nav className="space-y-1 p-2 text-sm">
        {items.map((it) => {
          const Icon = it.icon;
          const active = path === it.href || path.startsWith(it.href + '/');
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`flex items-center gap-2 rounded-md px-3 py-2 ${
                active ? 'bg-accent font-medium' : 'hover:bg-accent/50'
              }`}
            >
              <Icon className="h-4 w-4" /> {it.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
