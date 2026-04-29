// =============================================================================
// Virtual Venue Service — 3D Seat Preview
// Feature #42: Interactive seat view previews before ticket purchase
//
// Two levels of preview:
//   1. Section panoramas: 360° photosphere for a seating section (faster to load)
//   2. Seat previews: per-seat photo/render for premium or unique seats
//
// Used by the seat-map UI to show buyers what their view looks like before buying.
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface SectionPanorama {
  id: string;
  venueId: string;
  sectionId: string;
  panoramaUrl: string;
  thumbnailUrl: string | null;
  fovDegrees: number;
  pitchDegrees: number;
  yawDegrees: number;
  label: string | null;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SeatPreview {
  id: string;
  venueId: string;
  seatId: string;
  previewUrl: string;
  thumbnailUrl: string | null;
  viewDescription: string | null;
  viewQuality: 'standard' | 'good' | 'excellent' | 'obstructed';
  uploadedBy: string;
  createdAt: string;
}

interface PanoramaRow {
  id: string;
  venue_id: string;
  section_id: string;
  panorama_url: string;
  thumbnail_url: string | null;
  fov_degrees: number;
  pitch_degrees: string;
  yaw_degrees: string;
  label: string | null;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
}

interface PreviewRow {
  id: string;
  venue_id: string;
  seat_id: string;
  preview_url: string;
  thumbnail_url: string | null;
  view_description: string | null;
  view_quality: string;
  uploaded_by: string;
  created_at: string;
}

function mapPanorama(r: PanoramaRow): SectionPanorama {
  return {
    id: r.id,
    venueId: r.venue_id,
    sectionId: r.section_id,
    panoramaUrl: r.panorama_url,
    thumbnailUrl: r.thumbnail_url,
    fovDegrees: r.fov_degrees,
    pitchDegrees: parseFloat(r.pitch_degrees),
    yawDegrees: parseFloat(r.yaw_degrees),
    label: r.label,
    uploadedBy: r.uploaded_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapPreview(r: PreviewRow): SeatPreview {
  return {
    id: r.id,
    venueId: r.venue_id,
    seatId: r.seat_id,
    previewUrl: r.preview_url,
    thumbnailUrl: r.thumbnail_url,
    viewDescription: r.view_description,
    viewQuality: r.view_quality as SeatPreview['viewQuality'],
    uploadedBy: r.uploaded_by,
    createdAt: r.created_at,
  };
}

function validateUrl(url: string, fieldName: string): void {
  if (!url.startsWith('https://')) {
    throw new Error(`VALIDATION_ERROR: ${fieldName} must be an HTTPS URL`);
  }
}

/**
 * Create or update a 360° panorama for a seating section.
 */
export async function upsertSectionPanorama(
  venueId: string,
  sectionId: string,
  input: {
    panoramaUrl: string;
    thumbnailUrl?: string;
    fovDegrees?: number;
    pitchDegrees?: number;
    yawDegrees?: number;
    label?: string;
    uploadedBy: string;
  },
  db: DbAdapter,
): Promise<SectionPanorama> {
  validateUrl(input.panoramaUrl, 'panoramaUrl');

  const rows = await db.query<PanoramaRow>(
    `INSERT INTO virtual_venue.section_panoramas
       (venue_id, section_id, panorama_url, thumbnail_url, fov_degrees, pitch_degrees, yaw_degrees, label, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (venue_id, section_id) DO UPDATE SET
       panorama_url = EXCLUDED.panorama_url,
       thumbnail_url = EXCLUDED.thumbnail_url,
       fov_degrees = EXCLUDED.fov_degrees,
       pitch_degrees = EXCLUDED.pitch_degrees,
       yaw_degrees = EXCLUDED.yaw_degrees,
       label = EXCLUDED.label,
       uploaded_by = EXCLUDED.uploaded_by,
       updated_at = NOW()
     RETURNING *`,
    [
      venueId,
      sectionId,
      input.panoramaUrl,
      input.thumbnailUrl ?? null,
      input.fovDegrees ?? 90,
      input.pitchDegrees ?? 0,
      input.yawDegrees ?? 0,
      input.label ?? null,
      input.uploadedBy,
    ],
  );

  return mapPanorama(rows[0]);
}

/**
 * Get the panorama for a section.
 */
export async function getSectionPanorama(
  venueId: string,
  sectionId: string,
  db: DbAdapter,
): Promise<SectionPanorama | null> {
  const rows = await db.query<PanoramaRow>(
    `SELECT * FROM virtual_venue.section_panoramas WHERE venue_id = $1 AND section_id = $2`,
    [venueId, sectionId],
  );
  return rows[0] ? mapPanorama(rows[0]) : null;
}

/**
 * List all panoramas for a venue.
 */
export async function listSectionPanoramas(
  venueId: string,
  db: DbAdapter,
): Promise<SectionPanorama[]> {
  const rows = await db.query<PanoramaRow>(
    `SELECT * FROM virtual_venue.section_panoramas WHERE venue_id = $1 ORDER BY section_id ASC`,
    [venueId],
  );
  return rows.map(mapPanorama);
}

/**
 * Create or update a per-seat preview image.
 */
export async function upsertSeatPreview(
  venueId: string,
  seatId: string,
  input: {
    previewUrl: string;
    thumbnailUrl?: string;
    viewDescription?: string;
    viewQuality?: SeatPreview['viewQuality'];
    uploadedBy: string;
  },
  db: DbAdapter,
): Promise<SeatPreview> {
  validateUrl(input.previewUrl, 'previewUrl');

  const rows = await db.query<PreviewRow>(
    `INSERT INTO virtual_venue.seat_previews
       (venue_id, seat_id, preview_url, thumbnail_url, view_description, view_quality, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (venue_id, seat_id) DO UPDATE SET
       preview_url = EXCLUDED.preview_url,
       thumbnail_url = EXCLUDED.thumbnail_url,
       view_description = EXCLUDED.view_description,
       view_quality = EXCLUDED.view_quality,
       uploaded_by = EXCLUDED.uploaded_by
     RETURNING *`,
    [
      venueId,
      seatId,
      input.previewUrl,
      input.thumbnailUrl ?? null,
      input.viewDescription ?? null,
      input.viewQuality ?? 'standard',
      input.uploadedBy,
    ],
  );

  return mapPreview(rows[0]);
}

/**
 * Get the preview for a specific seat.
 */
export async function getSeatPreview(
  venueId: string,
  seatId: string,
  db: DbAdapter,
): Promise<SeatPreview | null> {
  const rows = await db.query<PreviewRow>(
    `SELECT * FROM virtual_venue.seat_previews WHERE venue_id = $1 AND seat_id = $2`,
    [venueId, seatId],
  );
  return rows[0] ? mapPreview(rows[0]) : null;
}

/**
 * Get preview for a seat, falling back to its section panorama if no per-seat preview exists.
 */
export async function getSeatOrSectionPreview(
  venueId: string,
  seatId: string,
  sectionId: string,
  db: DbAdapter,
): Promise<{ type: 'seat'; data: SeatPreview } | { type: 'section'; data: SectionPanorama } | null> {
  const seatPrev = await getSeatPreview(venueId, seatId, db);
  if (seatPrev) return { type: 'seat', data: seatPrev };

  const sectionPanorama = await getSectionPanorama(venueId, sectionId, db);
  if (sectionPanorama) return { type: 'section', data: sectionPanorama };

  return null;
}
