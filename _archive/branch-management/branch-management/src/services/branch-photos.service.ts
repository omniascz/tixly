// =============================================================================
// SERVICE: Multi-branch photo gallery
//
// Perzistuje metadata o fotografiích poboček. Vlastní upload do úložiště
// (S3 / Cloudflare R2) je mimo rozsah — tato služba přijímá URL, které už
// frontend nahrál (signed URL flow).
//
// Všechny operace jsou scopované podle promoter_id (anti-enum → 404 při
// cross-tenant přístupu).
// =============================================================================

import { BranchError } from '../lib/branch-errors';
import type { BranchDB } from './branch.service';
import type {
  BranchPhoto,
  UploadPhotoInput,
  UpdatePhotoInput,
  PhotoCategory,
} from '../types/branch-photo';

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface BranchPhotoRow {
  id: string;
  branch_id: string;
  promoter_id: string;
  url: string;
  alt: string | null;
  position: number;
  category: string;
  caption: string | null;
  uploaded_by: string;
  uploaded_at: Date | string;
}

const ALLOWED_CATEGORIES: ReadonlySet<PhotoCategory> = new Set([
  'interior',
  'exterior',
  'equipment',
  'team',
  'other',
]);

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapPhoto(row: BranchPhotoRow): BranchPhoto {
  return {
    id: row.id,
    branchId: row.branch_id,
    promoterId: row.promoter_id,
    url: row.url,
    alt: row.alt,
    position: row.position,
    category: (ALLOWED_CATEGORIES.has(row.category as PhotoCategory)
      ? row.category
      : 'other') as PhotoCategory,
    caption: row.caption,
    uploadedBy: row.uploaded_by,
    uploadedAt: toDate(row.uploaded_at),
  };
}

// ---------------------------------------------------------------------------
// Guard: ověř, že pobočka patří promotérovi (anti-enum → BRANCH_NOT_FOUND)
// ---------------------------------------------------------------------------

async function assertBranchOwnedByPromoter(
  branchId: string,
  promoterId: string,
  db: BranchDB,
): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM reservations.branches WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
    [branchId, promoterId],
  );
  if (!rows[0]) {
    throw new BranchError('BRANCH_NOT_FOUND', 'Pobočka nebyla nalezena.');
  }
}

async function loadPhotoScoped(
  photoId: string,
  promoterId: string,
  db: BranchDB,
): Promise<BranchPhotoRow> {
  const { rows } = await db.query<BranchPhotoRow>(
    `SELECT id, branch_id, promoter_id, url, alt, position, category, caption,
            uploaded_by, uploaded_at
     FROM branches.photos
     WHERE id = $1 AND promoter_id = $2
     LIMIT 1`,
    [photoId, promoterId],
  );
  if (!rows[0]) {
    throw new BranchError('BRANCH_NOT_FOUND', 'Fotografie nebyla nalezena.');
  }
  return rows[0];
}

// ---------------------------------------------------------------------------
// uploadPhoto
// ---------------------------------------------------------------------------

export async function uploadPhoto(
  promoterId: string,
  input: UploadPhotoInput,
  uploadedByUserId: string,
  db: BranchDB,
): Promise<BranchPhoto> {
  await assertBranchOwnedByPromoter(input.branchId, promoterId, db);

  const category: PhotoCategory = input.category ?? 'other';
  if (!ALLOWED_CATEGORIES.has(category)) {
    throw new BranchError('BRANCH_NOT_FOUND', 'Neplatná kategorie fotografie.');
  }

  // Position default → max(position)+1 pro danou pobočku
  let position = input.position;
  if (position === undefined) {
    const { rows } = await db.query<{ max_pos: number | null }>(
      `SELECT MAX(position) AS max_pos FROM branches.photos WHERE branch_id = $1`,
      [input.branchId],
    );
    position = (rows[0]?.max_pos ?? -1) + 1;
  }

  const { rows } = await db.query<BranchPhotoRow>(
    `INSERT INTO branches.photos
       (branch_id, promoter_id, url, alt, position, category, caption, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, branch_id, promoter_id, url, alt, position, category, caption,
               uploaded_by, uploaded_at`,
    [
      input.branchId,
      promoterId,
      input.url,
      input.alt ?? null,
      position,
      category,
      input.caption ?? null,
      uploadedByUserId,
    ],
  );

  if (!rows[0]) {
    throw new BranchError('BRANCH_NOT_FOUND', 'Fotografii se nepodařilo uložit.');
  }
  return mapPhoto(rows[0]);
}

