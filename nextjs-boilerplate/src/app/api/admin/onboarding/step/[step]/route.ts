import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { randomBytes } from 'crypto';
import { buildESignatureRecord, type DocumentType } from '@/lib/compliance/e-signature';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

async function markStepDone(promoterId: string, step: number, data: Record<string, unknown>) {
  await db().query(
    `UPDATE platform.promoter_onboarding
     SET current_step     = GREATEST(current_step, $2 + 1),
         completed_steps  = array_append(
           array_remove(completed_steps, $2::integer),
           $2::integer
         ),
         step_data        = step_data || $3,
         updated_at       = NOW()
     WHERE promoter_id = $1`,
    [promoterId, step, JSON.stringify(data)],
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: { step: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const step = parseInt(params.step, 10);
    if (isNaN(step) || step < 1 || step > 8) {
      return NextResponse.json({ error: 'INVALID_STEP' }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    if (step === 1) {
      const { name, phone, website, description, logoUrl, pressEmail } = body as {
        name?: string;
        phone?: string;
        website?: string;
        description?: string;
        logoUrl?: string;
        pressEmail?: string;
      };

      if (!name || !phone) {
        return NextResponse.json({ error: 'MISSING_REQUIRED', fields: ['name', 'phone'] }, { status: 422 });
      }

      await db().query(
        `UPDATE platform.promoters
         SET name        = $2,
             phone       = $3,
             website     = $4,
             description = $5,
             logo_url    = $6,
             press_email = $7,
             updated_at  = NOW()
         WHERE id = $1`,
        [promoter.promoterId, name, phone, website ?? null, description ?? null, logoUrl ?? null, pressEmail ?? null],
      );

      await markStepDone(promoter.promoterId, 1, { step1: { name, phone, website, description, logoUrl, pressEmail } });
      return NextResponse.json({ ok: true });
    }

    if (step === 2) {
      const { venueName, capacity, venueType, address } = body as {
        venueName?: string;
        capacity?: number;
        venueType?: string;
        address?: string;
      };

      if (!venueName || !capacity) {
        return NextResponse.json({ error: 'MISSING_REQUIRED', fields: ['venueName', 'capacity'] }, { status: 422 });
      }

      const existing = await db().query<{ id: string; name: string }>(
        `SELECT id, name FROM catalog.venues WHERE promoter_id = $1 ORDER BY created_at ASC LIMIT 1`,
        [promoter.promoterId],
      );

      let venueId: string;
      if (existing.rows.length > 0) {
        venueId = existing.rows[0].id;
      } else {
        const ins = await db().query<{ id: string }>(
          `INSERT INTO catalog.venues
             (promoter_id, name, capacity, city, venue_type, address, country, created_at, last_modified_at)
           VALUES ($1, $2, $3, 'Praha', $4, $5, 'CZ', NOW(), NOW())
           RETURNING id`,
          [promoter.promoterId, venueName, capacity, venueType ?? 'seated', address ?? null],
        );
        venueId = ins.rows[0].id;
      }

      await markStepDone(promoter.promoterId, 2, { step2: { venueName, capacity, venueType, address, venueId } });
      return NextResponse.json({ venueId });
    }

    if (step === 3) {
      const { productionTitle, author, director, genre, description, posterUrl } = body as {
        productionTitle?: string;
        author?: string;
        director?: string;
        genre?: string;
        description?: string;
        posterUrl?: string;
      };

      if (!productionTitle || !genre) {
        return NextResponse.json({ error: 'MISSING_REQUIRED', fields: ['productionTitle', 'genre'] }, { status: 422 });
      }

      const baseSlug = slugify(productionTitle);
      const slug = `${baseSlug}-${randomBytes(3).toString('hex')}`;

      const ins = await db().query<{ id: string }>(
        `INSERT INTO catalog.productions
           (promoter_id, title, slug, author, director, genre, description, poster_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         RETURNING id`,
        [promoter.promoterId, productionTitle, slug, author ?? null, director ?? null, genre, description ?? null, posterUrl ?? null],
      );

      const productionId = ins.rows[0].id;
      await markStepDone(promoter.promoterId, 3, { step3: { productionTitle, author, director, genre, description, posterUrl, productionId } });
      return NextResponse.json({ productionId });
    }

    if (step === 4) {
      const { productionId, venueId, dateStart, durationMinutes, intermissionMinutes } = body as {
        productionId?: string;
        venueId?: string;
        dateStart?: string;
        durationMinutes?: number;
        intermissionMinutes?: number;
      };

      if (!productionId || !venueId || !dateStart) {
        return NextResponse.json({ error: 'MISSING_REQUIRED', fields: ['productionId', 'venueId', 'dateStart'] }, { status: 422 });
      }

      const prod = await db().query<{ title: string }>(
        `SELECT title FROM catalog.productions WHERE id = $1 AND promoter_id = $2`,
        [productionId, promoter.promoterId],
      );
      if (prod.rows.length === 0) {
        return NextResponse.json({ error: 'PRODUCTION_NOT_FOUND' }, { status: 404 });
      }

      const title = prod.rows[0].title;
      const baseSlug = slugify(title);
      const slug = `${baseSlug}-${randomBytes(3).toString('hex')}`;

      const ins = await db().query<{ id: string }>(
        `INSERT INTO catalog.events
           (promoter_id, organizer_id, venue_id, production_id, title,
            date_start, date_end,
            duration_minutes, intermission_minutes,
            status, currency, slug,
            event_type, category, qr_policy, vat_category,
            resale_allowed, max_tickets_per_order,
            refund_deadline_days, refund_fee_pct,
            created_at, updated_at)
         VALUES
           ($1, $1, $2, $3, $4,
            $5, $5::timestamptz + ($6 || ' minutes')::interval,
            $6, $7,
            'draft', 'CZK', $8,
            'concert', 'divadlo', 'static', 'entertainment',
            true, 10,
            14, 0,
            NOW(), NOW())
         RETURNING id`,
        [
          promoter.promoterId,
          venueId,
          productionId,
          title,
          dateStart,
          durationMinutes ?? 90,
          intermissionMinutes ?? null,
          slug,
        ],
      );

      const eventId = ins.rows[0].id;
      await markStepDone(promoter.promoterId, 4, { step4: { productionId, venueId, dateStart, durationMinutes, intermissionMinutes, eventId } });
      return NextResponse.json({ eventId });
    }

    if (step === 5) {
      const { eventId, ticketTypes } = body as {
        eventId?: string;
        ticketTypes?: Array<{ name: string; priceHalire: number; quantity: number; description?: string }>;
      };

      if (!eventId || !ticketTypes || ticketTypes.length === 0) {
        return NextResponse.json({ error: 'MISSING_REQUIRED', fields: ['eventId', 'ticketTypes'] }, { status: 422 });
      }

      const evCheck = await db().query(
        `SELECT id FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
        [eventId, promoter.promoterId],
      );
      if (evCheck.rows.length === 0) {
        return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
      }

      const limited = ticketTypes.slice(0, 5);
      const ticketTypeIds: string[] = [];

      for (const tt of limited) {
        const r = await db().query<{ id: string }>(
          `INSERT INTO catalog.ticket_types
             (event_id, name, description, base_price, total_qty, remaining_qty, visibility, is_seated)
           VALUES ($1, $2, $3, $4, $5, $5, 'public', false)
           RETURNING id`,
          [eventId, tt.name, tt.description ?? null, tt.priceHalire, tt.quantity],
        );
        ticketTypeIds.push(r.rows[0].id);
      }

      await markStepDone(promoter.promoterId, 5, { step5: { eventId, ticketTypes: limited, ticketTypeIds } });
      return NextResponse.json({ ticketTypeIds });
    }

    if (step === 6) {
      const { iban, bankName } = body as { iban?: string; bankName?: string };

      if (!iban) {
        return NextResponse.json({ error: 'MISSING_REQUIRED', fields: ['iban'] }, { status: 422 });
      }

      await db().query(
        `UPDATE platform.promoters SET iban = $2, bank_name = $3, updated_at = NOW() WHERE id = $1`,
        [promoter.promoterId, iban, bankName ?? null],
      );

      await markStepDone(promoter.promoterId, 6, { step6: { iban, bankName } });
      return NextResponse.json({ ok: true });
    }

    if (step === 7) {
      const { emails } = body as { emails?: string[] };
      const list = (emails ?? []).filter((e) => typeof e === 'string' && e.includes('@'));

      let invited = 0;
      for (const email of list.slice(0, 20)) {
        try {
          const token = randomBytes(24).toString('hex');
          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
          await db().query(
            `INSERT INTO platform.team_invites
               (promoter_id, invited_by_user_id, email, role, token, expires_at)
             VALUES ($1, $2, $3, 'staff'::platform.member_role, $4, $5)
             ON CONFLICT DO NOTHING`,
            [promoter.promoterId, promoter.userId, email, token, expiresAt],
          );
          invited++;
        } catch {
          console.log(`Staff invite: ${email}`);
        }
      }

      await markStepDone(promoter.promoterId, 7, { step7: { emails: list, invited } });
      return NextResponse.json({ invited });
    }

    // Step 8 — eIDAS T&C acceptance (required before KYC submission)
    if (step === 8) {
      const { documentContent, locale } = body as {
        documentContent?: string;
        locale?: string;
      };

      if (!documentContent || documentContent.length < 100) {
        return NextResponse.json({ error: 'DOCUMENT_CONTENT_REQUIRED' }, { status: 400 });
      }

      const rawIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
      const userAgent = req.headers.get('user-agent') ?? undefined;

      const docs: DocumentType[] = ['terms_of_service', 'promoter_contract', 'dpa'];
      for (const docType of docs) {
        const sig = buildESignatureRecord({
          userId: promoter.userId,
          promoterId: promoter.promoterId,
          documentType: docType,
          documentContent,
          rawIp,
          userAgent,
          locale: locale ?? 'cs',
        });

        await db().query(
          `INSERT INTO compliance.e_signatures
             (user_id, promoter_id, document_type, document_version, document_hash,
              ip_address, user_agent, locale, signature_method)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT DO NOTHING`,
          [
            sig.userId,
            sig.promoterId,
            sig.documentType,
            sig.documentVersion,
            sig.documentHash,
            sig.ipAddress,
            sig.userAgent,
            sig.locale,
            sig.signatureMethod,
          ],
        );
      }

      // Record on onboarding row
      await db().query(
        `UPDATE platform.promoter_onboarding
         SET terms_accepted_at = NOW(), terms_version = $2, terms_ip = $3
         WHERE promoter_id = $1`,
        [promoter.promoterId, '2026-06', rawIp ? rawIp.replace(/\.\d+$/, '.0') : null],
      );

      await markStepDone(promoter.promoterId, 8, { step8: { termsAccepted: true, docs } });
      return NextResponse.json({ ok: true, termsAccepted: true });
    }

    return NextResponse.json({ error: 'INVALID_STEP' }, { status: 400 });
  });
}
