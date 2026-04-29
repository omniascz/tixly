// Verified Fan Service — registrace fanů, selekce, vydání přístupových odkazů.
//
// Flow:
//   1. Promotér vytvoří VF config (createConfig)
//   2. Fani se registrují v registračním okně (register)
//   3. V čase selectionAt proběhne výběr (runSelection) — cron nebo manuálně
//   4. Vybraní fani dostanou email s personalizovaným linkem
//   5. Fan klikne na link → redeemAccessLink → dostane přístup k presale

import { generateAccessToken, verifyAccessToken, markTokenUsed } from '../lib/access-token';
import type { RedisAdapter } from '../lib/access-token';
import { computeFanWeight, selectFans, type FanWeightInputs } from '../lib/selection-algorithm';
import {
  RegistrationClosedError,
  AlreadyRegisteredError,
  NotSelectedException,
} from '../types/verified-fan.types';
import type {
  VerifiedFanConfig,
  FanRegistration,
  SelectionResult,
  SelectionMethod,
  AccessLinkPayload,
} from '../types/verified-fan.types';
import { withTenantContext } from '@tixly/rls-multitenancy';
import type { DbAdapter } from '@tixly/rls-multitenancy';

interface KafkaAdapter {
  send(topic: string, payload: unknown): Promise<void>;
}

interface EmailAdapter {
  send(to: string, subject: string, html: string): Promise<void>;
}

/**
 * Adapter bridging to the `identity-verification` module.
 * Optional — if not provided, anti-abuse identity gating is skipped.
 */
export interface IdentityAdapter {
  /** Returns { verified, identityHash } for a given userId. */
  getStatus(userId: string): Promise<{ verified: boolean; identityHash?: string } | null>;
}

interface ServiceDeps {
  db: DbAdapter;
  redis: RedisAdapter;
  kafka: KafkaAdapter;
  email: EmailAdapter;
  identity?: IdentityAdapter;
}

// ---------------------------------------------------------------------------
// createConfig
// ---------------------------------------------------------------------------

export async function createConfig(
  deps: ServiceDeps,
  promoterId: string,
  config: Omit<VerifiedFanConfig, 'eventId'> & { eventId: string },
): Promise<VerifiedFanConfig> {
  return withTenantContext(deps.db, { promoterId, role: 'promoter' }, async (db) => {
    await db.execute(
      `INSERT INTO verified_fan.configs
         (event_id, presale_ticket_type_id, presale_price, slots,
          selection_method, registration_opens_at, registration_closes_at,
          selection_at, link_expires_after_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (event_id) DO UPDATE SET
         slots = EXCLUDED.slots,
         selection_method = EXCLUDED.selection_method,
         link_expires_after_hours = EXCLUDED.link_expires_after_hours`,
      [
        config.eventId,
        config.presaleTicketTypeId,
        config.presalePrice,
        config.slots,
        config.selectionMethod,
        config.registrationOpensAt,
        config.registrationClosesAt,
        config.selectionAt,
        config.linkExpiresAfterHours,
      ],
    );
    return config;
  });
}

// ---------------------------------------------------------------------------
// register — fan se přihlásí do VF programu
// ---------------------------------------------------------------------------

export async function register(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
  now: Date = new Date(),
): Promise<FanRegistration> {
  return withTenantContext(deps.db, { userId, role: 'buyer' }, async (db) => {
    // Načti config
    const [cfg] = await db.query<{
      registration_opens_at: Date;
      registration_closes_at: Date;
      event_id: string;
    }>(
      `SELECT registration_opens_at, registration_closes_at, event_id
         FROM verified_fan.configs WHERE event_id = $1`,
      [eventId],
    );

    if (!cfg) throw new RegistrationClosedError(`Verified Fan program pro akci ${eventId} neexistuje.`);

    if (now < cfg.registration_opens_at || now > cfg.registration_closes_at) {
      throw new RegistrationClosedError('Registrace není momentálně otevřena.');
    }

    // Anti-abuse: if identity-verification adapter is wired in, require
    // a verified identity and reject if the same identity hash has already
    // been used to register for this event under a different user account.
    if (deps.identity) {
      const status = await deps.identity.getStatus(userId);
      if (!status || !status.verified) {
        throw new AlreadyRegisteredError('Identita není ověřena (BankID).');
      }
      if (status.identityHash) {
        const [dup] = await db.query<{ user_id: string }>(
          `SELECT user_id FROM verified_fan.registrations
             WHERE event_id = $1 AND identity_hash = $2 AND user_id <> $3
             LIMIT 1`,
          [eventId, status.identityHash, userId],
        );
        if (dup) {
          throw new AlreadyRegisteredError(
            'Tato identita je pro danou akci již registrována.',
          );
        }
      }
    }

    // Idempotentní INSERT — ignoruje duplicitu
    const rows = await db.query<{ id: string; status: string; registered_at: Date }>(
      `INSERT INTO verified_fan.registrations (event_id, user_id, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (event_id, user_id) DO NOTHING
       RETURNING id, status, registered_at`,
      [eventId, userId],
    );

    if (rows.length === 0) {
      // Již registrován — načteme existující záznam
      const [existing] = await db.query<{ id: string; status: string; registered_at: Date }>(
        `SELECT id, status, registered_at FROM verified_fan.registrations
         WHERE event_id = $1 AND user_id = $2`,
        [eventId, userId],
      );
      if (!existing) throw new AlreadyRegisteredError('Již jsi registrován.');
      return mapRow(existing, eventId, userId);
    }

    deps.kafka.send('tixly.verified-fan.registered', { eventId, userId }).catch(() => {});

    return mapRow(rows[0], eventId, userId);
  });
}

