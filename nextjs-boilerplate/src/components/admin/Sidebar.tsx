'use client';

import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  CalendarDays,
  ShoppingCart,
  Users,
  Banknote,
  ScanLine,
  Megaphone,
  HeartHandshake,
  Wallet,
  MapPin,
  UserCog,
  Settings,
  LayoutGrid,
  Clapperboard,
  Menu,
  X,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ORG_NAV_ALL,
  isOrgItemActive,
  orgNavForRole,
  type OrgIconName,
  type OrgNavItem,
} from '@/lib/admin/nav';
import { cn } from '@/lib/utils';

/**
 * Levé menu.
 *
 * Dřív 49 položek v 11 sekcích, přesto 26 hotových stránek admina nebylo
 * dosažitelných odnikud. Teď dvanáct položek podle toho, co uživatel dělá,
 * a poslední položka „Vše" je rozcestník se všemi funkcemi včetně těch,
 * na které dřív nevedl odkaz.
 *
 * Struktura navigace žije v lib/admin/nav.ts, ne tady.
 */

const ICONS: Record<OrgIconName, LucideIcon> = {
  LayoutDashboard,
  CalendarDays,
  ShoppingCart,
  Users,
  Banknote,
  ScanLine,
  Megaphone,
  HeartHandshake,
  Wallet,
  MapPin,
  UserCog,
  Settings,
  LayoutGrid,
  Clapperboard,
};

export function Sidebar({ promoterRole }: { promoterRole?: string | null }) {
  const pathname = usePathname();
  const isStaff = promoterRole === 'staff' || promoterRole === 'box_office';
  const items = orgNavForRole(promoterRole);
  // Kolo 12: na mobilu (obsluha vstupu, pokladna) menu nezabírá 240 px z obrazovky — otevírá se tlačítkem „Menu".
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <>
    <button
      type="button"
      aria-label="Menu"
      aria-expanded={open}
      onClick={() => setOpen((o) => !o)}
      className="absolute left-3 top-3 z-50 flex h-10 w-10 items-center justify-center rounded-md border bg-card shadow-sm md:hidden"
    >
      {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
    </button>
    {open ? <div className="fixed inset-0 z-30 bg-black/40 md:hidden" aria-hidden onClick={() => setOpen(false)} /> : null}
    <aside className={cn('h-screen w-60 flex-col border-r bg-card', open ? 'fixed inset-y-0 left-0 z-40 flex' : 'hidden md:flex')}>
      <div className="flex h-16 items-center border-b px-6">
        <Link href="/admin" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-500 font-bold text-white">
            T
          </div>
          <span className="text-lg font-semibold">Tixly</span>
        </Link>
      </div>

      {isStaff ? (
        <p className="mx-3 mt-3 rounded-md bg-secondary px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
          {promoterRole === 'box_office' ? 'Přístup pokladny' : 'Přístup pro provoz a vstup'} — finance a nastavení jsou skryté
        </p>
      ) : (
        <div className="px-3 pt-3">
          <Link
            href="/admin/events/new"
            className="flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Nová akce
          </Link>
        </div>
      )}

      <nav aria-label="Hlavní navigace" className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {items.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}

        <div className="!mt-3 border-t pt-3">
          <NavLink item={ORG_NAV_ALL} pathname={pathname} />
        </div>
      </nav>

      <p className="border-t p-4 text-xs text-muted-foreground">Administrace pořadatele</p>
    </aside>
    </>
  );
}

function NavLink({ item, pathname }: { item: OrgNavItem; pathname: string }) {
  const Icon = ICONS[item.icon];
  const active = isOrgItemActive(item, pathname);

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {item.label}
    </Link>
  );
}
