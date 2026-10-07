import type { JSX } from 'react';
import type { Metadata } from 'next';
import { Card, CardContent } from '@/components/ui/card';
import { SCHEMA_SDL } from '@/lib/graphql/schema';
import { ApiDocsPlayground } from './playground';


export const metadata: Metadata = {
  title: 'API Documentation — Tixly GraphQL',
  description:
    'Public read-only GraphQL API pro Tixly — schema, příklady, live playground.',
};

const STRINGS = {
  cs: {
    title: 'GraphQL API',
    subtitle: 'Public read-only API pro third-party integrace',
    endpoint: 'Endpoint',
    auth: 'Autentizace',
    authBody:
      'Veřejný read-only endpoint, bez API klíče. Rate limit 60 req/min/IP. ' +
      'Pro vyšší limity kontaktuj support@tixly.cz.',
    schema: 'Schema (SDL)',
    schemaCta: 'Stáhnout raw SDL: ',
    examples: 'Příklady dotazů',
    playground: 'Playground',
    playgroundHint: 'Editor pro live testování dotazů proti production endpointu.',
  },
  sk: {
    title: 'GraphQL API',
    subtitle: 'Verejné read-only API pre third-party integrácie',
    endpoint: 'Endpoint',
    auth: 'Autentifikácia',
    authBody:
      'Verejný read-only endpoint, bez API kľúča. Rate limit 60 req/min/IP. ' +
      'Pre vyššie limity kontaktuj support@tixly.cz.',
    schema: 'Schema (SDL)',
    schemaCta: 'Stiahnuť raw SDL: ',
    examples: 'Príklady dotazov',
    playground: 'Playground',
    playgroundHint: 'Editor na live testovanie dotazov voči produkčnému endpointu.',
  },
  en: {
    title: 'GraphQL API',
    subtitle: 'Public read-only API for third-party integrations',
    endpoint: 'Endpoint',
    auth: 'Authentication',
    authBody:
      'Public read-only endpoint, no API key required. Rate limit 60 req/min/IP. ' +
      'For higher limits contact support@tixly.cz.',
    schema: 'Schema (SDL)',
    schemaCta: 'Raw SDL: ',
    examples: 'Example queries',
    playground: 'Playground',
    playgroundHint: 'Editor for live querying against the production endpoint.',
  },
};

const EXAMPLES: Array<{ title: string; query: string }> = [
  {
    title: 'Single event by ID',
    query: `query EventById {
  event(id: "00000000-0000-0000-0000-000000000000") {
    id
    title
    dateStart
    venue { name city }
    cheapestPriceHalire
    soldOut
  }
}`,
  },
  {
    title: 'List upcoming events in Prague',
    query: `query EventsPrague {
  events(limit: 10, city: "Praha") {
    total
    hasMore
    nodes {
      id
      slug
      title
      dateStart
      cheapestPriceHalire
    }
  }
}`,
  },
  {
    title: 'Trending events',
    query: `query Trending {
  trending(limit: 5) {
    id
    title
    venue { name }
    cheapestPriceHalire
  }
}`,
  },
  {
    title: 'Promoter profile with upcoming events',
    query: `query PromoterProfile($slug: String!) {
  promoter(slug: $slug) {
    id
    name
    brandColorHex
    upcomingEvents(limit: 10) {
      id
      title
      dateStart
    }
  }
}`,
  },
  {
    title: 'Full-text search',
    query: `query Search {
  searchEvents(query: "jazz", limit: 10) {
    id
    title
    venue { city }
    dateStart
  }
}`,
  },
];

function getStrings(locale: string): (typeof STRINGS)[keyof typeof STRINGS] {
  return STRINGS[locale as keyof typeof STRINGS] ?? STRINGS.en;
}

export default async function ApiDocsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<JSX.Element> {
  const { locale } = await params;
  const t = getStrings(locale);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const endpointUrl = `${baseUrl}/api/graphql`;
  const sdlUrl = `${baseUrl}/api/graphql/schema`;

  return (
    <main className="container mx-auto max-w-5xl px-4 py-10">
      <header className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">{t.title}</h1>
        <p className="mt-2 text-muted-foreground">{t.subtitle}</p>
      </header>

      <section className="mb-8 grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <h2 className="mb-2 font-semibold">{t.endpoint}</h2>
            <code className="block break-all rounded bg-muted px-3 py-2 text-sm">
              POST {endpointUrl}
            </code>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <h2 className="mb-2 font-semibold">{t.auth}</h2>
            <p className="text-sm text-muted-foreground">{t.authBody}</p>
          </CardContent>
        </Card>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-xl font-semibold">{t.schema}</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {t.schemaCta}
          <a className="underline" href={sdlUrl}>
            {sdlUrl}
          </a>
        </p>
        <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-4 text-xs leading-relaxed">
          <code>{SCHEMA_SDL.trim()}</code>
        </pre>
      </section>

      <section className="mb-10">
        <h2 className="mb-4 text-xl font-semibold">{t.examples}</h2>
        <div className="space-y-4">
          {EXAMPLES.map((ex) => (
            <div key={ex.title} className="rounded-lg border bg-card">
              <div className="border-b px-4 py-2 text-sm font-medium">{ex.title}</div>
              <pre className="overflow-x-auto p-4 text-xs leading-relaxed">
                <code>{ex.query}</code>
              </pre>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-2 text-xl font-semibold">{t.playground}</h2>
        <p className="mb-4 text-sm text-muted-foreground">{t.playgroundHint}</p>
        <ApiDocsPlayground endpoint={endpointUrl} initialQuery={EXAMPLES[2].query} />
      </section>
    </main>
  );
}
