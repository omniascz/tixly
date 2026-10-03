import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';

const schema = z.object({
  token: z.string().min(8).max(200),
});

const WINDOW_HOURS = 12;

export async function POST(req: NextRequest): Promise<Response> {
  // Kolo 4: odbavení skupiny smí jen obsluha pořadatele, kterému rezervace patří (dřív
  // bez ověření — kdokoli s QR tokenem dostal „admitted" + údaje o škole). Kontext
  // pořadatele: cizí rezervace pod RLS není vidět → stejná odpověď jako neexistující token.
  return runAsActivePromoter(req, async (promoter) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
    }

    const r = await db().query<{
      id: string;
      school_name: string;
      student_count: number;
      teacher_count: number;
      status: string;
      event_id: string;
      event_title: string;
      event_date_start: string;
    }>(
      `SELECT sb.id, sb.school_name, sb.student_count, sb.teacher_count, sb.status,
              sb.event_id,
              e.title AS event_title, e.date_start AS event_date_start
         FROM orders.school_bookings sb
         JOIN catalog.events e ON e.id = sb.event_id
        WHERE sb.group_qr_token = $1 AND sb.promoter_id = $2`,
      [parsed.data.token, promoter.promoterId],
    );

    if (r.rows.length === 0) {
      return NextResponse.json(
        { admitted: false, reason: 'BOOKING_NOT_FOUND' },
        { status: 200 },
      );
    }

    const booking = r.rows[0];

    if (!['confirmed', 'paid'].includes(booking.status)) {
      return NextResponse.json(
        { admitted: false, reason: 'BOOKING_NOT_CONFIRMED', status: booking.status },
        { status: 200 },
      );
    }

    if (booking.event_date_start) {
      const eventTime = new Date(booking.event_date_start).getTime();
      const now = Date.now();
      const diffHours = Math.abs(now - eventTime) / 3_600_000;
      if (diffHours > WINDOW_HOURS) {
        return NextResponse.json(
          {
            admitted: false,
            reason: 'WRONG_DAY',
            eventDate: booking.event_date_start,
          },
          { status: 200 },
        );
      }
    }

    console.log(
      `[scanner/school-group] ADMITTED booking ${booking.id} ` +
      `school=${booking.school_name} students=${booking.student_count} ` +
      `event=${booking.event_id}`,
    );

    return NextResponse.json({
      admitted: true,
      bookingId: booking.id,
      schoolName: booking.school_name,
      studentCount: booking.student_count,
      teacherCount: booking.teacher_count,
      eventTitle: booking.event_title,
      eventDate: booking.event_date_start,
    });
  });
}
