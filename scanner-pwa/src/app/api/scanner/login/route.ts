import { NextResponse } from 'next/server';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// POST /api/scanner/login
// Authenticates a staff member by email + event code.
// Returns a JWT token + eventId for offline token-based sync.
// ---------------------------------------------------------------------------

const LoginRequestSchema = z.object({
  email: z.string().email(),
  eventCode: z.string().min(1),
});

type LoginRequest = z.infer<typeof LoginRequestSchema>;

interface LoginResponse {
  token: string;
  eventId: string;
  eventName: string;
}

async function getEventByCode(
  eventCode: string,
): Promise<{ eventId: string; eventName: string } | null> {
  try {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    // MVP: Match event code to first 8 chars of event id
    // For now, accept the eventCode as-is and look for an event that starts with it
    const result = await client.query(
      'SELECT id, name FROM catalog.events WHERE id ILIKE $1 || \'%\' LIMIT 1',
      [eventCode],
    );
    await client.end();

    if (result.rows.length === 0) return null;
    return {
      eventId: result.rows[0].id,
      eventName: result.rows[0].name,
    };
  } catch {
    return null;
  }
}

/**
 * Simple JWT generation without external library.
 * Format: base64(header).base64(payload).base64(signature)
 * For MVP: unsigned token with simple base64 encoding.
 */
function generateSimpleToken(email: string, eventId: string): string {
  const header = JSON.stringify({ alg: 'none', typ: 'JWT' });
  const payload = JSON.stringify({
    email,
    eventId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24h expiry
  });

  const headerB64 = Buffer.from(header).toString('base64url');
  const payloadB64 = Buffer.from(payload).toString('base64url');

  // Unsigned JWT (MVP only — in production, sign with RS256 or HS256)
  return `${headerB64}.${payloadB64}.`;
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { email, eventCode } = LoginRequestSchema.parse(body);

    // Look up event by code
    const event = await getEventByCode(eventCode);
    if (!event) {
      return NextResponse.json(
        { error: 'Invalid event code' },
        { status: 401 },
      );
    }

    // Generate token
    const token = generateSimpleToken(email, event.eventId);

    const response: LoginResponse = {
      token,
      eventId: event.eventId,
      eventName: event.eventName,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: err.errors },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
