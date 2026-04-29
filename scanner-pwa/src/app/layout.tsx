import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Tixly Scanner',
  description: 'Offline PWA pro skenování vstupenek',
};

export const viewport: Viewport = {
  themeColor: '#6C47FF',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="cs">
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#6C47FF" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body style={{ margin: 0, background: '#000', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function () {
                  navigator.serviceWorker.register('/sw.js').catch(function (err) {
                    console.error('SW registration failed', err);
                  });
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
