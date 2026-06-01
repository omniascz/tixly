/**
 * GET /api/internal/cron/refresh-spotify
 *
 * Vercel cron 50min. Pro každého real-mode user_spotify_connections s
 * `expires_at < NOW() + 5min`:
 *   1. Refresh access_token přes refresh_token
 *   2. UPDATE expires_at + access_token_enc
 *
 * Pokud refresh selže (revoked grant) → mark connection NULL tokens
 * a is_mock=false zachovat (user může reconnect).
 */
import { NextResponse } from 'next/server';
import { db, runWithPlatformAdminContext } from '@/lib/db/rls-pool';
import { getSpotifyConfig, refreshAccessToken } from '@/lib/spotify/oauth';

async function runRefresh(): Promise<Response> {
  const cfg = getSpotifyConfig();
  if (!cfg) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'CONFIG_MISSING' });
  }

  // Cron = system op → platform admin kontext (connect() injektuje is_platform_admin).
  return runWithPlatformAdminContext(async () => {
  const client = await db().connect();
  let refreshed = 0;
  let failed = 0;
  try {
    await client.query('BEGIN');

    const stale = await client.query<{
      user_id: string;
      refresh_token_enc: Buffer;
    }>(
      `SELECT user_id, refresh_token_enc
         FROM marketing.user_spotify_connections
        WHERE is_mock = false
          AND refresh_token_enc IS NOT NULL
          AND (expires_at IS NULL OR expires_at < NOW() + INTERVAL '5 minutes')
        LIMIT 100`,
    );

    for (const row of stale.rows) {
      const refreshToken = row.refresh_token_enc.toString('utf8');
      try {
        const tokens = await refreshAccessToken(cfg, refreshToken);
        const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
        await client.query(
          `UPDATE marketing.user_spotify_connections
              SET access_token_enc = $2,
                  refresh_token_enc = $3,
                  expires_at = $4,
                  last_sync_at = NOW()
            WHERE user_id = $1`,
          [
            row.user_id,
            Buffer.from(tokens.access_token, 'utf8'),
            Buffer.from(tokens.refresh_token, 'utf8'),
            expiresAt.toISOString(),
          ],
        );
        refreshed += 1;
      } catch (err) {
        console.error('[spotify refresh] user', row.user_id, err);
        failed += 1;
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[refresh-spotify]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  return NextResponse.json({ ok: true, refreshed, failed });
  });
}

// Vercel dispatcher POSTuje, manual test / curl může GET.
export async function POST(): Promise<Response> {
  return runRefresh();
}
export async function GET(): Promise<Response> {
  return runRefresh();
}
