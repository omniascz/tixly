/**
 * POST /api/admin/scanner/validate
 *
 * Body: { ticketId: string, totpCode?: string }
 *
 * Demo scanner flow:
 *   1. Najde ticket podle ID
 *   2. Ověří, že promotér vidí svůj lístek (přes events.promoter_id)
 *   3. Pokud `totpCode` poslán → ověří proti TOTP secret (RFC 6238, 30s window, ±1)
 *   4. Pokud status='valid' → status='used', used_at=NOW()
 *   5. Idempotent na used: vrátí "already used" + původní timestamp
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';
import { decryptSecret } from '@/lib/crypto';
import { verifyTotpCode } from '@/lib/totp/verify';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({
  ticketId: z.string().regex(/^[0-9a-f-]{36}$/i, 'Neplatný ticket ID'),
  totpCode: z.string().regex(/^\d{6}$/, 'TOTP musí být 6 číslic').optional(),
  // Day-aware + zone-aware (volitelné pro single events)
  eventDayId: z.string().uuid().nullable().optional(),
  zoneId: z.string().uuid().nullable().optional(),
});

interface TicketRow {
  id: string;
  status: string;
  used_at: string | null;
  revoked_at: string | null;
  totp_secret_encrypted: Buffer;
  ticket_type_id: string;
  ticket_type_name: string;
  event_id: string;
  event_title: string;
  event_date_start: string | null;
  event_promoter_id: string;
  event_qr_policy: string;
  buyer_email: string;
  buyer_name: string | null;
}

interface AccessRow {
  event_day_id: string | null;
  zone_id: string | null;
  access_level: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const r = await client.query<TicketRow>(
      `SELECT t.id, t.status, t.used_at, t.revoked_at, t.totp_secret_encrypted,
              t.ticket_type_id,
              tt.name AS ticket_type_name,
              e.id AS event_id,
              e.title AS event_title,
              e.date_start AS event_date_start,
              e.promoter_id AS event_promoter_id,
              e.qr_policy AS event_qr_policy,
              u.email AS buyer_email,
              u.name AS buyer_name
       FROM tickets.tickets t
       JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
       JOIN orders.orders o ON o.id = t.order_id
       JOIN catalog.events e ON e.id = o.event_id
       JOIN identity.users u ON u.id = t.owner_id
       WHERE t.id = $1
       FOR UPDATE`,
      [parsed.data.ticketId],
    );

    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { result: 'not_found', message: 'Lístek nenalezen.' },
        { status: 404 },
      );
    }
    const t = r.rows[0];

    if (t.event_promoter_id !== promoter.promoterId) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { result: 'wrong_promoter', message: 'Lístek patří k jinému promotérovi.' },
        { status: 403 },
      );
    }

    // QR policy enforcement (migrace 265):
    //   static_allowed  → TOTP volitelný (offline/static QR funguje vždy)
    //   rotating_24h    → TOTP volitelný DO 24h před akcí, pak POVINNÝ
    //   rotating_only   → TOTP POVINNÝ vždy (jen mobile QR)
    //   photo_required  → TOTP POVINNÝ + foto check ručně u brány
    const qrPolicy = t.event_qr_policy ?? 'static_allowed';
    let totpRequired = qrPolicy === 'rotating_only' || qrPolicy === 'photo_required';
    if (qrPolicy === 'rotating_24h' && t.event_date_start) {
      const eventTimeMs = new Date(t.event_date_start).getTime();
      const twentyFourHoursMs = 24 * 60 * 60 * 1000;
      if (eventTimeMs - Date.now() <= twentyFourHoursMs) {
        totpRequired = true;
      }
    }

    if (totpRequired && !parsed.data.totpCode) {
      await client.query('ROLLBACK');
      const msg =
        qrPolicy === 'photo_required'
          ? 'Tento lístek vyžaduje rotující QR + fotokontrolu u brány. Použij mobilní vstupenku.'
          : qrPolicy === 'rotating_24h'
            ? 'Tato akce vyžaduje rotující QR od 24h před začátkem. PDF nestačí, použij mobilní vstupenku.'
            : 'Tato akce vyžaduje rotující QR. Použij mobilní vstupenku, ne PDF.';
      return NextResponse.json(
        { result: 'totp_required', qrPolicy, message: msg },
        { status: 401 },
      );
    }

    // Pokud byl předán TOTP, ověříme ho. Bez kódu povolujeme jen ID-based scan
    // (offline mode v reálném scanneru může spoléhat na neefemerní QR pro static_allowed).
    if (parsed.data.totpCode) {
      const secretB64 = decryptSecret(t.totp_secret_encrypted.toString('base64'));
      const secretRaw = Buffer.from(secretB64, 'base64');
      const ok = verifyTotpCode(parsed.data.totpCode, secretRaw, { window: 1 });
      if (!ok) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { result: 'totp_mismatch', message: 'TOTP kód neodpovídá.' },
          { status: 401 },
        );
      }
    }

    if (t.status === 'used') {
      await client.query('ROLLBACK');
      return NextResponse.json({
        result: 'already_used',
        usedAt: t.used_at,
        ticket: shortTicketInfo(t),
        message: `Lístek už byl použit ${new Date(t.used_at!).toLocaleString('cs-CZ')}.`,
      });
    }
    if (t.status === 'revoked') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          result: 'revoked',
          revokedAt: t.revoked_at,
          ticket: shortTicketInfo(t),
          message: 'Lístek byl zrušen (refund/transfer).',
        },
        { status: 409 },
      );
    }
    if (t.status !== 'valid') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { result: 'invalid_status', status: t.status, message: `Neočekávaný stav: ${t.status}` },
        { status: 409 },
      );
    }

    // Day+zone aware access check (Fáze B + Fáze C modular fallthrough).
    // Priorita:
    //   1) Per-ticket modular access (tickets.ticket_modular_access) — buyer si
    //      v build-your-own-pass UI vybral konkrétní (day × zone) kombinace.
    //      Pokud řádky existují, validujeme PROTI NIM (ignorujeme ticket_type_access).
    //   2) Per-type access (catalog.ticket_type_access) — promoter-defined matrix
    //      pro pre-defined ticket types (festival "Day 1 pass", "Weekend all-access").
    //   3) Žádné access entries v ani jedné tabulce → legacy single-event ticket,
    //      povolíme bez kontroly (backward compat).
    if (parsed.data.eventDayId || parsed.data.zoneId) {
      // 1) Check modular per-ticket overrides first
      const modularRows = await client.query<{
        event_day_id: string;
        zone_id: string;
      }>(
        `SELECT event_day_id, zone_id
         FROM tickets.ticket_modular_access
         WHERE ticket_id = $1`,
        [t.id],
      );
      if (modularRows.rows.length > 0) {
        const hasMatch = modularRows.rows.some(
          (a) =>
            (parsed.data.eventDayId === undefined ||
              a.event_day_id === parsed.data.eventDayId) &&
            (parsed.data.zoneId === undefined || a.zone_id === parsed.data.zoneId),
        );
        if (!hasMatch) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            {
              result: 'wrong_zone_or_day',
              ticket: shortTicketInfo(t),
              message:
                'Lístek (modular pass) nemá přístup do této zóny nebo na tento den.',
            },
            { status: 403 },
          );
        }
      } else {
        // 2) Fallback na ticket_type_access matrix
        const accessRows = await client.query<AccessRow>(
          `SELECT event_day_id, zone_id, access_level
           FROM catalog.ticket_type_access
           WHERE ticket_type_id = $1`,
          [t.ticket_type_id],
        );
        if (accessRows.rows.length > 0) {
          const hasMatch = accessRows.rows.some((a) => {
            const dayMatch =
              a.event_day_id === null ||
              (parsed.data.eventDayId !== undefined && a.event_day_id === parsed.data.eventDayId);
            const zoneMatch =
              a.zone_id === null ||
              (parsed.data.zoneId !== undefined && a.zone_id === parsed.data.zoneId);
            return dayMatch && zoneMatch;
          });
          if (!hasMatch) {
            await client.query('ROLLBACK');
            return NextResponse.json(
              {
                result: 'wrong_zone_or_day',
                ticket: shortTicketInfo(t),
                message:
                  'Lístek nemá přístup do této zóny nebo na tento den. Zkontroluj typ vstupenky.',
              },
              { status: 403 },
            );
          }
        }
      }
    }

    // Multi-day pass detection (Fáze D):
    //   Pokud scanner posílá eventDayId, neukončíme ticket, ale založíme redemption.
    //   Pak zkontrolujeme, jestli kupec už nepřesáhl flex_pass picks_required.
    if (parsed.data.eventDayId) {
      // 1) Existující redemption pro (ticket, day)?
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM tickets.ticket_redemptions
         WHERE ticket_id = $1 AND event_day_id = $2`,
        [t.id, parsed.data.eventDayId],
      );
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({
          result: 'already_redeemed_today',
          ticket: shortTicketInfo(t),
          message: 'Pro tento den už byl lístek použit (per-day check-in).',
        });
      }

      // 2) Flex pass limit?
      const flex = await client.query<{ picks_required: number; pass_kind: string }>(
        `SELECT picks_required, pass_kind FROM catalog.flex_pass_settings
         WHERE ticket_type_id = $1`,
        [t.ticket_type_id],
      );
      if (flex.rows.length > 0 && flex.rows[0].pass_kind === 'flex') {
        const used = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM tickets.ticket_redemptions WHERE ticket_id = $1`,
          [t.id],
        );
        const usedCount = Number(used.rows[0]?.count ?? 0);
        if (usedCount >= flex.rows[0].picks_required) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            {
              result: 'flex_limit_exhausted',
              ticket: shortTicketInfo(t),
              picksRequired: flex.rows[0].picks_required,
              picksUsed: usedCount,
              message: `Flex pass už vyčerpán (${usedCount}/${flex.rows[0].picks_required}).`,
            },
            { status: 409 },
          );
        }

        // Pokud kupec udělal upfront picks, musí scan-day patřit mezi ně
        const picks = await client.query<{ event_day_id: string }>(
          `SELECT event_day_id FROM tickets.ticket_picks WHERE ticket_id = $1`,
          [t.id],
        );
        if (picks.rows.length > 0) {
          const allowed = picks.rows.some((p) => p.event_day_id === parsed.data.eventDayId);
          if (!allowed) {
            await client.query('ROLLBACK');
            return NextResponse.json(
              {
                result: 'day_not_picked',
                ticket: shortTicketInfo(t),
                message: 'Tento den není mezi vybranými termíny flex passu.',
              },
              { status: 403 },
            );
          }
        }
      }

      // 3) INSERT redemption — ticket zůstává valid pro další dni
      await client.query(
        `INSERT INTO tickets.ticket_redemptions
           (ticket_id, event_day_id, zone_id, scanned_by_user_id)
         VALUES ($1, $2, $3, $4)`,
        [t.id, parsed.data.eventDayId, parsed.data.zoneId ?? null, promoter.userId],
      );

      // Pokud je to flex a poslední redemption, můžeme ticket terminovat
      if (flex.rows.length > 0 && flex.rows[0].pass_kind === 'flex') {
        const usedNow = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM tickets.ticket_redemptions WHERE ticket_id = $1`,
          [t.id],
        );
        const usedNowCount = Number(usedNow.rows[0]?.count ?? 0);
        if (usedNowCount >= flex.rows[0].picks_required) {
          await client.query(
            `UPDATE tickets.tickets SET status = 'used', used_at = NOW() WHERE id = $1`,
            [t.id],
          );
        }
      }

      await client.query('COMMIT');
      return NextResponse.json({
        result: 'admitted',
        kind: 'multi_day_redemption',
        ticket: shortTicketInfo(t),
        admittedAt: new Date().toISOString(),
      });
    }

    // Single-event flow: terminační check-in (jako dosud)
    await client.query(
      `UPDATE tickets.tickets SET status = 'used', used_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [t.id],
    );
    await client.query('COMMIT');

    return NextResponse.json({
      result: 'admitted',
      kind: 'single_use',
      ticket: shortTicketInfo(t),
      admittedAt: new Date().toISOString(),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /api/admin/scanner/validate]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}

function shortTicketInfo(t: TicketRow) {
  return {
    ticketId: t.id,
    eventTitle: t.event_title,
    ticketTypeName: t.ticket_type_name,
    holderEmail: t.buyer_email,
    holderName: t.buyer_name,
  };
}

