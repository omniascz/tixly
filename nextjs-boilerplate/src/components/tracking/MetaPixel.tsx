'use client';

/**
 * Per-promoter Meta Pixel. Inicializuje fbq daným pixel ID, odpálí PageView
 * a volitelně jednu standardní událost (ViewContent / InitiateCheckout /
 * Purchase …) hned v init snippetu — díky tomu je pořadí garantované
 * (init → PageView → event) bez race s načítáním fbevents.js.
 *
 * Pixel ID je per-promotér (platform.promoters.meta_pixel_id), takže pixel
 * se inicializuje jen na stránkách patřících konkrétnímu promotérovi
 * (detail akce, checkout, potvrzení objednávky) — ne globálně v root layoutu.
 *
 * Dynamické události v event handlerech (AddPaymentInfo před redirectem,
 * AddToCart po holdu) volej přes fbqTrack() z '@/lib/tracking/fbq'.
 */

import Script from 'next/script';

// Inline JSON do <script> — JSON.stringify NEescapuje '<' ani line/paragraph
// separators (U+2028/U+2029), takže volný text by mohl rozbít blok / způsobit
// XSS. Escapujeme na bezpečné \uXXXX sekvence. Character class stavíme přes
// fromCharCode, ať ve zdroji nejsou neviditelné znaky.
const LINE_SEPS = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(LINE_SEPS, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

const BASE_SNIPPET =
  "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?" +
  "n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;" +
  "n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;" +
  "t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}" +
  "(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');";

export interface MetaPixelProps {
  pixelId: string | null | undefined;
  /** Standardní událost odpálená jednou hned po PageView (volitelné). */
  event?: 'ViewContent' | 'InitiateCheckout' | 'Purchase' | 'AddToCart';
  eventData?: Record<string, unknown>;
  /** Dedup klíč proti server-side CAPI události (typicky orderId / holdToken). */
  eventId?: string;
}

export function MetaPixel({ pixelId, event, eventData, eventId }: MetaPixelProps) {
  // Pixel ID = jen číslice (validováno i na serveru). Brání injektáži do <script>.
  if (!pixelId || !/^\d{5,20}$/.test(pixelId)) return null;

  const eventLine = event
    ? `fbq('track', ${safeJson(event)}, ${safeJson(eventData ?? {})}` +
      (eventId ? `, {eventID: ${safeJson(eventId)}}` : '') +
      ');'
    : '';

  return (
    <Script id="tixly-meta-pixel" strategy="afterInteractive">
      {`${BASE_SNIPPET}fbq('init', ${safeJson(pixelId)});fbq('track', 'PageView');${eventLine}`}
    </Script>
  );
}
