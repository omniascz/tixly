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
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'api.gopay.cz' },
      { protocol: 'https', hostname: 'images.cloudflare.com' },
      { protocol: 'https', hostname: 'cdn.example.com' },
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
      'geolocation=()',
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

    return [
      {
        source: '/:path*',
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
        // API routes — žádný cache, no-store
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
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

export default nextConfig;
