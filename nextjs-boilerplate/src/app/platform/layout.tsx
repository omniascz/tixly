import { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { PlatformSidebar } from '@/components/platform/PlatformSidebar';
import { getServerRoles } from '@/lib/server-session';

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  // Defense in depth vedle middleware: /platform je JEN pro super admina (provozovatele).
  const roles = await getServerRoles();
  if (!roles) redirect('/cs/login?from=/platform');
  if (!roles.isPlatformAdmin) redirect(roles.hasPromoter ? '/admin' : '/cs/events');

  return (
    <div className="flex min-h-screen bg-background">
      <PlatformSidebar />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
