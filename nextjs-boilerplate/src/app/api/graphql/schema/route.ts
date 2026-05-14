/**
 * GET /api/graphql/schema
 *
 * Public SDL endpoint pro client codegen (graphql-codegen, urql, Apollo).
 * Vrací text/plain SDL string.
 */

import { SCHEMA_SDL } from '@/lib/graphql/schema';

export const dynamic = 'force-static';

export async function GET(): Promise<Response> {
  return new Response(SCHEMA_SDL, {
    headers: {
      'Content-Type': 'application/graphql; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
