import { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Sidebar } from '@/components/admin/Sidebar';
import { Topbar } from '@/components/admin/Topbar';
import { getServerRoles } from '@/lib/server-session';

export const metadata: Metadata = {
  manifest: '/admin-manifest.json',
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Defense in depth vedle middleware: /admin je JEN pro promotéra se členstvím.
  const roles = await getServerRoles();
  if (!roles) redirect('/cs/login?from=/admin');
  if (!roles.hasPromoter) redirect(roles.isPlatformAdmin ? '/platform' : '/cs/events');

  // Kolo 12: srozumitelný popisek role (dřív „Tixly Admin / Promotér")
  const roleLabel = roles.promoterRole === 'staff' ? 'Provoz a vstup' : roles.promoterRole === 'box_office' ? 'Pokladna' : 'Pořadatel';

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar promoterRole={roles.promoterRole} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title="Administrace" subtitle={roleLabel} />
        <main className="flex-1 overflow-y-auto p-3 md:p-6">{children}</main>
      </div>
    </div>
  );
}
