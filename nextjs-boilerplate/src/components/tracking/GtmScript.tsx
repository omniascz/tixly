'use client';

/**
 * Google Tag Manager head + body injection.
 * Receives containerId server-side (from promoter creds), renders client-side.
 * Format: GTM-XXXXXXX
 */

import Script from 'next/script';

interface Props {
  containerId: string;
}

export function GtmHeadScript({ containerId }: Props) {
  if (!containerId || !/^GTM-[A-Z0-9]+$/i.test(containerId)) return null;
  return (
    <Script
      id={`gtm-head-${containerId}`}
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{
        __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${containerId}');`,
      }}
    />
  );
}

export function GtmNoScript({ containerId }: Props) {
  if (!containerId || !/^GTM-[A-Z0-9]+$/i.test(containerId)) return null;
  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${containerId}`}
        height="0"
        width="0"
        style={{ display: 'none', visibility: 'hidden' }}
      />
    </noscript>
  );
}

/** Push event to GTM dataLayer (safe — noop if GTM not loaded). */
export function gtmPush(event: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((window as any).dataLayer = (window as any).dataLayer ?? []).push(event);
}
