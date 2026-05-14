/**
 * POST /api/graphql
 *
 * Public read-only GraphQL endpoint. Vyžaduje `npm install graphql` package.
 * Bez něj vrací 503 s instrukcí.
 *
 * Body: { query: string, variables?: object, operationName?: string }
 *
 * Schema: src/lib/graphql/schema.ts (SDL string)
 * Resolvers: src/lib/graphql/resolvers.ts
 *
 * Rate limit: ne ještě — production deploy add through middleware.
 */

import { NextRequest, NextResponse } from 'next/server';
import { SCHEMA_SDL } from '@/lib/graphql/schema';
import { resolvers } from '@/lib/graphql/resolvers';

interface GraphQLLib {
  buildSchema: (sdl: string) => unknown;
  graphql: (args: {
    schema: unknown;
    source: string;
    rootValue?: unknown;
    contextValue?: unknown;
    variableValues?: Record<string, unknown>;
    operationName?: string;
  }) => Promise<{ data?: unknown; errors?: unknown[] }>;
}

let graphqlModule: GraphQLLib | null | undefined;
let cachedSchema: unknown = null;

async function getGraphQLModule(): Promise<GraphQLLib | null> {
  if (graphqlModule !== undefined) return graphqlModule;
  try {
    const mod = (await import('graphql' as string)) as unknown as GraphQLLib;
    graphqlModule = mod;
    cachedSchema = mod.buildSchema(SCHEMA_SDL);
    return mod;
  } catch {
    graphqlModule = null;
    return null;
  }
}

// Flatten resolvers do single root object — buildSchema používá field-name resolution.
function buildRootValue(): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [typeName, fields] of Object.entries(resolvers)) {
    if (typeName === 'Query') {
      for (const [field, resolver] of Object.entries(fields as Record<string, unknown>)) {
        root[field] = resolver;
      }
    }
  }
  return root;
}

export async function POST(req: NextRequest): Promise<Response> {
  const mod = await getGraphQLModule();
  if (!mod) {
    return NextResponse.json(
      {
        errors: [
          {
            message:
              'GraphQL package není nainstalovaný. Spusť `npm install graphql` a re-deploy.',
          },
        ],
      },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('query' in body)) {
    return NextResponse.json(
      { errors: [{ message: 'Missing query in body' }] },
      { status: 400 },
    );
  }

  const { query, variables, operationName } = body as {
    query: string;
    variables?: Record<string, unknown>;
    operationName?: string;
  };

  try {
    const result = await mod.graphql({
      schema: cachedSchema,
      source: query,
      rootValue: buildRootValue(),
      variableValues: variables,
      operationName,
    });
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        errors: [
          {
            message: err instanceof Error ? err.message : 'unknown',
          },
        ],
      },
      { status: 500 },
    );
  }
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

// GET = simple introspection / playground hint
export async function GET(): Promise<Response> {
  return NextResponse.json({
    name: 'Tixly GraphQL API',
    version: '1.0',
    schema_sdl_url: '/api/graphql/schema',
    docs:
      'POST { query, variables? }. Read-only. Bez auth pro public endpoints. ' +
      'Examples: { event(id:"...") { title } }, { events(limit:10, city:"Praha") { nodes { title } } }, ' +
      '{ trending(limit:5) { id title cheapestPriceHalire } }',
  });
}
