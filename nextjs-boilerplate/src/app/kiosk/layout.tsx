import type { ReactNode } from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Tixly Kiosk',
  robots: { index: false },
};

export default function KioskLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="cs">
      <body className="bg-gray-950 text-white antialiased overflow-hidden">
        {children}
      </body>
    </html>
  );
}
