import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: 'INVALID_ID' }, { status: 422 });
    }

    const r = await db().query<{
      group_qr_token: string;
      school_name: string;
      student_count: number;
      teacher_count: number;
      event_title: string;
      event_date: string;
      status: string;
    }>(
      `SELECT sb.group_qr_token, sb.school_name, sb.student_count, sb.teacher_count,
              sb.status,
              e.title AS event_title, e.date_start AS event_date
         FROM orders.school_bookings sb
         JOIN catalog.events e ON e.id = sb.event_id
        WHERE sb.id = $1 AND sb.promoter_id = $2`,
      [id, promoter.promoterId],
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const row = r.rows[0];
    return NextResponse.json({
      groupQrToken: row.group_qr_token,
      schoolName: row.school_name,
      studentCount: row.student_count,
      teacherCount: row.teacher_count,
      eventTitle: row.event_title,
      eventDate: row.event_date,
      status: row.status,
    });
  });
}
