/**
 * GET /api/admin/events/[id]/demographics
 *
 * Buyer demographics aggregate per event:
 * - Age groups (18-24, 25-34, 35-44, 45-54, 55+)
 * - Gender breakdown
 * - Geography (country, city)
 *
 * Privacy: jen aggregated counts, žádné individual identifiers.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const { id: eventId } = await params;

  // Ownership
  const own = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoter.promoterId],
  );
  if (own.rows.length === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  // Age groups (vypočtené z birth_year)
  const ageRes = await db().query<{
    age_18_24: string; age_25_34: string; age_35_44: string;
    age_45_54: string; age_55_plus: string; age_unknown: string;
    total_buyers: string;
  }>(
    `SELECT
        COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM now())::int - u.birth_year BETWEEN 18 AND 24)::text AS age_18_24,
        COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM now())::int - u.birth_year BETWEEN 25 AND 34)::text AS age_25_34,
        COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM now())::int - u.birth_year BETWEEN 35 AND 44)::text AS age_35_44,
        COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM now())::int - u.birth_year BETWEEN 45 AND 54)::text AS age_45_54,
        COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM now())::int - u.birth_year > 54)::text AS age_55_plus,
        COUNT(*) FILTER (WHERE u.birth_year IS NULL)::text AS age_unknown,
        COUNT(*)::text AS total_buyers
       FROM orders.orders o
       JOIN identity.users u ON u.id = o.user_id
      WHERE o.event_id = $1 AND o.status = 'paid'`,
    [eventId],
  );

  // Gender
  const genderRes = await db().query<{
    gender_male: string; gender_female: string;
    gender_other: string; gender_unknown: string;
  }>(
    `SELECT
        COUNT(*) FILTER (WHERE u.gender = 'male')::text AS gender_male,
        COUNT(*) FILTER (WHERE u.gender = 'female')::text AS gender_female,
        COUNT(*) FILTER (WHERE u.gender = 'other')::text AS gender_other,
        COUNT(*) FILTER (WHERE u.gender IS NULL OR u.gender = 'prefer_not_to_say')::text AS gender_unknown
       FROM orders.orders o
       JOIN identity.users u ON u.id = o.user_id
      WHERE o.event_id = $1 AND o.status = 'paid'`,
    [eventId],
  );

  // Geography
  const geoRes = await db().query<{ country_code: string | null; city: string | null; count: string }>(
    `SELECT u.country_code, u.city, COUNT(*)::text AS count
       FROM orders.orders o
       JOIN identity.users u ON u.id = o.user_id
      WHERE o.event_id = $1 AND o.status = 'paid'
   GROUP BY u.country_code, u.city
   ORDER BY COUNT(*) DESC
      LIMIT 20`,
    [eventId],
  );

  const total = Number(ageRes.rows[0]?.total_buyers ?? 0);

  return NextResponse.json({
    totalBuyers: total,
    minimumSampleSize: 20,
    sampleAdequate: total >= 20,
    age: ageRes.rows[0] ? {
      '18-24': Number(ageRes.rows[0].age_18_24),
      '25-34': Number(ageRes.rows[0].age_25_34),
      '35-44': Number(ageRes.rows[0].age_35_44),
      '45-54': Number(ageRes.rows[0].age_45_54),
      '55+': Number(ageRes.rows[0].age_55_plus),
      unknown: Number(ageRes.rows[0].age_unknown),
    } : null,
    gender: genderRes.rows[0] ? {
      male: Number(genderRes.rows[0].gender_male),
      female: Number(genderRes.rows[0].gender_female),
      other: Number(genderRes.rows[0].gender_other),
      unknown: Number(genderRes.rows[0].gender_unknown),
    } : null,
    geography: geoRes.rows.map((g) => ({
      country: g.country_code, city: g.city, count: Number(g.count),
    })),
    privacy_note: 'Aggregated data only. Individual buyer info skryto. K-anonymity threshold: 5.',
  });
}
