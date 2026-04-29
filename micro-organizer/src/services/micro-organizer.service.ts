import crypto from 'crypto';
import type { ServiceDeps } from '../lib/service-container.js';
import { MicroOrganizerError } from '../lib/micro-organizer-errors.js';
import {
  microOrganizerVerificationEmail,
  microOrganizerWelcomeEmail,
  eventPublishedEmail,
} from '../lib/email-templates.js';
import type { RegisterMicroOrganizerInput, CreateMicroEventInput } from '../lib/zod-schemas.js';
import type { MicroOrganizer, MicroEvent } from '../types/micro-organizer.js';

// ---------------------------------------------------------------------------
// Bcrypt dependency — injected so tests can mock it
// ---------------------------------------------------------------------------
export interface BcryptLike {
  hash(data: string, saltOrRounds: string | number): Promise<string>;
  compare(data: string, encrypted: string): Promise<boolean>;
}

let _bcrypt: BcryptLike | null = null;

export function setBcrypt(b: BcryptLike): void {
  _bcrypt = b;
}

async function hashPassword(password: string): Promise<string> {
  if (_bcrypt) {
    return _bcrypt.hash(password, 12);
  }
  const bcrypt = await import('bcrypt');
  return bcrypt.hash(password, 12);
}

// ---------------------------------------------------------------------------
// Konstanty
// ---------------------------------------------------------------------------
const VERIFICATION_EXPIRY_SECONDS = 24 * 60 * 60; // 24 hodin
const RESEND_RATE_LIMIT = 3;
const RESEND_RATE_LIMIT_WINDOW_SECONDS = 60 * 60; // 1 hodina
const MAX_ACTIVE_EVENTS = 3;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.tixly.cz';

// ---------------------------------------------------------------------------
// Pomocné funkce
// ---------------------------------------------------------------------------
function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

function buildTicketUrl(ticketLinkToken: string): string {
  return `${APP_URL}/e/${ticketLinkToken}`;
}

function buildVerificationUrl(token: string): string {
  return `${APP_URL}/overit-email?token=${token}`;
}

// ---------------------------------------------------------------------------
// DB row typy
// ---------------------------------------------------------------------------
interface OrganizerRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  password_hash: string;
  email_verified: boolean;
  status: 'active' | 'suspended';
  created_at: string;
}

interface EmailVerificationRow {
  id: string;
  organizer_id: string;
  email: string;
  token: string;
  is_used: boolean;
  expires_at: string;
}

interface EventRow {
  id: string;
  organizer_id: string;
  name: string;
  date_time: string;
  venue_name: string;
  city: string;
  capacity_total: number;
  ticket_price_halire: number;
  status: 'draft' | 'published' | 'cancelled';
  ticket_link_token: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// 1. Registrace + odeslání ověřovacího e-mailu
// ---------------------------------------------------------------------------
export async function registerMicroOrganizer(
  input: RegisterMicroOrganizerInput,
  deps: ServiceDeps,
): Promise<{ organizerId: string }> {
  const { db, email } = deps;

  // Ověřit, zda e-mail ještě není zaregistrován
  const existing = await db.query<{ id: string }>(
    'SELECT id FROM platform.micro_organizers WHERE email = $1 LIMIT 1',
    [input.email],
  );
  if (existing.length > 0) {
    throw new MicroOrganizerError('EMAIL_ALREADY_REGISTERED');
  }

  const passwordHash = await hashPassword(input.password);
  const organizerId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    // Vytvořit pořadatele
    await tx.execute(
      `INSERT INTO platform.micro_organizers
         (id, first_name, last_name, email, password_hash, email_verified, status, created_at)
       VALUES ($1, $2, $3, $4, $5, false, 'active', NOW())`,
      [organizerId, input.firstName, input.lastName, input.email, passwordHash],
    );

    // Vytvořit ověřovací token
    const token = generateToken(32);
    const expiresAt = new Date(Date.now() + VERIFICATION_EXPIRY_SECONDS * 1000).toISOString();

    await tx.execute(
      `INSERT INTO platform.micro_email_verifications
         (id, organizer_id, email, token, is_used, expires_at, created_at)
       VALUES ($1, $2, $3, $4, false, $5, NOW())`,
      [crypto.randomUUID(), organizerId, input.email, token, expiresAt],
    );

    // Odeslat ověřovací e-mail
    const verificationUrl = buildVerificationUrl(token);
    const html = microOrganizerVerificationEmail(input.email, verificationUrl);
    await email.send(input.email, 'Ověřte svůj e-mail — Tixly', html);
  });

  return { organizerId };
}

// ---------------------------------------------------------------------------
// 2. Ověření e-mailu + aktivace účtu
// ---------------------------------------------------------------------------
export async function verifyMicroOrganizerEmail(
  token: string,
  deps: ServiceDeps,
): Promise<{ organizerId: string; email: string }> {
  const { db } = deps;

  const rows = await db.query<EmailVerificationRow>(
    `SELECT id, organizer_id, email, token, is_used, expires_at
       FROM platform.micro_email_verifications
      WHERE token = $1
      LIMIT 1`,
    [token],
  );

  if (rows.length === 0) {
    throw new MicroOrganizerError('VERIFICATION_TOKEN_INVALID');
  }

  const verification = rows[0]!;

  if (verification.is_used) {
    throw new MicroOrganizerError('VERIFICATION_TOKEN_USED');
  }

  if (new Date(verification.expires_at) < new Date()) {
    throw new MicroOrganizerError('VERIFICATION_TOKEN_EXPIRED');
  }

  await db.transaction(async (tx) => {
    // Označit token jako použitý
    await tx.execute(
      `UPDATE platform.micro_email_verifications
          SET is_used = true
        WHERE id = $1`,
      [verification.id],
    );

    // Aktivovat účet
    await tx.execute(
      `UPDATE platform.micro_organizers
          SET email_verified = true
        WHERE id = $1`,
      [verification.organizer_id],
    );
  });

  return { organizerId: verification.organizer_id, email: verification.email };
}

