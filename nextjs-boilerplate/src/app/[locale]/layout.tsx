import { ReactNode } from 'react';
import Link from 'next/link';
import { CookieConsentBanner } from '@/components/public/CookieConsentBanner';
import { TopNav } from '@/components/public/TopNav';
import { SupportChatWidget } from '@/components/SupportChatWidget';
import { DirSetter } from '@/components/DirSetter';

export default function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <DirSetter locale={params.locale} />
      <header className="border-b bg-card">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Link href={`/${params.locale}`} className="text-lg font-semibold">
            Tixly
          </Link>
          <TopNav locale={params.locale} />
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8">{children}</main>
      <footer className="border-t bg-card text-xs text-muted-foreground">
        <div className="container mx-auto flex flex-wrap items-center justify-between gap-2 px-4 py-4">
          <div>© {new Date().getFullYear()} Tixly</div>
          <nav className="flex flex-wrap gap-3">
            <Link href={`/${params.locale}/about`} className="hover:underline">
              O Tixly
            </Link>
            <Link href={`/${params.locale}/contact`} className="hover:underline">
              Kontakt
            </Link>
            <Link href={`/${params.locale}/legal/terms`} className="hover:underline">
              Podmínky
            </Link>
            <Link href={`/${params.locale}/legal/privacy`} className="hover:underline">
              Soukromí
            </Link>
            <Link href={`/${params.locale}/status`} className="hover:underline">
              Stav služby
            </Link>
          </nav>
        </div>
      </footer>
      <CookieConsentBanner />
      <SupportChatWidget />
    </div>
  );
}
