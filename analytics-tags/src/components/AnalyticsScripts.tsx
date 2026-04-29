// =============================================================================
// AnalyticsScripts — server component pro injekci GA4 / GTM / Meta Pixel tagů.
//
// Usage v app/layout.tsx:
//
//   import { AnalyticsScripts } from '@tixly/analytics-tags';
//
//   export default function RootLayout({ children }) {
//     const consentGiven = getConsentFromCookies(); // tvoje funkce
//     return (
//       <html>
//         <head>
//           <AnalyticsScripts consentGiven={consentGiven} />
//         </head>
//         <body>{children}</body>
//       </html>
//     );
//   }
// =============================================================================

import * as React from 'react';
import { loadTrackingConfig } from '../lib/load-config.js';

interface Props {
  /** Zda uživatel udělil souhlas s analytics/marketing cookies */
  consentGiven?: boolean;
}

export function AnalyticsScripts({ consentGiven = false }: Props): React.ReactElement | null {
  const config = loadTrackingConfig();
  if (config.requireConsent && !consentGiven) return null;

  return (
    <>
      {config.gtmContainerId && (
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${config.gtmContainerId}');`,
          }}
        />
      )}

      {config.ga4MeasurementId && !config.gtmContainerId && (
        <>
          <script
            async
            src={`https://www.googletagmanager.com/gtag/js?id=${config.ga4MeasurementId}`}
          />
          <script
            dangerouslySetInnerHTML={{
              __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${config.ga4MeasurementId}');`,
            }}
          />
        </>
      )}

      {config.metaPixelId && (
        <script
          dangerouslySetInnerHTML={{
            __html: `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${config.metaPixelId}');
fbq('track', 'PageView');`,
          }}
        />
      )}
    </>
  );
}
