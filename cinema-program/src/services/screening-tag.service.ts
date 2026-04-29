import type { CinemaProgramDB } from './age-restriction.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScreeningTag =
  | 'premiere'
  | 'gala'
  | 'subtitled'
  | 'dubbed'
  | 'seniors'
  | 'parents_with_babies'
  | string; // allow custom tags

export interface TaggedScreening {
  id: string;
  filmId: string;
  auditoriumId: string;
  startsAt: string;
  endsAt: string;
  format: string | null;
  language: string | null;
  priceHellers: number;
  status: string;
  tags: string[];
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface TagRow {
  screening_id: string;
  tag: string;
}

interface ScreeningWithTagRow {
  id: string;
  film_id: string;
  auditorium_id: string;
  starts_at: string;
  ends_at: string;
  format: string | null;
  language: string | null;
  price_hellers: number;
  status: string;
  tag: string;
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Add a tag to a screening. Idempotent — silently ignores duplicate.
 */
export async function addTag(
  screeningId: string,
  tag: string,
  db: CinemaProgramDB,
): Promise<void> {
  await db.execute(
    `INSERT INTO cinema.screening_tags (screening_id, tag)
     VALUES ($1, $2)
     ON CONFLICT (screening_id, tag) DO NOTHING`,
    [screeningId, tag],
  );
}

/**
 * Remove a tag from a screening.
 */
export async function removeTag(
  screeningId: string,
  tag: string,
  db: CinemaProgramDB,
): Promise<void> {
  await db.execute(
    `DELETE FROM cinema.screening_tags
     WHERE screening_id = $1 AND tag = $2`,
    [screeningId, tag],
  );
}

/**
 * Get all tags for a screening.
 */
export async function getTags(
  screeningId: string,
  db: CinemaProgramDB,
): Promise<string[]> {
  const { rows } = await db.query<TagRow>(
    `SELECT tag FROM cinema.screening_tags
     WHERE screening_id = $1
     ORDER BY tag ASC`,
    [screeningId],
  );

  return rows.map((r) => r.tag);
}

/**
 * Get all screenings at a venue with the given tag.
 * JOINs through auditoriums to filter by venue.
 */
export async function getScreeningsByTag(
  venueId: string,
  tag: string,
  db: CinemaProgramDB,
): Promise<TaggedScreening[]> {
  const { rows } = await db.query<ScreeningWithTagRow>(
    `SELECT s.id, s.film_id, s.auditorium_id, s.starts_at, s.ends_at,
            s.format, s.language, s.price_hellers, s.status,
            st.tag
     FROM cinema.screenings s
     JOIN cinema.auditoriums a ON a.id = s.auditorium_id
     JOIN cinema.screening_tags st ON st.screening_id = s.id
     WHERE a.venue_id = $1 AND st.tag = $2
       AND s.status != 'cancelled'
     ORDER BY s.starts_at ASC`,
    [venueId, tag],
  );

  // Group by screening id and collect tags (in this query each row has one tag)
  const screeningMap = new Map<string, TaggedScreening>();
  for (const row of rows) {
    if (!screeningMap.has(row.id)) {
      screeningMap.set(row.id, {
        id: row.id,
        filmId: row.film_id,
        auditoriumId: row.auditorium_id,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        format: row.format,
        language: row.language,
        priceHellers: row.price_hellers,
        status: row.status,
        tags: [],
      });
    }
    screeningMap.get(row.id)!.tags.push(row.tag);
  }

  return Array.from(screeningMap.values());
}
