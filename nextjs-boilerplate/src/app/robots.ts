import type { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/'],
        disallow: [
          '/api/',
          '/admin/',
          '/platform/',
          '/checkout',
          '/queue/',
          '/lottery/redeem',
          '/gift/redeem',
          '/team/accept',
        ],
      },
      {
        userAgent: ['GPTBot', 'CCBot', 'anthropic-ai', 'Claude-Web'],
        disallow: ['/'],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
