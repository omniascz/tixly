/**
 * POST /api/events/[id]/accreditation
 *
 * Public endpoint pro podání žádosti o akreditaci na akci.
 * Body: { name, email, organization?, category, roleDetail?, message? }
 *
 * Validace:
 *   - event musí existovat a být published
 *   - email se normalizuje na lowercase
 *   - UNIQUE (event, email, category) — duplicate aplikace skončí 409
 *
 * Po success: notify email promotérovi (fire-and-forget) + confirm email aplikantovi.
 *
 * RLS: service kontext — public applicant zapisuje accreditation request na cizí
 * event (jako guest write); čte i promoter kontakt pro notifikaci.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

const CATEGORIES = ['media', 'vip', 'staff', 'sponsor', 'performer', 'guest'] as const;

const schema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(320),
  organization: z.string().max(160).optional(),
  category: z.enum(CATEGORIES),
  roleDetail: z.string().max(160).optional(),
  message: z.string().max(1000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
  }
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  return runWithServiceContext(async () => {
    const ev = await db().query<{
      id: string;
      title: string;
      promoter_id: string;
      promoter_email: string | null;
      promoter_name: string | null;
    }>(
      `SELECT e.id, e.title, e.promoter_id, p.contact_email AS promoter_email,
              p.name AS promoter_name
       FROM catalog.events e
       JOIN platform.promoters p ON p.id = e.promoter_id
       WHERE e.id = $1 AND e.status = 'published'`,
      [params.id],
    );
    if (ev.rows.length === 0) {
      return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
    }
    const event = ev.rows[0];

    const email = parsed.data.email.trim().toLowerCase();

    try {
      const r = await db().query<{ id: string }>(
        `INSERT INTO marketing.accreditation_requests
           (event_id, applicant_email, applicant_name, organization, category, role_detail, message)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          params.id,
          email,
          parsed.data.name,
          parsed.data.organization ?? null,
          parsed.data.category,
          parsed.data.roleDetail ?? null,
          parsed.data.message ?? null,
        ],
      );

      // Fire-and-forget notifications
      void (async () => {
        try {
          const { sendMail } = await import('@/lib/email/mailer');
          const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

          // Notify promoter
          if (event.promoter_email) {
            await sendMail({
              to: event.promoter_email,
              subject: `Tixly — nová žádost o akreditaci na ${event.title}`,
              html: `<!DOCTYPE html><html><body style="font-family:system-ui;max-width:600px;padding:24px">
                <h2>Nová žádost o akreditaci</h2>
                <p><strong>Akce:</strong> ${event.title}</p>
                <p><strong>Kategorie:</strong> ${parsed.data.category}</p>
                <p><strong>Jméno:</strong> ${parsed.data.name}</p>
                <p><strong>Email:</strong> ${email}</p>
                ${parsed.data.organization ? `<p><strong>Organizace:</strong> ${parsed.data.organization}</p>` : ''}
                ${parsed.data.roleDetail ? `<p><strong>Role:</strong> ${parsed.data.roleDetail}</p>` : ''}
                ${parsed.data.message ? `<p><strong>Zpráva:</strong><br>${parsed.data.message}</p>` : ''}
                <p style="margin-top:24px"><a href="${appUrl}/admin/events/${event.id}/accreditation">Rozhodnout v adminu →</a></p>
              </body></html>`,
            });
          }

          // Confirm to applicant
          await sendMail({
            to: email,
            subject: `Tixly — žádost o akreditaci přijata: ${event.title}`,
            html: `<!DOCTYPE html><html><body style="font-family:system-ui;max-width:600px;padding:24px">
              <h2>Žádost o akreditaci přijata</h2>
              <p>Děkujeme za žádost o akreditaci na <strong>${event.title}</strong>.</p>
              <p>Pořadatel ${event.promoter_name ?? ''} žádost posoudí a ozve se ti emailem.
              Obvyklá doba odpovědi: 3–7 pracovních dní.</p>
            </body></html>`,
          });
        } catch (err) {
          console.error('[accreditation] notification email failed:', err);
        }
      })();

      return NextResponse.json({ ok: true, requestId: r.rows[0]?.id });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23505') {
        return NextResponse.json(
          { error: 'DUPLICATE', message: 'Pro tento email a kategorii už existuje žádost.' },
          { status: 409 },
        );
      }
      console.error('[POST accreditation]', err);
      return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
    }
  });
}
