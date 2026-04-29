import { ReactNode } from 'react';
import { PlatformSidebar } from '@/components/platform/PlatformSidebar';

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <PlatformSidebar />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
