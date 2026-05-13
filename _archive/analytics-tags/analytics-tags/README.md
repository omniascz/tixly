# @tixly/analytics-tags

Client-side helper module for GA4 + Meta Pixel + GTM tag wiring.

## Environment variables

```
NEXT_PUBLIC_GA4_MEASUREMENT_ID=G-XXXXXXXXXX
NEXT_PUBLIC_META_PIXEL_ID=1234567890
NEXT_PUBLIC_GTM_CONTAINER_ID=GTM-XXXXXXX
NEXT_PUBLIC_REQUIRE_CONSENT=true
NEXT_PUBLIC_TRACKING_DEBUG=false
```

When `GTM_CONTAINER_ID` is set, the GA4 direct snippet is skipped (GTM should
load GA4 via its own container).

## Usage

### 1. Inject scripts in your root layout

```tsx
// app/layout.tsx
import { AnalyticsScripts } from '@tixly/analytics-tags';
import { cookies } from 'next/headers';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const consentGiven = cookies().get('cookie-consent')?.value === 'accepted';
  return (
    <html lang="cs">
      <head>
        <AnalyticsScripts consentGiven={consentGiven} />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

### 2. Track events from client components

```tsx
'use client';
import { trackEvent } from '@tixly/analytics-tags';

export function BuyButton({ pkg }: { pkg: Package }) {
  return (
    <button
      onClick={() => {
        trackEvent('begin_checkout', {
          value: pkg.price,
          currency: 'CZK',
          items: [{ id: pkg.id, name: pkg.name, price: pkg.price, quantity: 1 }],
        });
      }}
    >
      Koupit
    </button>
  );
}
```

The helper is SSR-safe (no-ops when `window` is undefined) and routes events to
both GA4 (`gtag`) and Meta Pixel (`fbq`) with automatic name mapping.

## Standard events

`page_view`, `view_item`, `add_to_cart`, `begin_checkout`, `purchase`,
`sign_up`, `login`, `lead`, `reservation_created`, `reservation_cancelled`,
`package_purchased`.
