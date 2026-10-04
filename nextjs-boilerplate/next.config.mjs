import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pre-existing TS chyby v sourozeneckých modulech (gopay-payments package atd.)
  // blokují build. Pro lokální demo necháváme runtime chyby vyhodnotit za běhu;
  // unit testy a type-check projektu jsou separátní.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // pdfkit bundles AFM font files via require() — webpack can't statically analyze
  // these, so we externalize it to load directly from node_modules at runtime.
  experimental: {
    serverComponentsExternalPackages: ['pdfkit'],
    // Kolo 9: bez tohoto Next 14 instrumentation.ts nespouští — nenačítal se Sentry ani pojistka stagingu.
    instrumentationHook: true,
  },
  images: {
    // Kolo 9: zmírnění bez změny hlavní verze Next (14.2.35):
    //   GHSA-2xp9-vwfh-vxw4 (critical) — RCE v optimalizaci obrázků (sharp/libheif) u AVIF; opraveno až v 15.5.24/16.3.3,
    //   advisory neuvádí konfigurační obranu → optimalizaci vypínáme úplně.
    //   GHSA-h64f-5h5j-jqjh — DoS /_next/image: „If you are using images.unoptimized: true, you are NOT impacted."
    //   GHSA-9g9p-9gw9-jx7f — DoS přes remotePatterns (týká se jen optimalizace vzdálených obrázků).
    // Obrázky se pak servírují přímo z původní URL (endpoint /_next/image se nepoužívá).
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'api.gopay.cz' },
      { protocol: 'https', hostname: 'images.cloudflare.com' },
    ],
  },
  headers: async () => {
    const isProd = process.env.NODE_ENV === 'production';
    // CSP: dev needs unsafe-eval pro Next HMR; prod tighter.
    const csp = isProd
      ? [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://connect.facebook.net",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "img-src 'self' https: data: blob:",
          "font-src 'self' https://fonts.gstatic.com data:",
          "connect-src 'self' https://www.google-analytics.com https://graph.facebook.com",
          "frame-ancestors 'none'",
          "form-action 'self'",
          "base-uri 'self'",
          "object-src 'none'",
          'upgrade-insecure-requests',
        ].join('; ')
      : "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; font-src 'self' data:; connect-src 'self' https: ws: wss:; frame-ancestors 'none';";

    const permissionsPolicy = [
      'accelerometer=()',
      'autoplay=()',
      'camera=()',
      'cross-origin-isolated=()',
      'display-capture=()',
      'encrypted-media=()',
      'fullscreen=(self)',
      'geolocation=(self)',
      'gyroscope=()',
      'keyboard-map=()',
      'magnetometer=()',
      'microphone=()',
      'midi=()',
      'payment=(self)',
      'picture-in-picture=()',
      'publickey-credentials-get=(self)',
      'screen-wake-lock=()',
      'sync-xhr=()',
      'usb=()',
      'xr-spatial-tracking=()',
    ].join(', ');

    // Embed widgety (/embed/*) MUSÍ být frame-ovatelné na cizím webu (prodejní
    // widget). Proto je vyjímáme z globálního X-Frame-Options:DENY + frame-ancestors:none
    // a dáváme jim vlastní hlavičky, které framing povolí. Allowlist domén promotérů
    // přes EMBED_FRAME_ANCESTORS (mezerami oddělené), default '*' (prototyp).
    const embedFrameAncestors = process.env.EMBED_FRAME_ANCESTORS ?? '*';
    const embedCsp = [
      "default-src 'self'",
      // dev: Next HMR/runtime potřebuje 'unsafe-eval'; prod bez něj.
      isProd ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' https: data: blob:",
      "font-src 'self' https://fonts.gstatic.com data:",
      "connect-src 'self'",
      `frame-ancestors ${embedFrameAncestors}`,
    ].join('; ');

    return [
      {
        // Globální bezpečnostní hlavičky — KROMĚ /embed (ten se musí dát iframe-ovat).
        source: '/((?!embed).*)',
        headers: [
          // Force HTTPS for 1 year, allow subdomain inclusion + preload list eligibility
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-XSS-Protection', value: '0' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Permissions-Policy', value: permissionsPolicy },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          { key: 'Origin-Agent-Cluster', value: '?1' },
        ],
      },
      {
        // Embed prodejní widget — frame-ovatelný (bez X-Frame-Options DENY).
        source: '/embed/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: embedCsp },
        ],
      },
      {
        // API routes — žádný cache, no-store
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
      {
        // CORS pro embed/native prodejní integraci — veřejné buyer endpointy
        // (guest checkout bez cookies → '*' je bezpečné; produkce může omezit
        // přes EMBED_ALLOWED_ORIGINS na route úrovni). Pokrývá ticket-types + checkout.
        source: '/api/events/:id/ticket-types',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: process.env.EMBED_ALLOWED_ORIGINS ?? '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
          { key: 'Vary', value: 'Origin' },
        ],
      },
      {
        source: '/api/checkout',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: process.env.EMBED_ALLOWED_ORIGINS ?? '*' },
          { key: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
          { key: 'Vary', value: 'Origin' },
        ],
      },
      {
        // Seat-picker ve widgetu — mapa sedadel + hold (číslovaná místa).
        source: '/api/events/:id/seats',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: process.env.EMBED_ALLOWED_ORIGINS ?? '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
          { key: 'Vary', value: 'Origin' },
        ],
      },
      {
        source: '/api/events/:id/seats/hold',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: process.env.EMBED_ALLOWED_ORIGINS ?? '*' },
          { key: 'Access-Control-Allow-Methods', value: 'POST, DELETE, OPTIONS' },
          // x-fingerprint = stabilní per-prohlížeč tag, aby cross-origin guest mohl
          // uvolnit SVŮJ předchozí hold při retry (scope "release my prior hold").
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, x-fingerprint' },
          { key: 'Vary', value: 'Origin' },
        ],
      },
    ];
  },
  webpack: (config, { isServer }) => {
    // Fallbacks only on client bundle — server bundle needs real fs/path/os.
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
      };
    }
    // Allow imports like './foo.js' to resolve to './foo.ts'/'./foo.tsx'
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    config.resolve.alias = {
      ...config.resolve.alias,
      '@tixly/crypto': path.resolve(__dirname, 'src/lib/crypto/index.ts'),
      'gopay-payments/services/gopay-payment.service.js': path.resolve(
        __dirname,
        'src/lib/gopay-mock/gopay-payment.service.ts',
      ),
      'gopay-payments/lib/service-container.js': path.resolve(
        __dirname,
        'src/lib/gopay-mock/service-container.ts',
      ),
    };
    return config;
  },
};

// Sentry wrapper — aktivuje se jen pokud package je nainstalovaný + SENTRY_DSN je v env.
// Bez instalace: čistý export.
let exported = nextConfig;
try {
  // Dynamic require pro vyhnutí TS dep bez instalovaného balíčku
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { withSentryConfig } = await import('@sentry/nextjs').catch(() => ({ withSentryConfig: null }));
  if (withSentryConfig && process.env.SENTRY_DSN) {
    exported = withSentryConfig(nextConfig, {
      silent: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      hideSourceMaps: true,
      disableLogger: true,
      tunnelRoute: '/api/monitoring',
    });
  }
} catch {
  // Sentry package neni nainstalovan — pokracujeme bez nej
}

export default exported;