// ---------------------------------------------------------------------------
// listPhotos
// ---------------------------------------------------------------------------

export async function listPhotos(
  branchId: string,
  promoterId: string,
  db: BranchDB,
): Promise<BranchPhoto[]> {
  await assertBranchOwnedByPromoter(branchId, promoterId, db);

  const { rows } = await db.query<BranchPhotoRow>(
    `SELECT id, branch_id, promoter_id, url, alt, position, category, caption,
            uploaded_by, uploaded_at
     FROM branches.photos
     WHERE branch_id = $1 AND promoter_id = $2
     ORDER BY position ASC, uploaded_at ASC`,
    [branchId, promoterId],
  );

  return rows.map(mapPhoto);
}

// ---------------------------------------------------------------------------
// reorderPhotos
// ---------------------------------------------------------------------------

export async function reorderPhotos(
  branchId: string,
  promoterId: string,
  orderedPhotoIds: string[],
  db: BranchDB,
): Promise<BranchPhoto[]> {
  await assertBranchOwnedByPromoter(branchId, promoterId, db);

  // Ověř, že všechna ID patří této pobočce
  const { rows: existingRows } = await db.query<{ id: string }>(
    `SELECT id FROM branches.photos WHERE branch_id = $1 AND promoter_id = $2`,
    [branchId, promoterId],
  );
  const existingIds = new Set(existingRows.map((r) => r.id));
  for (const id of orderedPhotoIds) {
    if (!existingIds.has(id)) {
      throw new BranchError('BRANCH_NOT_FOUND', 'Fotografie nebyla nalezena.');
    }
  }

  // Aktualizuj pozice sekvenčně
  for (let i = 0; i < orderedPhotoIds.length; i++) {
    await db.execute(
      `UPDATE branches.photos
         SET position = $1
       WHERE id = $2 AND branch_id = $3 AND promoter_id = $4`,
      [i, orderedPhotoIds[i], branchId, promoterId],
    );
  }

  return listPhotos(branchId, promoterId, db);
}

// ---------------------------------------------------------------------------
// deletePhoto
// ---------------------------------------------------------------------------

export async function deletePhoto(
  photoId: string,
  promoterId: string,
  db: BranchDB,
): Promise<void> {
  // Načti scoped — hodí BRANCH_NOT_FOUND při cross-tenant
  await loadPhotoScoped(photoId, promoterId, db);
  await db.execute(
    `DELETE FROM branches.photos WHERE id = $1 AND promoter_id = $2`,
    [photoId, promoterId],
  );
}

// ---------------------------------------------------------------------------
// updatePhoto
// ---------------------------------------------------------------------------

export async function updatePhoto(
  photoId: string,
  promoterId: string,
  input: UpdatePhotoInput,
  db: BranchDB,
): Promise<BranchPhoto> {
  await loadPhotoScoped(photoId, promoterId, db);

  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.alt !== undefined) {
    sets.push(`alt = $${idx++}`);
    params.push(input.alt);
  }
  if (input.caption !== undefined) {
    sets.push(`caption = $${idx++}`);
    params.push(input.caption);
  }
  if (input.category !== undefined) {
    if (!ALLOWED_CATEGORIES.has(input.category)) {
      throw new BranchError('BRANCH_NOT_FOUND', 'Neplatná kategorie fotografie.');
    }
    sets.push(`category = $${idx++}`);
    params.push(input.category);
  }

  if (sets.length === 0) {
    const row = await loadPhotoScoped(photoId, promoterId, db);
    return mapPhoto(row);
  }

  params.push(photoId, promoterId);
  const { rows } = await db.query<BranchPhotoRow>(
    `UPDATE branches.photos
       SET ${sets.join(', ')}
     WHERE id = $${idx++} AND promoter_id = $${idx}
     RETURNING id, branch_id, promoter_id, url, alt, position, category, caption,
               uploaded_by, uploaded_at`,
    params,
  );

  if (!rows[0]) {
    throw new BranchError('BRANCH_NOT_FOUND', 'Fotografie nebyla nalezena.');
  }
  return mapPhoto(rows[0]);
}
