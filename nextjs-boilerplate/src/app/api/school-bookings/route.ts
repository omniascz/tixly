import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { randomBytes } from 'crypto';
import { z } from 'zod';

const SCHOOL_DISCOUNT = 0.75;

const postSchema = z.object({
  eventId: z.string().uuid(),
  contactName: z.string().min(2).max(120),
  contactEmail: z.string().email().max(320),
  schoolName: z.string().min(2).max(200),
  schoolIco: z.string().max(20).optional(),
  schoolDic: z.string().max(20).optional(),
  billingAddress: z.string().max(500).optional(),
  studentCount: z.number().int().min(1).max(2000),
  teacherCount: z.number().int().min(0).max(100).optional(),
  ageGroup: z.enum(['preschool', 'primary', 'secondary', 'university', 'mixed']).optional(),
  notes: z.string().max(1000).optional(),
});

async function ensureTable(): Promise<void> {
  await db().query(`
    CREATE TABLE IF NOT EXISTS orders.school_bookings (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id        UUID NOT NULL,
      promoter_id     UUID NOT NULL,
      contact_name    TEXT NOT NULL,
      contact_email   TEXT NOT NULL,
      school_name     TEXT NOT NULL,
      school_ico      TEXT,
      school_dic      TEXT,
      billing_address TEXT,
      student_count   INT NOT NULL,
      teacher_count   INT NOT NULL DEFAULT 0,
      age_group       TEXT,
      notes           TEXT,
      unit_price_halire BIGINT NOT NULL,
      total_price_halire BIGINT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      payment_method  TEXT NOT NULL DEFAULT 'invoice',
      group_qr_token  TEXT NOT NULL UNIQUE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function generateQrToken(): string {
  return 'SCH-' + randomBytes(16).toString('hex').toUpperCase();
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    }
    const input = parsed.data;

    await ensureTable();

    const evRow = await db().query<{
      id: string;
      title: string;
      promoter_id: string;
      status: string;
    }>(
      `SELECT id, title, promoter_id, status FROM catalog.events WHERE id = $1`,
      [input.eventId],
    );
    if (evRow.rows.length === 0) {
      return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
    }
    const event = evRow.rows[0];
    if (event.status !== 'published') {
      return NextResponse.json({ error: 'EVENT_NOT_PUBLISHED' }, { status: 422 });
    }

    const ttRow = await db().query<{
      id: string;
      base_price: number;
      school_group_price_halire: number | null;
    }>(
      `SELECT tt.id, tt.base_price,
              gdt.discount_flat_halire AS school_group_price_halire
         FROM catalog.ticket_types tt
         LEFT JOIN catalog.group_discount_tiers gdt
                ON gdt.ticket_type_id = tt.id
               AND gdt.label ILIKE '%škol%'
        WHERE tt.event_id = $1
        ORDER BY gdt.min_quantity DESC NULLS LAST, tt.base_price ASC
        LIMIT 1`,
      [input.eventId],
    );
    if (ttRow.rows.length === 0) {
      return NextResponse.json({ error: 'NO_TICKET_TYPES' }, { status: 422 });
    }
    const tt = ttRow.rows[0];

    let unitPrice: number;
    if (tt.school_group_price_halire !== null) {
      unitPrice = tt.base_price - tt.school_group_price_halire;
    } else {
      unitPrice = Math.round(tt.base_price * SCHOOL_DISCOUNT);
    }
    const teacherCount = input.teacherCount ?? 0;
    const totalPrice = unitPrice * input.studentCount;

    const groupQrToken = generateQrToken();

    const ins = await db().query<{ id: string }>(
      `INSERT INTO orders.school_bookings
         (event_id, promoter_id, contact_name, contact_email, school_name,
          school_ico, school_dic, billing_address, student_count, teacher_count,
          age_group, notes, unit_price_halire, total_price_halire, group_qr_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [
        input.eventId,
        event.promoter_id,
        input.contactName,
        input.contactEmail,
        input.schoolName,
        input.schoolIco ?? null,
        input.schoolDic ?? null,
        input.billingAddress ?? null,
        input.studentCount,
        teacherCount,
        input.ageGroup ?? null,
        input.notes ?? null,
        unitPrice,
        totalPrice,
        groupQrToken,
      ],
    );

    console.log(
      `[school-bookings] New booking ${ins.rows[0].id} for event ${input.eventId} ` +
      `school=${input.schoolName} students=${input.studentCount} total=${totalPrice}`,
    );

    return NextResponse.json(
      {
        bookingId: ins.rows[0].id,
        groupQrToken,
        totalPrice,
        unitPrice,
        studentCount: input.studentCount,
        teacherCount,
        contactEmail: input.contactEmail,
      },
      { status: 201 },
    );
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    await ensureTable();

    const eventId = new URL(req.url).searchParams.get('eventId');
    const args: unknown[] = [promoter.promoterId];
    let eventFilter = '';
    if (eventId && /^[0-9a-f-]{36}$/i.test(eventId)) {
      args.push(eventId);
      eventFilter = `AND sb.event_id = $2`;
    }

    const r = await db().query(
      `SELECT sb.id, sb.event_id, sb.contact_name, sb.contact_email,
              sb.school_name, sb.school_ico, sb.school_dic, sb.billing_address,
              sb.student_count, sb.teacher_count, sb.age_group, sb.notes,
              sb.unit_price_halire, sb.total_price_halire, sb.status,
              sb.payment_method, sb.group_qr_token, sb.created_at, sb.updated_at,
              e.title AS event_title, e.date_start AS event_date
         FROM orders.school_bookings sb
         JOIN catalog.events e ON e.id = sb.event_id
        WHERE sb.promoter_id = $1 ${eventFilter}
        ORDER BY sb.created_at DESC
        LIMIT 500`,
      args,
    );

    return NextResponse.json({ bookings: r.rows });
  });
}
