import { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ServiceWorkerRegistrar } from '@/components/ServiceWorkerRegistrar';
import { SkipToContent } from '@/components/SkipToContent';
import { WebVitalsReporter } from '@/components/WebVitalsReporter';
import { Providers } from './providers';
import './globals.css';

const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Tixly Admin',
  description: 'Promotér dashboard pro správu akcí, prodejů a výplat',
  manifest: '/manifest.json',
  themeColor: '#6C47FF',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="cs" className={inter.variable} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://www.google-analytics.com" />
        <link rel="dns-prefetch" href="https://connect.facebook.net" />
      </head>
      <body className="font-sans antialiased">
        <SkipToContent />
        <Providers>{children}</Providers>
        <ServiceWorkerRegistrar />
        <WebVitalsReporter />
      </body>
    </html>
  );
}
