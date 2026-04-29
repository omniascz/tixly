import { describe, it, expect, vi } from 'vitest';
import {
  uploadPhoto,
  listPhotos,
  reorderPhotos,
  deletePhoto,
  updatePhoto,
} from '../services/branch-photos.service';
import { BranchError } from '../lib/branch-errors';

const PROMOTER_ID = 'promoter-uuid-0001';
const OTHER_PROMOTER = 'promoter-uuid-0002';
const BRANCH_ID = 'branch-uuid-0001';
const USER_ID = 'user-uuid-0001';
const PHOTO_ID_1 = 'photo-uuid-0001';
const PHOTO_ID_2 = 'photo-uuid-0002';
const PHOTO_ID_3 = 'photo-uuid-0003';

function makeDb(responses: unknown[][] = []) {
  let i = 0;
  return {
    query: vi.fn(async () => ({ rows: responses[i++] ?? [] })),
    execute: vi.fn(async () => {}),
  };
}

function makePhotoRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PHOTO_ID_1,
    branch_id: BRANCH_ID,
    promoter_id: PROMOTER_ID,
    url: 'https://cdn.example.com/a.jpg',
    alt: 'Interiér',
    position: 0,
    category: 'interior',
    caption: null,
    uploaded_by: USER_ID,
    uploaded_at: new Date('2026-04-08T10:00:00Z'),
    ...overrides,
  };
}

describe('branch-photos.service', () => {
  describe('uploadPhoto', () => {
    it('uploads photo with auto-position when not provided', async () => {
      const db = makeDb([
        [{ id: BRANCH_ID }],                      // assertBranchOwnedByPromoter
        [{ max_pos: 2 }],                          // max(position)
        [makePhotoRow({ position: 3 })],          // INSERT RETURNING
      ]);
      const photo = await uploadPhoto(
        PROMOTER_ID,
        { branchId: BRANCH_ID, url: 'https://cdn.example.com/a.jpg', alt: 'Interiér', category: 'interior' },
        USER_ID,
        db,
      );
      expect(photo.position).toBe(3);
      expect(photo.category).toBe('interior');
      expect(photo.promoterId).toBe(PROMOTER_ID);
    });

    it('throws BRANCH_NOT_FOUND on cross-tenant upload', async () => {
      const db = makeDb([[]]); // assertBranchOwnedByPromoter → empty
      await expect(
        uploadPhoto(
          OTHER_PROMOTER,
          { branchId: BRANCH_ID, url: 'https://cdn.example.com/x.jpg' },
          USER_ID,
          db,
        ),
      ).rejects.toBeInstanceOf(BranchError);
    });

    it('uses provided position when present', async () => {
      const db = makeDb([
        [{ id: BRANCH_ID }],
        [makePhotoRow({ position: 7 })],
      ]);
      const photo = await uploadPhoto(
        PROMOTER_ID,
        { branchId: BRANCH_ID, url: 'https://cdn.example.com/a.jpg', position: 7 },
        USER_ID,
        db,
      );
      expect(photo.position).toBe(7);
    });
  });

  describe('listPhotos', () => {
    it('returns photos sorted (ordered by position in SQL)', async () => {
      const db = makeDb([
        [{ id: BRANCH_ID }],
        [
          makePhotoRow({ id: PHOTO_ID_1, position: 0 }),
          makePhotoRow({ id: PHOTO_ID_2, position: 1, url: 'https://cdn.example.com/b.jpg' }),
        ],
      ]);
      const photos = await listPhotos(BRANCH_ID, PROMOTER_ID, db);
      expect(photos).toHaveLength(2);
      expect(photos[0]!.position).toBe(0);
      expect(photos[1]!.position).toBe(1);
    });

    it('throws BRANCH_NOT_FOUND for cross-tenant', async () => {
      const db = makeDb([[]]);
      await expect(listPhotos(BRANCH_ID, OTHER_PROMOTER, db)).rejects.toBeInstanceOf(BranchError);
    });
  });

  describe('reorderPhotos', () => {
    it('updates positions for each id in given order', async () => {
      const db = makeDb([
        [{ id: BRANCH_ID }],                          // assert branch
        [{ id: PHOTO_ID_1 }, { id: PHOTO_ID_2 }, { id: PHOTO_ID_3 }], // existing ids
        [{ id: BRANCH_ID }],                          // listPhotos assert
        [
          makePhotoRow({ id: PHOTO_ID_2, position: 0 }),
          makePhotoRow({ id: PHOTO_ID_3, position: 1 }),
          makePhotoRow({ id: PHOTO_ID_1, position: 2 }),
        ],
      ]);
      const result = await reorderPhotos(
        BRANCH_ID,
        PROMOTER_ID,
        [PHOTO_ID_2, PHOTO_ID_3, PHOTO_ID_1],
        db,
      );
      expect(db.execute).toHaveBeenCalledTimes(3);
      expect(result).toHaveLength(3);
    });

    it('throws when an id does not belong to the branch', async () => {
      const db = makeDb([
        [{ id: BRANCH_ID }],
        [{ id: PHOTO_ID_1 }],
      ]);
      await expect(
        reorderPhotos(BRANCH_ID, PROMOTER_ID, [PHOTO_ID_1, 'ghost-id'], db),
      ).rejects.toBeInstanceOf(BranchError);
    });
  });

  describe('deletePhoto', () => {
    it('deletes when photo is owned by promoter', async () => {
      const db = makeDb([[makePhotoRow()]]);
      await deletePhoto(PHOTO_ID_1, PROMOTER_ID, db);
      expect(db.execute).toHaveBeenCalledTimes(1);
    });

    it('throws BRANCH_NOT_FOUND cross-tenant', async () => {
      const db = makeDb([[]]);
      await expect(deletePhoto(PHOTO_ID_1, OTHER_PROMOTER, db)).rejects.toBeInstanceOf(BranchError);
    });
  });

  describe('updatePhoto', () => {
    it('updates alt/caption/category', async () => {
      const db = makeDb([
        [makePhotoRow()],                                 // loadPhotoScoped
        [makePhotoRow({ alt: 'Nový popisek', caption: 'Přízemí', category: 'equipment' })],
      ]);
      const photo = await updatePhoto(
        PHOTO_ID_1,
        PROMOTER_ID,
        { alt: 'Nový popisek', caption: 'Přízemí', category: 'equipment' },
        db,
      );
      expect(photo.alt).toBe('Nový popisek');
      expect(photo.category).toBe('equipment');
    });

    it('throws BRANCH_NOT_FOUND cross-tenant', async () => {
      const db = makeDb([[]]);
      await expect(
        updatePhoto(PHOTO_ID_1, OTHER_PROMOTER, { alt: 'x' }, db),
      ).rejects.toBeInstanceOf(BranchError);
    });
  });
});
