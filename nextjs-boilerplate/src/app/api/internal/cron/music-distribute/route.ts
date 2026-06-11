/**
 * POST /api/internal/cron/music-distribute
 *
 * Zpracuje frontu lineups.music_post_jobs — pošle koncerty na hudební agregátory
 * (Bandsintown, Songkick). Spotify/Apple Music je čtou automaticky.
 * Bez partner API klíčů se joby přeskočí s konkrétním důvodem.
 *
 * Bezpečnost: x-internal-token (volá dispatcher /api/cron/dispatch?job=music-distribute).
 */
import { timingSafeEqual } from 'crypto';
import { runWithServiceContext } from '@/lib/db/rls-pool';
import { processMusicPostQueue } from '@/lib/music/post-jobs';
import { NextRequest, NextResponse } from 'next/server';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    const token = req.headers.get('x-internal-token') ?? '';
    const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
    if (!expected || !safeEqual(token, expected)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const result = await processMusicPostQueue(50);
    return NextResponse.json({ ok: true, ...result });
  });
}
