import { ReactNode } from 'react';
import Link from 'next/link';
import { CookieConsentBanner } from '@/components/public/CookieConsentBanner';
import { SupportChatWidget } from '@/components/SupportChatWidget';
import { TopNav } from '@/components/public/TopNav';

export default function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-card">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Link href={`/${params.locale}/events`} className="text-lg font-semibold">
            Tixly
          </Link>
          <TopNav locale={params.locale} />
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8">{children}</main>
      <footer className="border-t bg-card text-xs text-muted-foreground">
        <div className="container mx-auto px-4 py-3">© Tixly Demo</div>
      </footer>
      <CookieConsentBanner />
      <SupportChatWidget />
    </div>
  );
}
