import { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { InstallPrompt } from '@/components/InstallPrompt';
import { PushOptInPrompt } from '@/components/PushOptInPrompt';
import { ServiceWorkerRegistrar } from '@/components/ServiceWorkerRegistrar';
import { SkipToContent } from '@/components/SkipToContent';
import { WebVitalsReporter } from '@/components/WebVitalsReporter';
import { WhiteLabelTheme } from '@/components/WhiteLabelTheme';
import { Providers } from './providers';
import './globals.css';

const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Tixly',
  description: 'Tvoje vstupenky kdykoliv, kdekoliv. Nákup, správa, scan offline.',
  manifest: '/manifest.json',
  applicationName: 'Tixly',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Tixly',
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icon-192.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#6C47FF',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="cs" className={inter.variable} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://www.google-analytics.com" />
        <link rel="dns-prefetch" href="https://connect.facebook.net" />
        <meta name="mobile-web-app-capable" content="yes" />
        <WhiteLabelTheme />
      </head>
      <body className="font-sans antialiased">
        <SkipToContent />
        <Providers>{children}</Providers>
        <ServiceWorkerRegistrar />
        <InstallPrompt />
        <PushOptInPrompt />
        <WebVitalsReporter />
      </body>
    </html>
  );
}
