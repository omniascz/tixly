/**
 * GET /api/events/[id]/social-context — FOMO context pro event detail page
 *
 * Public (no auth) → vrátí jen totalGoing + totalInterested.
 * S x-user-id headerem → navíc friendsGoing (až 5 jmen) + friendsInterested
 * + myStatus.
 *
 * DACH P2-4 (DICE Social FOMO pattern). "5 přátel jde" je 40 % důvod
 * proč buyer kupuje (DICE benchmark).
 *
 * RLS: totals běží v anon kontextu (is_public RSVPs = public-read policy);
 * friends + myStatus uvnitř runWithUserContext (čtou social_graph.friendships
 * + vlastní RSVP, které izolují přes app.current_user_id).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithUserContext } from '@/lib/db/rls-pool';

interface FriendRsvp {
  user_id: string;
  email: string;
  name: string | null;
  status: 'going' | 'interested';
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'BAD_EVENT_ID' }, { status: 422 });
  }
  const userId = req.headers.get('x-user-id');

  // Totals (public) — respektuje is_public=true, anon kontext
  const totals = await db().query<{ status: string; count: string }>(
    `SELECT status, COUNT(*)::text AS count
       FROM marketing.event_rsvps
      WHERE event_id = $1 AND status IN ('going','interested') AND is_public = true
      GROUP BY status`,
    [params.id],
  );
  const counts: Record<string, number> = {};
  for (const r of totals.rows) counts[r.status] = Number(r.count);

  if (!userId) {
    return NextResponse.json({
      eventId: params.id,
      totalGoing: counts.going ?? 0,
      totalInterested: counts.interested ?? 0,
      friendsGoing: [],
      friendsInterested: [],
      myStatus: null,
    });
  }

  return runWithUserContext(userId, async () => {
    // Friends RSVPs (užívá social_graph.friendships canonical user_a < user_b)
    const friendsRsvps = await db().query<FriendRsvp>(
      `WITH my_friends AS (
         SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS friend_id
           FROM social_graph.friendships
          WHERE user_a = $1 OR user_b = $1
       )
       SELECT mf.friend_id AS user_id, u.email, u.name, r.status
         FROM my_friends mf
         JOIN identity.users u ON u.id = mf.friend_id
         JOIN marketing.event_rsvps r ON r.user_id = mf.friend_id
        WHERE r.event_id = $2
          AND r.status IN ('going','interested')
          AND r.is_public = true
        ORDER BY r.status DESC, r.updated_at DESC
        LIMIT 20`,
      [userId, params.id],
    );

    const friendsGoing = friendsRsvps.rows
      .filter((r) => r.status === 'going')
      .slice(0, 5)
      .map((r) => ({ userId: r.user_id, name: r.name ?? r.email, email: r.email }));
    const friendsInterested = friendsRsvps.rows
      .filter((r) => r.status === 'interested')
      .slice(0, 5)
      .map((r) => ({ userId: r.user_id, name: r.name ?? r.email, email: r.email }));

    // My status
    const my = await db().query<{ status: string }>(
      `SELECT status FROM marketing.event_rsvps WHERE user_id = $1 AND event_id = $2`,
      [userId, params.id],
    );

    return NextResponse.json({
      eventId: params.id,
      totalGoing: counts.going ?? 0,
      totalInterested: counts.interested ?? 0,
      friendsGoing,
      friendsInterested,
      friendsGoingCount: friendsRsvps.rows.filter((r) => r.status === 'going').length,
      friendsInterestedCount: friendsRsvps.rows.filter((r) => r.status === 'interested').length,
      myStatus: my.rows[0]?.status ?? null,
    });
  });
}