// ---------------------------------------------------------------------------
// runSelection — vybere sloty fanů podle zvolené metody
// ---------------------------------------------------------------------------

export async function runSelection(
  deps: ServiceDeps,
  eventId: string,
  now: Date = new Date(),
): Promise<SelectionResult> {
  return withTenantContext(deps.db, { role: 'service' }, async (db) => {
    const [cfg] = await db.query<{
      slots: number;
      selection_method: SelectionMethod;
      link_expires_after_hours: number;
      presale_ticket_type_id: string;
    }>(
      `SELECT slots, selection_method, link_expires_after_hours, presale_ticket_type_id
         FROM verified_fan.configs WHERE event_id = $1`,
      [eventId],
    );

    if (!cfg) throw new Error(`Config pro akci ${eventId} nenalezen.`);

    const [{ total }] = await db.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM verified_fan.registrations
       WHERE event_id = $1 AND status = 'pending'`,
      [eventId],
    );

    // ORDER BY závisí na metodě výběru
    const orderBy: Record<string, string> = {
      fifo: 'registered_at ASC',
      random: 'RANDOM()',
      points: 'loyalty_points DESC, registered_at ASC',
    };

    // Vyber sloty — atomická transakce
    await db.transaction(async (tx) => {
      let selected: { id: string; user_id: string }[];

      if (cfg.selection_method === 'weighted') {
        // Weighted selection: načti metadata fanů, spočítej skóre, vyber top N
        const candidates = await tx.query<{
          id: string;
          user_id: string;
          registered_at: Date;
          loyalty_years: number;
          past_purchases: number;
          identity_verified: boolean;
          local_fan: boolean;
          social_followers: number;
        }>(
          `SELECT r.id, r.user_id, r.registered_at,
                  COALESCE(r.loyalty_years, 0) AS loyalty_years,
                  COALESCE(r.past_purchases, 0) AS past_purchases,
                  COALESCE(r.identity_verified, false) AS identity_verified,
                  COALESCE(r.local_fan, false) AS local_fan,
                  COALESCE(r.social_followers, 0) AS social_followers
           FROM verified_fan.registrations r
           WHERE r.event_id = $1 AND r.status = 'pending'
           FOR UPDATE SKIP LOCKED`,
          [eventId],
        );

        const inputs: FanWeightInputs[] = candidates.map((c) => ({
          fanId: c.id,
          loyaltyYears: c.loyalty_years,
          pastPurchases: c.past_purchases,
          identityVerified: c.identity_verified,
          localFan: c.local_fan,
          socialFollowers: c.social_followers,
          registeredAt: c.registered_at,
        }));

        const registrationOpensAt = (await tx.query<{ registration_opens_at: Date }>(
          `SELECT registration_opens_at FROM verified_fan.configs WHERE event_id = $1`,
          [eventId],
        ))[0]?.registration_opens_at ?? now;

        const weights = inputs.map((i) => computeFanWeight(i, registrationOpensAt));
        const winners = selectFans(weights, cfg.slots);
        const winnerIds = new Set(winners.map((w) => w.fanId));

        selected = candidates
          .filter((c) => winnerIds.has(c.id))
          .map((c) => ({ id: c.id, user_id: c.user_id }));
      } else {
        selected = await tx.query<{ id: string; user_id: string }>(
          `SELECT id, user_id FROM verified_fan.registrations
           WHERE event_id = $1 AND status = 'pending'
           ORDER BY ${orderBy[cfg.selection_method]}
           LIMIT $2
           FOR UPDATE SKIP LOCKED`,
          [eventId, cfg.slots],
        );
      }

      // Generuj tokeny pro vybrané fany
      for (const row of selected) {
        const { token, expiresAt } = await generateAccessToken(
          {
            registrationId: row.id,
            eventId,
            userId: row.user_id,
            presaleTicketTypeId: cfg.presale_ticket_type_id,
          },
          cfg.link_expires_after_hours,
        );

        await tx.execute(
          `UPDATE verified_fan.registrations
           SET status = 'selected', access_token = $1, access_token_expires_at = $2
           WHERE id = $3`,
          [token, expiresAt, row.id],
        );

        // Email s linkem — fire and forget
        deps.email
          .send(
            row.user_id, // placeholder — reálně bychom načetli email z identity.users
            'Byl/a jsi vybrán/a! Presale přístup — Tixly',
            buildSelectionEmail(eventId, token),
          )
          .catch(() => {});
      }

      // Zbytek označit jako not_selected
      await tx.execute(
        `UPDATE verified_fan.registrations
         SET status = 'not_selected'
         WHERE event_id = $1 AND status = 'pending'`,
        [eventId],
      );
    });

    deps.kafka
      .send('tixly.verified-fan.selection-complete', { eventId, selectedCount: Math.min(cfg.slots, total), total })
      .catch(() => {});

    return {
      eventId,
      selectedCount: Math.min(cfg.slots, total),
      totalRegistrations: total,
      method: cfg.selection_method,
      selectedAt: now,
    };
  });
}

// ---------------------------------------------------------------------------
// redeemAccessLink — fan použije personalizovaný link → dostane presale přístup
// ---------------------------------------------------------------------------

export async function redeemAccessLink(
  deps: ServiceDeps,
  token: string,
): Promise<AccessLinkPayload> {
  // 1. Ověř JWT
  const payload = await verifyAccessToken(token);

  // 2. Označ jako použitý v Redisu (idempotence, single-use)
  await markTokenUsed(payload.registrationId, deps.redis);

  // 3. Aktualizuj DB
  await withTenantContext(deps.db, { role: 'service' }, async (db) => {
    await db.execute(
      `UPDATE verified_fan.registrations
       SET status = 'link_used', access_token_used_at = NOW()
       WHERE id = $1`,
      [payload.registrationId],
    );
  });

  deps.kafka
    .send('tixly.verified-fan.link-redeemed', { registrationId: payload.registrationId })
    .catch(() => {});

  return payload;
}

// ---------------------------------------------------------------------------
// getRegistrationStatus — fan zkontroluje svůj stav
// ---------------------------------------------------------------------------

export async function getRegistrationStatus(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
): Promise<FanRegistration | null> {
  return withTenantContext(deps.db, { userId, role: 'buyer' }, async (db) => {
    const [row] = await db.query<{
      id: string;
      status: string;
      registered_at: Date;
      access_token_expires_at?: Date;
    }>(
      `SELECT id, status, registered_at, access_token_expires_at
         FROM verified_fan.registrations
         WHERE event_id = $1 AND user_id = $2`,
      [eventId, userId],
    );

    if (!row) return null;
    return mapRow(row, eventId, userId);
  });
}

// ---------------------------------------------------------------------------
// listRegistrations — promotér vidí přehled registrací
// ---------------------------------------------------------------------------

export async function listRegistrations(
  deps: ServiceDeps,
  promoterId: string,
  eventId: string,
): Promise<{ pending: number; selected: number; notSelected: number; linkUsed: number }> {
  return withTenantContext(deps.db, { promoterId, role: 'promoter' }, async (db) => {
    const rows = await db.query<{ status: string; count: number }>(
      `SELECT status, COUNT(*)::int AS count
         FROM verified_fan.registrations
         WHERE event_id = $1
         GROUP BY status`,
      [eventId],
    );

    const counts = Object.fromEntries(rows.map((r) => [r.status, r.count]));
    return {
      pending: counts['pending'] ?? 0,
      selected: counts['selected'] ?? 0,
      notSelected: counts['not_selected'] ?? 0,
      linkUsed: counts['link_used'] ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapRow(
  row: { id: string; status: string; registered_at: Date; access_token_expires_at?: Date },
  eventId: string,
  userId: string,
): FanRegistration {
  return {
    id: row.id,
    eventId,
    userId,
    loyaltyPoints: 0,
    registeredAt: row.registered_at,
    status: row.status as FanRegistration['status'],
    accessTokenExpiresAt: row.access_token_expires_at,
  };
}

function buildSelectionEmail(eventId: string, token: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tixly.cz';
  const link = `${baseUrl}/cs/presale?token=${encodeURIComponent(token)}`;
  return `
    <p>Gratulujeme! Byl/a jsi vybrán/a do Verified Fan presale.</p>
    <p>Klikni na odkaz níže pro nákup vstupenek — odkaz je jednorázový a časově omezený:</p>
    <p><a href="${link}">${link}</a></p>
    <p>Tixly team</p>
  `;
}
