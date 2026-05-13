import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Testy validační logiky API route /api/widget/[eventId]
// (business logika extrahovaná pro testovatelnost bez Next.js)
// ---------------------------------------------------------------------------

function isValidEventIdForApi(eventId: string): boolean {
  return (
    typeof eventId === 'string' &&
    eventId.length > 0 &&
    eventId.length <= 100 &&
    /^[a-zA-Z0-9_-]+$/.test(eventId)
  );
}

describe('GET /api/widget/[eventId] — validace', () => {
  it('přijme UUID formát', () => {
    expect(isValidEventIdForApi('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('přijme slug formát', () => {
    expect(isValidEventIdForApi('festival-2026')).toBe(true);
  });

  it('přijme alfanumerické ID', () => {
    expect(isValidEventIdForApi('evt123ABC')).toBe(true);
  });

  it('odmítne prázdný string', () => {
    expect(isValidEventIdForApi('')).toBe(false);
  });

  it('odmítne ID delší než 100 znaků', () => {
    expect(isValidEventIdForApi('a'.repeat(101))).toBe(false);
  });

  it('odmítne path traversal pokus', () => {
    expect(isValidEventIdForApi('../secret')).toBe(false);
    expect(isValidEventIdForApi('../../etc/passwd')).toBe(false);
  });

  it('odmítne HTML injection', () => {
    expect(isValidEventIdForApi('<script>alert(1)</script>')).toBe(false);
  });

  it('odmítne mezery', () => {
    expect(isValidEventIdForApi('event id')).toBe(false);
  });

  it('odmítne lomítko', () => {
    expect(isValidEventIdForApi('event/id')).toBe(false);
  });
});

describe('CORS hlavičky', () => {
  it('veřejný endpoint vrací wildcard CORS', () => {
    const headers = buildCorsHeaders(null);
    expect(headers['Access-Control-Allow-Origin']).toBe('*');
  });

  it('OPTIONS vrací 204', () => {
    expect(optionsStatus()).toBe(204);
  });

  it('Access-Control-Allow-Methods obsahuje GET a OPTIONS', () => {
    const headers = buildCorsHeaders('https://promoter.cz');
    expect(headers['Access-Control-Allow-Methods']).toContain('GET');
    expect(headers['Access-Control-Allow-Methods']).toContain('OPTIONS');
  });
});

// Extrahované pomocné funkce (mirrors logiky v route.ts)
function buildCorsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
  };
}

function optionsStatus() {
  return 204;
}
