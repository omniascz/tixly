import { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/admin/Sidebar';
import { Topbar } from '@/components/admin/Topbar';
import { getServerRoles } from '@/lib/server-session';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Defense in depth vedle middleware: /admin je JEN pro promotéra se členstvím.
  const roles = await getServerRoles();
  if (!roles) redirect('/cs/login?from=/admin');
  if (!roles.hasPromoter) redirect(roles.isPlatformAdmin ? '/platform' : '/cs/events');

  const isStaff = roles.promoterRole === 'staff';

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar promoterRole={roles.promoterRole} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title="Tixly Admin" subtitle={isStaff ? 'Produkce / personál' : 'Promotér'} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
