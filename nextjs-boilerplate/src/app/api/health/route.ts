/**
 * GET /api/health — liveness probe
 *
 * Pouze potvrzuje, že proces žije a zvládne odpovědět. NEKONTROLUJE
 * závislosti — pro to je `/api/health/ready` (DB + Redis ping).
 *
 * Použití: UptimeRobot/BetterStack pingují tohle, aby ověřili, že
 * aplikace neumřela. Když je response, je naživu; kdyby umřela,
 * request selže na úrovni TCP/HTTP.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return NextResponse.json({
    status: 'ok',
    service: 'tixly-web',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    nodeVersion: process.version,
  });
}