// ---------------------------------------------------------------------------
// 3. Vytvoření a zveřejnění akce (max 3 aktivní)
// ---------------------------------------------------------------------------
export async function createMicroEvent(
  organizerId: string,
  input: CreateMicroEventInput,
  deps: ServiceDeps,
): Promise<{ eventId: string; ticketUrl: string }> {
  const { db, email } = deps;

  // Ověřit existenci a aktivaci pořadatele
  const organizers = await db.query<OrganizerRow>(
    `SELECT id, first_name, email_verified
       FROM platform.micro_organizers
      WHERE id = $1
      LIMIT 1`,
    [organizerId],
  );

  if (organizers.length === 0) {
    throw new MicroOrganizerError('ORGANIZER_NOT_FOUND');
  }

  const organizer = organizers[0]!;

  if (!organizer.email_verified) {
    throw new MicroOrganizerError('EMAIL_NOT_VERIFIED');
  }

  // Zkontrolovat limit aktivních akcí
  const activeCountRows = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count
       FROM platform.micro_events
      WHERE organizer_id = $1
        AND status IN ('draft', 'published')`,
    [organizerId],
  );

  const activeCount = parseInt(activeCountRows[0]?.count ?? '0', 10);
  if (activeCount >= MAX_ACTIVE_EVENTS) {
    throw new MicroOrganizerError('EVENT_LIMIT_REACHED');
  }

  const eventId = crypto.randomUUID();
  const ticketLinkToken = generateToken(32); // 64 hex znaků
  const ticketUrl = buildTicketUrl(ticketLinkToken);

  await db.execute(
    `INSERT INTO platform.micro_events
       (id, organizer_id, name, date_time, venue_name, city,
        capacity_total, ticket_price_halire, status, ticket_link_token, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published', $9, NOW())`,
    [
      eventId,
      organizerId,
      input.name,
      input.dateTime,
      input.venueName,
      input.city,
      input.capacityTotal,
      input.ticketPriceHalire,
      ticketLinkToken,
    ],
  );

  // Odeslat e-mail o zveřejnění akce
  const organizerData = await db.query<{ first_name: string; last_name: string; email: string }>(
    `SELECT first_name, last_name, email
       FROM platform.micro_organizers
      WHERE id = $1
      LIMIT 1`,
    [organizerId],
  );

  if (organizerData.length > 0) {
    const org = organizerData[0]!;
    const fullName = `${org.first_name} ${org.last_name}`;
    const html = eventPublishedEmail(fullName, input.name, ticketUrl);
    await email.send(org.email, `Akce „${input.name}" je online — Tixly`, html);
  }

  return { eventId, ticketUrl };
}

// ---------------------------------------------------------------------------
// 4. Seznam akcí pořadatele
// ---------------------------------------------------------------------------
export async function listMicroEvents(
  organizerId: string,
  deps: ServiceDeps,
): Promise<MicroEvent[]> {
  const { db } = deps;

  // Ověřit existenci pořadatele
  const organizers = await db.query<{ id: string }>(
    'SELECT id FROM platform.micro_organizers WHERE id = $1 LIMIT 1',
    [organizerId],
  );

  if (organizers.length === 0) {
    throw new MicroOrganizerError('ORGANIZER_NOT_FOUND');
  }

  const rows = await db.query<EventRow>(
    `SELECT id, organizer_id, name, date_time, venue_name, city,
            capacity_total, ticket_price_halire, status, ticket_link_token, created_at
       FROM platform.micro_events
      WHERE organizer_id = $1
      ORDER BY date_time ASC`,
    [organizerId],
  );

  return rows.map((row) => ({
    id: row.id,
    organizerId: row.organizer_id,
    name: row.name,
    dateTime: row.date_time,
    venueName: row.venue_name,
    city: row.city,
    capacityTotal: row.capacity_total,
    ticketPriceHalire: row.ticket_price_halire,
    status: row.status,
    ticketLinkToken: row.ticket_link_token,
    createdAt: row.created_at,
  }));
}

// ---------------------------------------------------------------------------
// 5. Žádost o upgrade na plného promotéra (emituje Kafka event)
// ---------------------------------------------------------------------------
export async function requestUpgrade(
  organizerId: string,
  deps: ServiceDeps,
): Promise<void> {
  const { db, kafka } = deps;

  const organizers = await db.query<OrganizerRow>(
    `SELECT id, first_name, last_name, email, email_verified
       FROM platform.micro_organizers
      WHERE id = $1
      LIMIT 1`,
    [organizerId],
  );

  if (organizers.length === 0) {
    throw new MicroOrganizerError('ORGANIZER_NOT_FOUND');
  }

  const organizer = organizers[0]!;

  if (!organizer.email_verified) {
    throw new MicroOrganizerError('EMAIL_NOT_VERIFIED');
  }

  await kafka.send('micro_organizer.upgrade_requested', {
    organizerId: organizer.id,
    email: organizer.email,
    firstName: organizer.first_name,
    lastName: organizer.last_name,
    requestedAt: new Date().toISOString(),
  });
}
