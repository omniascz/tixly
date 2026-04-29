import { CatalogError } from '../lib/catalog-errors';
import type { CatalogDB } from './category.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewInput {
  bookingId?: string | null;
  rating: number; // 1-5
  title?: string | null;
  body?: string | null;
}

export interface ReviewFilters {
  isVerified?: boolean;
  minRating?: number;
}

export interface ServiceReview {
  id: string;
  serviceId: string;
  userId: string;
  bookingId: string | null;
  rating: number;
  title: string | null;
  body: string | null;
  isVerified: boolean;
  createdAt: string;
}

export interface AverageRating {
  avgRating: number | null;
  count: number;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface ReviewRow {
  id: string;
  service_id: string;
  user_id: string;
  booking_id: string | null;
  rating: number;
  title: string | null;
  body: string | null;
  is_verified: boolean;
  created_at: string;
}

interface AvgRow {
  avg_rating: string | null;
  review_count: string | number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapReview(row: ReviewRow): ServiceReview {
  return {
    id: row.id,
    serviceId: row.service_id,
    userId: row.user_id,
    bookingId: row.booking_id,
    rating: row.rating,
    title: row.title,
    body: row.body,
    isVerified: row.is_verified,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function createReview(
  serviceId: string,
  userId: string,
  input: ReviewInput,
  db: CatalogDB,
): Promise<ServiceReview> {
  const isVerified = input.bookingId != null;

  const { rows } = await db.query<ReviewRow>(
    `INSERT INTO reservations.service_reviews
       (service_id, user_id, booking_id, rating, title, body, is_verified)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      serviceId,
      userId,
      input.bookingId ?? null,
      input.rating,
      input.title ?? null,
      input.body ?? null,
      isVerified,
    ],
  );

  if (!rows[0]) {
    throw new CatalogError('REVIEW_DUPLICATE');
  }

  return mapReview(rows[0]);
}

export async function getReviews(
  serviceId: string,
  filters: ReviewFilters,
  db: CatalogDB,
): Promise<ServiceReview[]> {
  const conditions: string[] = ['service_id = $1'];
  const params: unknown[] = [serviceId];
  let idx = 2;

  if (filters.isVerified !== undefined) {
    conditions.push(`is_verified = $${idx}`);
    params.push(filters.isVerified);
    idx++;
  }
  if (filters.minRating !== undefined) {
    conditions.push(`rating >= $${idx}`);
    params.push(filters.minRating);
    idx++;
  }

  const { rows } = await db.query<ReviewRow>(
    `SELECT * FROM reservations.service_reviews
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC`,
    params,
  );

  return rows.map(mapReview);
}

export async function getAverageRating(
  serviceId: string,
  db: CatalogDB,
): Promise<AverageRating> {
  const { rows } = await db.query<AvgRow>(
    `SELECT AVG(rating)::numeric(3,2) AS avg_rating,
            COUNT(*) AS review_count
     FROM reservations.service_reviews
     WHERE service_id = $1`,
    [serviceId],
  );

  const row = rows[0];
  return {
    avgRating: row?.avg_rating != null ? Number(row.avg_rating) : null,
    count: Number(row?.review_count ?? 0),
  };
}

export async function deleteReview(
  reviewId: string,
  db: CatalogDB,
): Promise<void> {
  await db.execute(
    `DELETE FROM reservations.service_reviews WHERE id = $1`,
    [reviewId],
  );
}
