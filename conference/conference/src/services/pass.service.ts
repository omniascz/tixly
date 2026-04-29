// =============================================================================
// Pass Service
//
// Covers: multi-day passes, activations, access checks
// DB schema: conference.multi_day_passes, conference.pass_activations
// All prices in halíře (INTEGER, never float)
// =============================================================================

import { ConferenceError } from '../lib/conference-errors';

// ---------------------------------------------------------------------------
// DB adapter
// ---------------------------------------------------------------------------

export interface PassDB {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PassType = 'full' | 'day' | 'track' | 'workshop';
export type PassStatus = 'draft' | 'active' | 'sold_out' | 'ended';

export interface CreatePassInput {
  name: string;
  description?: string;
  passType: PassType;
  daysIncluded: number[];
  tracksIncluded?: number[];
  priceHellers: number;
  saleStart?: string;
  saleEnd?: string;
  quantity?: number;
  status?: PassStatus;
}

export interface MultiDayPass {
  id: string;
  eventId: string;
  name: string;
  description: string | null;
  passType: PassType;
  daysIncluded: number[];
  tracksIncluded: number[] | null;
  priceHellers: number;
  saleStart: string | null;
  saleEnd: string | null;
  quantity: number | null;
  quantitySold: number;
  status: PassStatus;
  createdAt: string;
}

export interface PassActivation {
  id: string;
  passId: string;
  userId: string;
  orderId: string | null;
  activatedAt: string;
  accessToken: string;
}

export interface PassActivationWithPass extends PassActivation {
  pass: MultiDayPass;
}

export interface PassAccessResult {
  activation: PassActivation;
  pass: MultiDayPass;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface PassRow {
  id: string;
  event_id: string;
  name: string;
  description: string | null;
  pass_type: string;
  days_included: number[];
  tracks_included: number[] | null;
  price_hellers: number;
  sale_start: string | null;
  sale_end: string | null;
  quantity: number | null;
  quantity_sold: number;
  status: string;
  created_at: string;
}

interface ActivationRow {
  id: string;
  pass_id: string;
  user_id: string;
  order_id: string | null;
  activated_at: string;
  access_token: string;
}

interface ActivationWithPassRow extends ActivationRow {
  pass_name: string;
  pass_type: string;
  event_id: string;
  days_included: number[];
  tracks_included: number[] | null;
  price_hellers: number;
  sale_start: string | null;
  sale_end: string | null;
  quantity: number | null;
  quantity_sold: number;
  pass_status: string;
  pass_created_at: string;
  pass_description: string | null;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapPass(row: PassRow): MultiDayPass {
  return {
    id: row.id,
    eventId: row.event_id,
    name: row.name,
    description: row.description,
    passType: row.pass_type as PassType,
    daysIncluded: row.days_included ?? [],
    tracksIncluded: row.tracks_included,
    priceHellers: row.price_hellers,
    saleStart: row.sale_start,
    saleEnd: row.sale_end,
    quantity: row.quantity,
    quantitySold: row.quantity_sold,
    status: row.status as PassStatus,
    createdAt: row.created_at,
  };
}

function mapActivation(row: ActivationRow): PassActivation {
  return {
    id: row.id,
    passId: row.pass_id,
    userId: row.user_id,
    orderId: row.order_id,
    activatedAt: row.activated_at,
    accessToken: row.access_token,
  };
}

// ---------------------------------------------------------------------------
// 1. createPass
// ---------------------------------------------------------------------------

export async function createPass(
  eventId: string,
  input: CreatePassInput,
  db: PassDB,
): Promise<MultiDayPass> {
  const [row] = await db.query<PassRow>(
    `INSERT INTO conference.multi_day_passes
       (event_id, name, description, pass_type, days_included, tracks_included,
        price_hellers, sale_start, sale_end, quantity, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      eventId,
      input.name,
      input.description ?? null,
      input.passType,
      input.daysIncluded,
      input.tracksIncluded ?? null,
      input.priceHellers,
      input.saleStart ?? null,
      input.saleEnd ?? null,
      input.quantity ?? null,
      input.status ?? 'draft',
    ],
  );
  return mapPass(row);
}

// ---------------------------------------------------------------------------
// 2. getPass
// ---------------------------------------------------------------------------

export async function getPass(
  passId: string,
  db: PassDB,
): Promise<MultiDayPass> {
  const [row] = await db.query<PassRow>(
    `SELECT * FROM conference.multi_day_passes WHERE id = $1`,
    [passId],
  );
  if (!row) throw new ConferenceError('PASS_NOT_FOUND');
  return mapPass(row);
}

// ---------------------------------------------------------------------------
// 3. listPasses
// ---------------------------------------------------------------------------

export async function listPasses(
  eventId: string,
  db: PassDB,
): Promise<MultiDayPass[]> {
  const rows = await db.query<PassRow>(
    `SELECT * FROM conference.multi_day_passes WHERE event_id = $1 ORDER BY created_at ASC`,
    [eventId],
  );
  return rows.map(mapPass);
}

// ---------------------------------------------------------------------------
// 4. activatePass
// ---------------------------------------------------------------------------

export async function activatePass(
  passId: string,
  userId: string,
  orderId: string,
  db: PassDB,
): Promise<PassActivation> {
  // 1) Load the pass
  const [passRow] = await db.query<PassRow>(
    `SELECT * FROM conference.multi_day_passes WHERE id = $1`,
    [passId],
  );
  if (!passRow) throw new ConferenceError('PASS_NOT_FOUND');

  // 2) Check status
  if (passRow.status === 'sold_out') throw new ConferenceError('PASS_SOLD_OUT');
  if (passRow.status !== 'active') throw new ConferenceError('PASS_SALE_CLOSED');

  // 3) Check sale window
  const now = new Date();
  if (passRow.sale_start && new Date(passRow.sale_start) > now) {
    throw new ConferenceError('PASS_SALE_CLOSED');
  }
  if (passRow.sale_end && new Date(passRow.sale_end) < now) {
    throw new ConferenceError('PASS_SALE_CLOSED');
  }

  // 4) Check quantity
  if (passRow.quantity !== null && passRow.quantity_sold >= passRow.quantity) {
    throw new ConferenceError('PASS_SOLD_OUT');
  }

  // 5) Check existing activation
  const [existing] = await db.query<{ id: string }>(
    `SELECT id FROM conference.pass_activations WHERE pass_id = $1 AND user_id = $2`,
    [passId, userId],
  );
  if (existing) throw new ConferenceError('PASS_ALREADY_ACTIVATED');

  // 6) Insert activation
  const [activation] = await db.query<ActivationRow>(
    `INSERT INTO conference.pass_activations (pass_id, user_id, order_id)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [passId, userId, orderId],
  );

  // 7) Increment quantity_sold
  await db.execute(
    `UPDATE conference.multi_day_passes SET quantity_sold = quantity_sold + 1 WHERE id = $1`,
    [passId],
  );

  return mapActivation(activation);
}

// ---------------------------------------------------------------------------
// 5. getActivationsForUser
// ---------------------------------------------------------------------------

export async function getActivationsForUser(
  userId: string,
  db: PassDB,
): Promise<PassActivationWithPass[]> {
  const rows = await db.query<ActivationWithPassRow>(
    `SELECT
       pa.*,
       p.name AS pass_name,
       p.pass_type,
       p.event_id,
       p.days_included,
       p.tracks_included,
       p.price_hellers,
       p.sale_start,
       p.sale_end,
       p.quantity,
       p.quantity_sold,
       p.status AS pass_status,
       p.created_at AS pass_created_at,
       p.description AS pass_description
     FROM conference.pass_activations pa
     JOIN conference.multi_day_passes p ON p.id = pa.pass_id
     WHERE pa.user_id = $1
     ORDER BY pa.activated_at DESC`,
    [userId],
  );

  return rows.map(row => ({
    id: row.id,
    passId: row.pass_id,
    userId: row.user_id,
    orderId: row.order_id,
    activatedAt: row.activated_at,
    accessToken: row.access_token,
    pass: {
      id: row.pass_id,
      eventId: row.event_id,
      name: row.pass_name,
      description: row.pass_description,
      passType: row.pass_type as PassType,
      daysIncluded: row.days_included ?? [],
      tracksIncluded: row.tracks_included,
      priceHellers: row.price_hellers,
      saleStart: row.sale_start,
      saleEnd: row.sale_end,
      quantity: row.quantity,
      quantitySold: row.quantity_sold,
      status: row.pass_status as PassStatus,
      createdAt: row.pass_created_at,
    },
  }));
}

// ---------------------------------------------------------------------------
// 6. checkPassAccess
// ---------------------------------------------------------------------------

export async function checkPassAccess(
  accessToken: string,
  db: PassDB,
): Promise<PassAccessResult> {
  const [row] = await db.query<ActivationWithPassRow>(
    `SELECT
       pa.*,
       p.name AS pass_name,
       p.pass_type,
       p.event_id,
       p.days_included,
       p.tracks_included,
       p.price_hellers,
       p.sale_start,
       p.sale_end,
       p.quantity,
       p.quantity_sold,
       p.status AS pass_status,
       p.created_at AS pass_created_at,
       p.description AS pass_description
     FROM conference.pass_activations pa
     JOIN conference.multi_day_passes p ON p.id = pa.pass_id
     WHERE pa.access_token = $1`,
    [accessToken],
  );
  if (!row) throw new ConferenceError('PASS_NOT_FOUND');

  return {
    activation: mapActivation(row),
    pass: {
      id: row.pass_id,
      eventId: row.event_id,
      name: row.pass_name,
      description: row.pass_description,
      passType: row.pass_type as PassType,
      daysIncluded: row.days_included ?? [],
      tracksIncluded: row.tracks_included,
      priceHellers: row.price_hellers,
      saleStart: row.sale_start,
      saleEnd: row.sale_end,
      quantity: row.quantity,
      quantitySold: row.quantity_sold,
      status: row.pass_status as PassStatus,
      createdAt: row.pass_created_at,
    },
  };
}
