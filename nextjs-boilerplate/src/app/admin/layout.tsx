import { ReactNode } from 'react';
import { Sidebar } from '@/components/admin/Sidebar';
import { Topbar } from '@/components/admin/Topbar';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title="Tixly Admin" subtitle="Promotér" />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
