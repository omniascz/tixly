/**
 * GET /api/buyer/tickets/[ticketId]/stream-access
 *
 * Vrátí přístup ke streamu pro konkrétní vstupenku:
 *  - Ověří vlastnictví (ticket.owner_id = authenticated user)
 *  - Zkontroluje, že event má streaming_url
 *  - Zkontroluje časové okno:
 *      live:            date_start - 15 min → date_end + 30 min
 *      live_and_replay: date_start - 15 min → date_end + stream_replay_days dní
 *  - Vrátí { streaming_url, streaming_provider, stream_chat_url, is_replay, replay_expires_at }
 *
 * Bezpečnost: streaming_url se dostane pouze ověřenému vlastníkovi platné vstupenky.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface StreamRow {
  ticket_status:        string;
  stream_access:        string;
  streaming_url:        string | null;
  streaming_provider:   string | null;
  stream_chat_url:      string | null;
  stream_recording_url: string | null;
  stream_replay_days:   number;
  date_start:           string;
  date_end:             string | null;
  event_title:          string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const r = await db().query<StreamRow>(
      `SELECT t.status AS ticket_status,
              COALESCE(tt.stream_access, 'live') AS stream_access,
              e.streaming_url, e.streaming_provider, e.stream_chat_url,
              e.stream_recording_url, e.stream_replay_days,
              e.date_start, e.date_end,
              e.title AS event_title
       FROM tickets.tickets t
       JOIN orders.orders o ON o.id = t.order_id
       JOIN catalog.events e ON e.id = o.event_id
       JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
       WHERE t.id = $1 AND t.owner_id = $2`,
      [params.ticketId, userId],
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const s = r.rows[0];

    if (s.ticket_status !== 'valid') {
      return NextResponse.json(
        { error: 'TICKET_NOT_VALID', status: s.ticket_status },
        { status: 403 },
      );
    }

    if (!s.streaming_url) {
      return NextResponse.json({ error: 'NO_STREAM' }, { status: 404 });
    }

    if (s.stream_access === 'none') {
      return NextResponse.json(
        { error: 'NO_STREAM_ACCESS', detail: 'Tento typ vstupenky nezahrnuje přístup ke streamu.' },
        { status: 403 },
      );
    }

    const now          = Date.now();
    const dateStart    = new Date(s.date_start).getTime();
    const liveOpenMs   = dateStart - 15 * 60 * 1000; // 15 min před začátkem
    const dateEnd      = s.date_end ? new Date(s.date_end).getTime() : dateStart + 3 * 60 * 60 * 1000;
    const liveCloseMs  = dateEnd + 30 * 60 * 1000;   // 30 min po konci
    const replayCloseMs = dateEnd + s.stream_replay_days * 24 * 60 * 60 * 1000;

    const tooEarly = now < liveOpenMs;
    const isLive   = now >= liveOpenMs && now <= liveCloseMs;
    const isReplay = s.stream_access === 'live_and_replay' && now > liveCloseMs && now <= replayCloseMs;

    if (tooEarly) {
      const minutesUntil = Math.ceil((liveOpenMs - now) / 60000);
      return NextResponse.json(
        { error: 'STREAM_NOT_YET_STARTED', minutesUntil },
        { status: 425 },
      );
    }

    if (!isLive && !isReplay) {
      return NextResponse.json(
        {
          error: 'STREAM_ENDED',
          detail: s.stream_access === 'live_and_replay'
            ? 'Přístup k záznamu vypršel.'
            : 'Živý přenos skončil. Tento typ vstupenky nezahrnuje přístup k záznamu.',
        },
        { status: 410 },
      );
    }

    // V replay fázi použij stream_recording_url (pokud je vyplněno), jinak streaming_url
    const url = isReplay && s.stream_recording_url ? s.stream_recording_url : s.streaming_url;

    return NextResponse.json({
      ok:                true,
      streaming_url:     url,
      streaming_provider: s.streaming_provider,
      stream_chat_url:   isLive ? s.stream_chat_url : null,
      is_live:           isLive,
      is_replay:         isReplay,
      event_title:       s.event_title,
      replay_expires_at: s.stream_access === 'live_and_replay'
        ? new Date(replayCloseMs).toISOString()
        : null,
    });
  });
}
