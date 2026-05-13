import { PortalDB } from './profile.service';
import { CustomerProfile, getProfile } from './profile.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BookingSummary {
  id: string;
  slotId: string;
  serviceId: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  status: string;
  totalHellers: number;
}

export interface PackageSummary {
  id: string;
  packageId: string;
  packageName: string;
  remainingUses: number;
  expiresAt: string | null;
}

export interface ActivityItem {
  id: string;
  type: 'booking' | 'purchase';
  description: string;
  occurredAt: string;
  amount: number | null;
}

export interface ServiceSummary {
  id: string;
  name: string;
  categoryId: string;
  durationMinutes: number;
  basePriceHellers: number;
}

export interface CustomerDashboard {
  profile: CustomerProfile;
  upcomingBookings: BookingSummary[];
  activePackages: PackageSummary[];
  recentActivity: ActivityItem[];
  waitlistCount: number;
  favoriteServices: ServiceSummary[];
}

export interface PastBookingsFilters {
  promoterId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface BookingDetail {
  id: string;
  slotId: string;
  serviceId: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  status: string;
  totalHellers: number;
  receipt: BookingReceipt | null;
}

export interface BookingReceipt {
  id: string;
  receiptNumber: string;
  totalHellers: number;
  issuedAt: string;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface BookingRow {
  id: string;
  slot_id: string;
  service_id: string;
  service_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  total_hellers: number;
}

interface PackageRow {
  id: string;
  package_id: string;
  package_name: string;
  remaining_uses: number;
  expires_at: string | null;
}

interface ActivityRow {
  id: string;
  type: 'booking' | 'purchase';
  description: string;
  occurred_at: string;
  amount: number | null;
}

interface ServiceRow {
  id: string;
  name: string;
  category_id: string;
  duration_minutes: number;
  base_price_hellers: number;
}

interface WaitlistCountRow {
  count: number;
}

interface ReceiptRow {
  id: string;
  receipt_number: string;
  total_hellers: number;
  issued_at: string;
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function getCustomerDashboard(
  userId: string,
  promoterId: string,
  db: PortalDB,
): Promise<CustomerDashboard> {
  // Query 1: profile
  const profile = await getProfile(userId, promoterId, db);

  // Query 2: upcoming bookings
  const upcomingBookings = await getUpcomingBookings(userId, db);

  // Query 3: active packages
  const { rows: packageRows } = await db.query<PackageRow>(
    `SELECT pp.id, pp.package_id, p.name AS package_name,
            (pp.total_uses - pp.used_count) AS remaining_uses, pp.expires_at
     FROM reservations.package_purchases pp
     JOIN reservations.packages p ON p.id = pp.package_id
     WHERE pp.user_id = $1
       AND pp.status = 'active'
       AND (pp.expires_at IS NULL OR pp.expires_at > NOW())
     ORDER BY pp.expires_at ASC NULLS LAST`,
    [userId],
  );

  const activePackages: PackageSummary[] = packageRows.map((r) => ({
    id: r.id,
    packageId: r.package_id,
    packageName: r.package_name,
    remainingUses: Number(r.remaining_uses),
    expiresAt: r.expires_at,
  }));

  // Query 4: waitlist count
  const { rows: waitlistRows } = await db.query<WaitlistCountRow>(
    `SELECT COUNT(*) AS count FROM reservations.waitlist_entries
     WHERE user_id = $1 AND status = 'waiting'`,
    [userId],
  );

  const waitlistCount = Number(waitlistRows[0]?.count ?? 0);

  // Query 5: favorite services
  const { rows: serviceRows } = await db.query<ServiceRow>(
    `SELECT s.id, s.name, s.category_id, s.duration_minutes, s.base_price_hellers
     FROM reservations.customer_favorites cf
     JOIN reservations.services s ON s.id = cf.entity_id
     WHERE cf.user_id = $1 AND cf.promoter_id = $2 AND cf.entity_type = 'service'
     ORDER BY cf.created_at DESC`,
    [userId, promoterId],
  );

  const favoriteServices: ServiceSummary[] = serviceRows.map((r) => ({
    id: r.id,
    name: r.name,
    categoryId: r.category_id,
    durationMinutes: Number(r.duration_minutes),
    basePriceHellers: Number(r.base_price_hellers),
  }));

  // Query 6: recent activity
  const { rows: activityRows } = await db.query<ActivityRow>(
    `SELECT id, type, description, occurred_at, amount
     FROM (
       SELECT id, 'booking'::text AS type, service_name AS description,
              created_at AS occurred_at, total_hellers AS amount
       FROM reservations.bookings_with_service
       WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 10
     ) a
     ORDER BY occurred_at DESC LIMIT 10`,
    [userId],
  );

  const recentActivity: ActivityItem[] = activityRows.map((r) => ({
    id: r.id,
    type: r.type,
    description: r.description,
    occurredAt: r.occurred_at,
    amount: r.amount !== null ? Number(r.amount) : null,
  }));

  return {
    profile,
    upcomingBookings,
    activePackages,
    recentActivity,
    waitlistCount,
    favoriteServices,
  };
}

export async function getUpcomingBookings(
  userId: string,
  db: PortalDB,
): Promise<BookingSummary[]> {
  const { rows } = await db.query<BookingRow>(
    `SELECT b.id, b.slot_id, b.service_id, s.name AS service_name,
            sl.starts_at, sl.ends_at, b.status, b.total_hellers
     FROM reservations.bookings b
     JOIN reservations.slots sl ON sl.id = b.slot_id
     JOIN reservations.services s ON s.id = b.service_id
     WHERE b.user_id = $1
       AND b.status IN ('pending','confirmed')
       AND sl.starts_at > NOW()
     ORDER BY sl.starts_at ASC
     LIMIT 5`,
    [userId],
  );

  return rows.map((r) => ({
    id: r.id,
    slotId: r.slot_id,
    serviceId: r.service_id,
    serviceName: r.service_name,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    status: r.status,
    totalHellers: Number(r.total_hellers),
  }));
}

export async function getPastBookings(
  userId: string,
  filters: PastBookingsFilters,
  db: PortalDB,
): Promise<BookingSummary[]> {
  const conditions: string[] = ['b.user_id = $1'];
  const params: unknown[] = [userId];
  let idx = 2;

  conditions.push(`(b.status NOT IN ('pending','confirmed') OR sl.starts_at <= NOW())`);

  if (filters.promoterId !== undefined) {
    conditions.push(`b.promoter_id = $${idx++}`);
    params.push(filters.promoterId);
  }
  if (filters.dateFrom !== undefined) {
    conditions.push(`sl.starts_at >= $${idx++}`);
    params.push(filters.dateFrom);
  }
  if (filters.dateTo !== undefined) {
    conditions.push(`sl.starts_at <= $${idx++}`);
    params.push(filters.dateTo);
  }
  if (filters.status !== undefined) {
    conditions.push(`b.status = $${idx++}`);
    params.push(filters.status);
  }

  const limit = filters.limit ?? 20;
  const offset = filters.offset ?? 0;

  params.push(limit, offset);

  const { rows } = await db.query<BookingRow>(
    `SELECT b.id, b.slot_id, b.service_id, s.name AS service_name,
            sl.starts_at, sl.ends_at, b.status, b.total_hellers
     FROM reservations.bookings b
     JOIN reservations.slots sl ON sl.id = b.slot_id
     JOIN reservations.services s ON s.id = b.service_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY sl.starts_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    slotId: r.slot_id,
    serviceId: r.service_id,
    serviceName: r.service_name,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    status: r.status,
    totalHellers: Number(r.total_hellers),
  }));
}

export async function getBookingDetail(
  bookingId: string,
  userId: string,
  db: PortalDB,
): Promise<BookingDetail> {
  const { rows } = await db.query<BookingRow & { receipt_id: string | null; receipt_number: string | null; receipt_total: number | null; receipt_issued_at: string | null }>(
    `SELECT b.id, b.slot_id, b.service_id, s.name AS service_name,
            sl.starts_at, sl.ends_at, b.status, b.total_hellers,
            br.id AS receipt_id, br.receipt_number, br.total_hellers AS receipt_total,
            br.issued_at AS receipt_issued_at
     FROM reservations.bookings b
     JOIN reservations.slots sl ON sl.id = b.slot_id
     JOIN reservations.services s ON s.id = b.service_id
     LEFT JOIN reservations.booking_receipts br ON br.booking_id = b.id
     WHERE b.id = $1 AND b.user_id = $2`,
    [bookingId, userId],
  );

  const row = rows[0];
  if (!row) {
    return {
      id: bookingId,
      slotId: '',
      serviceId: '',
      serviceName: '',
      startsAt: '',
      endsAt: '',
      status: '',
      totalHellers: 0,
      receipt: null,
    };
  }

  const receipt: BookingReceipt | null = row.receipt_id
    ? {
        id: row.receipt_id,
        receiptNumber: row.receipt_number!,
        totalHellers: Number(row.receipt_total),
        issuedAt: row.receipt_issued_at!,
      }
    : null;

  return {
    id: row.id,
    slotId: row.slot_id,
    serviceId: row.service_id,
    serviceName: row.service_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    totalHellers: Number(row.total_hellers),
    receipt,
  };
}
