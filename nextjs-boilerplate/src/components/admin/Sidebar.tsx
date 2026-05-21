'use client';

import {
  LayoutDashboard,
  CalendarDays,
  ShoppingCart,
  Users,
  Wallet,
  Tag,
  ScanLine,
  Settings,
  Mail,
  MessageSquare,
  UserCog,
  Banknote,
  Receipt,
  Lock,
  FileSearch,
  Repeat,
  TrendingUp,
  Megaphone,
  AlertOctagon,
  Bell,
  Webhook,
  Gift,
  Layers,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    label: 'Přehled',
    items: [
      { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/admin/dashboard/live', label: 'Live prodej', icon: TrendingUp },
      { href: '/admin/pricemaster', label: 'Pricemaster', icon: TrendingUp },
    ],
  },
  {
    label: 'Setup',
    items: [
      { href: '/admin/staff', label: 'Personál', icon: UserCog },
      { href: '/admin/settings', label: 'Nastavení', icon: Settings },
    ],
  },
  {
    label: 'Prodej',
    items: [
      { href: '/admin/events', label: 'Akce', icon: CalendarDays },
      { href: '/admin/event-groups', label: 'Event Groups', icon: Layers },
      { href: '/admin/subscriptions', label: 'Abonentky', icon: TrendingUp },
      { href: '/admin/season', label: 'Sezónní přehled', icon: TrendingUp },
      { href: '/admin/orders', label: 'Objednávky', icon: ShoppingCart },
      { href: '/admin/customers', label: 'Zákazníci', icon: Users },
      { href: '/admin/pos', label: 'Pokladna (POS)', icon: Banknote },
      { href: '/admin/scanner', label: 'Scanner', icon: ScanLine },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/admin/payouts', label: 'Výplaty', icon: Wallet },
      { href: '/admin/invoices', label: 'Faktury', icon: Receipt },
      { href: '/admin/bank-transfers', label: 'Bank výpisy', icon: Banknote },
    ],
  },
  {
    label: 'Marketing',
    items: [
      { href: '/admin/promo-codes', label: 'Promo kódy', icon: Tag },
      { href: '/admin/vouchers', label: 'Dárkové poukazy', icon: Gift },
      { href: '/admin/access-codes', label: 'Přístupové kódy', icon: Lock },
      { href: '/admin/broadcasts', label: 'Broadcasty', icon: Mail },
      { href: '/admin/sms-campaigns', label: 'SMS kampaně', icon: MessageSquare },
      { href: '/admin/email-templates', label: 'E-mail šablony', icon: Mail },
      { href: '/admin/subscription-plans', label: 'Permanentky', icon: Repeat },
      { href: '/admin/ads', label: 'Marketplace Ads', icon: Megaphone },
      { href: '/admin/collections', label: 'Kolekce', icon: Layers },
      { href: '/admin/tracking-pixels', label: 'Tracking Pixely', icon: Tag },
      { href: '/admin/event-templates', label: 'Event templates', icon: Repeat },
    ],
  },
  {
    label: 'Provoz',
    items: [
      { href: '/admin/chargebacks', label: 'Chargebacks', icon: AlertOctagon },
    ],
  },
  {
    label: 'Audit',
    items: [
      { href: '/admin/audit-log', label: 'Audit log', icon: FileSearch },
      { href: '/admin/notifications', label: 'Notifikace', icon: Bell },
    ],
  },
  {
    label: 'Integrace',
    items: [
      { href: '/admin/webhooks', label: 'Webhooks', icon: Webhook },
      { href: '/admin/oauth-apps', label: 'OAuth apps', icon: Lock },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-60 flex-col border-r bg-card">
      <div className="flex h-16 items-center border-b px-6">
        <Link href="/admin" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-500 text-white font-bold">
            T
          </div>
          <span className="text-lg font-semibold">Tixly</span>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        {sections.map((section, idx) => (
          <div key={section.label} className={idx > 0 ? 'mt-4' : ''}>
            {idx > 0 ? (
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.label}
              </div>
            ) : null}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active =
                  item.href === '/admin'
                    ? pathname === '/admin'
                    : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
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
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t p-4 text-xs text-muted-foreground">
        Promotér dashboard · v1.0
      </div>
    </aside>
  );
}
