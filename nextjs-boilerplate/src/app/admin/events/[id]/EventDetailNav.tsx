'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  group: string;
}

export function EventDetailNav({ eventId }: { eventId: string }): JSX.Element {
  const pathname = usePathname();

  const items: NavItem[] = [
    // Základ
    { href: `/admin/events/${eventId}/edit`, label: 'Editovat', group: 'Základ' },
    { href: `/admin/events/${eventId}/settings`, label: 'Nastavení', group: 'Základ' },
    { href: `/admin/events/${eventId}/ai-description`, label: 'AI popis', group: 'Základ' },
    { href: `/admin/events/${eventId}/embed`, label: 'Embed', group: 'Základ' },
    { href: `/admin/events/${eventId}/cast`, label: 'Obsazení', group: 'Základ' },

    // Tickety + Sedadla
    { href: `/admin/events/${eventId}/tickets`, label: 'Lístky', group: 'Lístky' },
    { href: `/admin/events/${eventId}/holds`, label: 'Holds', group: 'Lístky' },
    { href: `/admin/events/${eventId}/view-photos`, label: 'Pohled ze sedadla', group: 'Lístky' },
    { href: `/admin/events/${eventId}/custom-fields`, label: 'Doplňkové otázky', group: 'Lístky' },
    { href: `/admin/events/${eventId}/accreditation`, label: 'Akreditace', group: 'Lístky' },
    { href: `/admin/events/${eventId}/press`, label: 'Press akreditace', group: 'Lístky' },
    { href: `/admin/events/${eventId}/guestlist`, label: 'Guestlist', group: 'Lístky' },
    { href: `/admin/events/${eventId}/wristbands`, label: 'Náramky', group: 'Lístky' },
    { href: `/admin/events/${eventId}/access-matrix`, label: 'Access matrix', group: 'Lístky' },

    // Pricing
    { href: `/admin/events/${eventId}/dynamic-pricing`, label: 'Dynamic pricing', group: 'Pricing' },
    { href: `/admin/events/${eventId}/member-pricing`, label: 'Member pricing', group: 'Pricing' },
    { href: `/admin/events/${eventId}/channel-prices`, label: 'Channel prices', group: 'Pricing' },
    { href: `/admin/events/${eventId}/pricing-windows`, label: 'Pricing windows', group: 'Pricing' },
    { href: `/admin/events/${eventId}/ab-price-tests`, label: 'A/B testy', group: 'Pricing' },
    { href: `/admin/events/${eventId}/price-scenarios`, label: 'Price scenarios', group: 'Pricing' },
    { href: `/admin/events/${eventId}/volume-discounts`, label: 'Množ. slevy', group: 'Pricing' },
    { href: `/admin/events/${eventId}/group-discounts`, label: 'Group discounts', group: 'Pricing' },

    // Marketing
    { href: `/admin/events/${eventId}/broadcast`, label: 'Broadcast', group: 'Marketing' },
    { href: `/admin/events/${eventId}/verified-fan`, label: 'Verified Fan', group: 'Marketing' },
    { href: `/admin/events/${eventId}/addons`, label: 'Add-ons', group: 'Marketing' },
    { href: `/admin/events/${eventId}/program`, label: 'Digitální program', group: 'Marketing' },
    { href: `/admin/events/${eventId}/donation`, label: 'Donation', group: 'Marketing' },
    { href: `/admin/events/${eventId}/lotteries`, label: 'Lotterie', group: 'Marketing' },
    { href: `/admin/events/${eventId}/marketing-qr`, label: 'Print QR', group: 'Marketing' },
    { href: `/admin/events/${eventId}/publish-facebook`, label: 'Publikovat na FB', group: 'Marketing' },
    { href: `/admin/events/${eventId}/transit-combo`, label: 'MHD Kombi', group: 'Marketing' },
    { href: `/admin/events/${eventId}/backstage`, label: 'Backstage moment', group: 'Marketing' },
    { href: `/admin/events/${eventId}/gifts`, label: 'Dárky', group: 'Marketing' },

    // Mobile / Pass
    { href: `/admin/events/${eventId}/hot-mode`, label: 'Hot mode', group: 'Mobile/Pass' },
    { href: `/admin/events/${eventId}/wallet-push`, label: 'Wallet push', group: 'Mobile/Pass' },
    { href: `/admin/events/${eventId}/wallet-modules`, label: 'Wallet content', group: 'Mobile/Pass' },

    // Lifecycle / Operations
    { href: `/admin/events/${eventId}/emergency`, label: 'Nouzové oznámení', group: 'Operations' },
    { href: `/admin/events/${eventId}/postpone`, label: 'Odložit', group: 'Operations' },
    { href: `/admin/events/${eventId}/waitlist`, label: 'Čekací listina', group: 'Operations' },
    { href: `/admin/events/${eventId}/will-call`, label: 'Will Call', group: 'Operations' },
    { href: `/admin/events/${eventId}/live-ops`, label: 'Live ops', group: 'Operations' },
    { href: `/admin/events/${eventId}/hospitality`, label: 'Hospitality', group: 'Operations' },
    { href: `/admin/events/${eventId}/foyer-menu`, label: 'Foyer menu', group: 'Operations' },
    { href: `/admin/events/${eventId}/foyer-orders`, label: 'Foyer objednávky', group: 'Operations' },

    // After-event
    { href: `/admin/events/${eventId}/reviews`, label: 'Hodnocení', group: 'After-event' },

    // Finance
    { href: `/admin/events/${eventId}/resale-policy`, label: 'Resale policy', group: 'Finance' },
    { href: `/admin/events/${eventId}/advance-payout`, label: 'Pre-event payout', group: 'Finance' },
    { href: `/admin/events/${eventId}/sales-report`, label: 'Sales report', group: 'Finance' },
  ];

  // Group items
  const groups = items.reduce<Record<string, NavItem[]>>((acc, item) => {
    acc[item.group] = acc[item.group] ?? [];
    acc[item.group].push(item);
    return acc;
  }, {});

  return (
    <div className="border-b bg-card">
      <nav className="overflow-x-auto">
        <div className="flex gap-1 px-4 py-2">
          {Object.entries(groups).map(([groupName, groupItems]) => (
            <details key={groupName} className="group/menu relative">
              <summary className={cn(
                'cursor-pointer list-none rounded-md px-3 py-1.5 text-xs font-medium hover:bg-muted',
                groupItems.some((i) => pathname === i.href) && 'bg-primary/10 text-primary',
              )}>
                {groupName} ▾
              </summary>
              <div className="absolute left-0 top-full z-50 mt-1 min-w-[200px] rounded-md border bg-card p-1 shadow-md">
                {groupItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'block rounded-md px-3 py-1.5 text-sm hover:bg-muted',
                      pathname === item.href && 'bg-primary/10 font-medium text-primary',
                    )}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </details>
          ))}
        </div>
      </nav>
    </div>
  );
}
