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
  Plus,
  Code2,
  FileSignature,
  Clapperboard,
  Trophy,
  HeartHandshake,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Viditelné i pro roli 'staff' (produkce/personál). Bez flagu = jen owner/manager. */
  staffAllowed?: boolean;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    label: 'Akce',
    items: [
      { href: '/admin/events/new', label: 'Nová akce', icon: Plus },
      { href: '/admin/events', label: 'Akce', icon: CalendarDays, staffAllowed: true },
      { href: '/admin/films', label: 'Filmový katalog', icon: Clapperboard },
      { href: '/admin/sport-teams', label: 'Sportovní týmy', icon: Trophy },
      { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, staffAllowed: true },
    ],
  },
  {
    label: 'Prodej',
    items: [
      { href: '/admin/orders', label: 'Objednávky', icon: ShoppingCart, staffAllowed: true },
      { href: '/admin/customers', label: 'Zákazníci', icon: Users },
      { href: '/admin/pos', label: 'Pokladna (POS)', icon: Banknote, staffAllowed: true },
      { href: '/admin/scanner', label: 'Scanner', icon: ScanLine, staffAllowed: true },
      { href: '/admin/event-groups', label: 'Event Groups', icon: Layers },
      { href: '/admin/productions', label: 'Produkce / reprízy', icon: Repeat },
      { href: '/admin/embed', label: 'Embed na web', icon: Code2 },
      { href: '/admin/subscriptions', label: 'Abonentky', icon: TrendingUp },
      { href: '/admin/season-passes', label: 'Sezónní pasy', icon: TrendingUp },
      { href: '/admin/season', label: 'Sezónní přehled', icon: TrendingUp },
    ],
  },
  {
    label: 'Přehled & analytika',
    items: [
      { href: '/admin/dashboard/live', label: 'Live prodej', icon: TrendingUp, staffAllowed: true },
      { href: '/admin/pricemaster', label: 'Pricemaster', icon: TrendingUp },
    ],
  },
  {
    label: 'Setup',
    items: [
      { href: '/admin/staff', label: 'Personál', icon: UserCog },
      { href: '/admin/settings', label: 'Nastavení', icon: Settings },
      { href: '/admin/documents', label: 'Dokumenty (QES)', icon: FileSignature },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/admin/payouts', label: 'Výplaty', icon: Wallet },
      { href: '/admin/artist-payouts', label: 'Výplaty umělců', icon: Banknote },
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
      { href: '/admin/brand-connect', label: 'Brand Connect', icon: HeartHandshake },
    ],
  },
  {
    label: 'Partneři',
    items: [
      { href: '/admin/resellers', label: 'Partnerská síť', icon: Banknote },
      { href: '/admin/partner-applications', label: 'Affiliate žádosti', icon: Banknote },
      { href: '/admin/social-shop', label: 'Social Shop katalogy', icon: Megaphone },
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

export function Sidebar({ promoterRole }: { promoterRole?: string | null }) {
  const pathname = usePathname();
  const isStaff = promoterRole === 'staff';

  // Role 'staff' (produkce/personál u dveří/pokladny) vidí JEN operativní položky —
  // ne finance, marketing, integrace ani audit. Owner/manager vidí vše.
  const visibleSections = isStaff
    ? sections
        .map((s) => ({ ...s, items: s.items.filter((i) => i.staffAllowed) }))
        .filter((s) => s.items.length > 0)
    : sections;

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

      {isStaff ? (
        <div className="mx-3 mt-3 rounded-md bg-indigo-50 px-3 py-1.5 text-[11px] font-medium text-indigo-900">
          Produkční přístup — finanční a nastavovací sekce skryté
        </div>
      ) : null}

      <nav className="flex-1 overflow-y-auto p-3">
        {visibleSections.map((section, idx) => (
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
