import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getKycQueueStats,
  searchPromoters,
  changePromoterStatus,
  getDocumentDownloadUrl,
  type StorageAdapter,
} from '../services/kyc-admin.service';
import { OnboardingError } from '../lib/onboarding-errors';
import type { ServiceDeps } from '../lib/service-container';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(queryResults: unknown[][] = [], executeImpl?: () => Promise<void>) {
  let callIdx = 0;
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve(queryResults[callIdx++] ?? [])),
    execute: vi.fn().mockImplementation(executeImpl ?? (() => Promise.resolve())),
  };
}

function makeDeps(db: ReturnType<typeof makeDb>): ServiceDeps {
  return {
    db: db as unknown as ServiceDeps['db'],
    redis: {} as ServiceDeps['redis'],
    kafka: { send: vi.fn().mockResolvedValue(undefined) },
    email: { send: vi.fn().mockResolvedValue(undefined) },
  } as unknown as ServiceDeps;
}

// ---------------------------------------------------------------------------
// 1. getKycQueueStats
// ---------------------------------------------------------------------------

describe('getKycQueueStats', () => {
  it('vrátí správně parsované statistiky', async () => {
    const db = makeDb([
      [{ count: '7' }],                                          // pending
      [{ submitted_today: '3', approved_today: '5', rejected_today: '1' }], // today
      [{ avg_hours: '4.2' }],                                    // avg
    ]);
    const stats = await getKycQueueStats(makeDeps(db));
    expect(stats.pending).toBe(7);
    expect(stats.submittedToday).toBe(3);
    expect(stats.approvedToday).toBe(5);
    expect(stats.rejectedToday).toBe(1);
    expect(stats.avgReviewHours).toBe(4.2);
  });

  it('vrátí null pro avgReviewHours pokud není data', async () => {
    const db = makeDb([
      [{ count: '0' }],
      [{ submitted_today: '0', approved_today: '0', rejected_today: '0' }],
      [{ avg_hours: null }],
    ]);
    const stats = await getKycQueueStats(makeDeps(db));
    expect(stats.avgReviewHours).toBeNull();
  });

  it('vrátí nuly pokud jsou prázdné výsledky', async () => {
    const db = makeDb([[], [], []]);
    const stats = await getKycQueueStats(makeDeps(db));
    expect(stats.pending).toBe(0);
    expect(stats.submittedToday).toBe(0);
    expect(stats.approvedToday).toBe(0);
    expect(stats.rejectedToday).toBe(0);
    expect(stats.avgReviewHours).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. searchPromoters
// ---------------------------------------------------------------------------

describe('searchPromoters', () => {
  const mockPromoter = {
    id: 'promo-1',
    name: 'Rock Festival s.r.o.',
    legal_name: 'Rock Festival s.r.o.',
    ico: '12345678',
    status: 'active',
    kyc_status: 'verified',
    created_at: '2026-01-01T00:00:00.000Z',
    document_count: '2',
    last_review_at: '2026-01-10T12:00:00.000Z',
  };

  it('vrátí seznam promotérů a celkový počet', async () => {
    const db = makeDb([
      [mockPromoter],
      [{ count: '1' }],
    ]);
    const result = await searchPromoters({ limit: 20, offset: 0 }, makeDeps(db));
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe('promo-1');
    expect(result.items[0].documentCount).toBe(2);
  });

  it('mapuje snake_case DB sloupce na camelCase', async () => {
    const db = makeDb([[mockPromoter], [{ count: '1' }]]);
    const result = await searchPromoters({ limit: 10, offset: 0 }, makeDeps(db));
    const item = result.items[0];
    expect(item.legalName).toBe('Rock Festival s.r.o.');
    expect(item.kycStatus).toBe('verified');
    expect(item.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(item.lastReviewAt).toBe('2026-01-10T12:00:00.000Z');
  });

  it('vrátí prázdné pole pokud nic neodpovídá', async () => {
    const db = makeDb([[], [{ count: '0' }]]);
    const result = await searchPromoters(
      { query: 'neexistující', limit: 20, offset: 0 },
      makeDeps(db),
    );
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. changePromoterStatus — happy path
// ---------------------------------------------------------------------------

describe('changePromoterStatus — povolené přechody', () => {
  const adminId = 'admin-uuid';
  const promoterId = 'promo-uuid';

  function makeStatusDeps(currentStatus: string) {
    const db = makeDb([
      [{ id: promoterId, status: currentStatus }],       // query 1: SELECT promoter
      [{ email: 'owner@test.cz', name: 'Jan Novák' }],  // query 2: SELECT owner email
    ]);
    const deps = makeDeps(db);
    return { db, deps };
  }

  it('suspend: active → suspended', async () => {
    const { db, deps } = makeStatusDeps('active');
    await expect(
      changePromoterStatus(promoterId, adminId, 'suspend', 'Porušení podmínek', deps),
    ).resolves.toBeUndefined();
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE platform.promoters'),
      ['suspended', promoterId],
    );
  });

  it('ban: active → banned', async () => {
    const { db, deps } = makeStatusDeps('active');
    await changePromoterStatus(promoterId, adminId, 'ban', 'Podvod', deps);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE platform.promoters'),
      ['banned', promoterId],
    );
  });

  it('ban: suspended → banned', async () => {
    const { db, deps } = makeStatusDeps('suspended');
    await expect(
      changePromoterStatus(promoterId, adminId, 'ban', 'Opakovaný přestupek', deps),
    ).resolves.toBeUndefined();
  });

  it('ban: pending → banned', async () => {
    const { db, deps } = makeStatusDeps('pending');
    await expect(
      changePromoterStatus(promoterId, adminId, 'ban', 'Falešná registrace', deps),
    ).resolves.toBeUndefined();
  });

  it('reactivate: suspended → active', async () => {
    const { db, deps } = makeStatusDeps('suspended');
    await changePromoterStatus(promoterId, adminId, 'reactivate', 'Problém vyřešen', deps);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE platform.promoters'),
      ['active', promoterId],
    );
  });

  it('zapíše audit záznam do kyc_reviews', async () => {
    const { db, deps } = makeStatusDeps('active');
    await changePromoterStatus(promoterId, adminId, 'suspend', 'Test', deps);
    const insertCall = db.execute.mock.calls.find((c: unknown[]) =>
      (c[0] as string).includes('INSERT INTO platform.kyc_reviews'),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual([promoterId, adminId, 'status_suspend', 'Test']);
  });

  it('odešle notifikační e-mail ownerovi', async () => {
    const { deps } = makeStatusDeps('active');
    await changePromoterStatus(promoterId, adminId, 'suspend', 'Test', deps);
    expect(deps.email.send).toHaveBeenCalledWith(
      'owner@test.cz',
      'Váš účet byl dočasně pozastaven',
      expect.stringContaining('Jan Novák'),
    );
  });
});

// ---------------------------------------------------------------------------
// 4. changePromoterStatus — chybové stavy
// ---------------------------------------------------------------------------

describe('changePromoterStatus — chybové přechody', () => {
  const adminId = 'admin-uuid';
  const promoterId = 'promo-uuid';

  it('hodí ONBOARDING_NOT_FOUND pokud promotér neexistuje', async () => {
    const db = makeDb([[]]); // prázdný výsledek
    await expect(
      changePromoterStatus(promoterId, adminId, 'suspend', 'Test', makeDeps(db)),
    ).rejects.toThrow(OnboardingError);

    const db2 = makeDb([[]]);
    try {
      await changePromoterStatus(promoterId, adminId, 'suspend', 'Test', makeDeps(db2));
    } catch (err) {
      expect(err instanceof OnboardingError && err.code).toBe('ONBOARDING_NOT_FOUND');
    }
  });

  it('hodí INVALID_STATUS_TRANSITION pro suspended → suspend', async () => {
    const db = makeDb([[{ id: promoterId, status: 'suspended' }]]);
    try {
      await changePromoterStatus(promoterId, adminId, 'suspend', 'Test', makeDeps(db));
      expect.fail('Měla se hodit chyba');
    } catch (err) {
      expect(err instanceof OnboardingError && err.code).toBe('INVALID_STATUS_TRANSITION');
    }
  });

  it('hodí INVALID_STATUS_TRANSITION pro banned → reactivate', async () => {
    const db = makeDb([[{ id: promoterId, status: 'banned' }]]);
    try {
      await changePromoterStatus(promoterId, adminId, 'reactivate', 'Test', makeDeps(db));
      expect.fail('Měla se hodit chyba');
    } catch (err) {
      expect(err instanceof OnboardingError && err.code).toBe('INVALID_STATUS_TRANSITION');
    }
  });

  it('hodí INVALID_STATUS_TRANSITION pro active → reactivate', async () => {
    const db = makeDb([[{ id: promoterId, status: 'active' }]]);
    try {
      await changePromoterStatus(promoterId, adminId, 'reactivate', 'Test', makeDeps(db));
      expect.fail('Měla se hodit chyba');
    } catch (err) {
      expect(err instanceof OnboardingError && err.code).toBe('INVALID_STATUS_TRANSITION');
    }
  });
});

// ---------------------------------------------------------------------------
// 5. getDocumentDownloadUrl
// ---------------------------------------------------------------------------

describe('getDocumentDownloadUrl', () => {
  const promoterId = 'promo-uuid';
  const documentId = 'doc-uuid';

  const mockDoc = {
    id: documentId,
    promoter_id: promoterId,
    storage_key: 'kyc/promo-uuid/doc-uuid.pdf',
    file_name: 'pas.pdf',
    mime_type: 'application/pdf',
  };

  function makeStorage(url = 'https://s3.example.com/presigned'): StorageAdapter {
    return {
      getSignedDownloadUrl: vi.fn().mockResolvedValue(url),
    };
  }

  it('vrátí URL, fileName, mimeType a expiresAt', async () => {
    const db = makeDb([[mockDoc]]);
    const storage = makeStorage();
    const result = await getDocumentDownloadUrl(
      promoterId, documentId, storage, makeDeps(db),
    );
    expect(result.url).toBe('https://s3.example.com/presigned');
    expect(result.fileName).toBe('pas.pdf');
    expect(result.mimeType).toBe('application/pdf');
    expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('expiresAt je přibližně 15 minut v budoucnosti', async () => {
    const db = makeDb([[mockDoc]]);
    const storage = makeStorage();
    const before = Date.now();
    const result = await getDocumentDownloadUrl(
      promoterId, documentId, storage, makeDeps(db),
    );
    const after = Date.now();
    const expiresMs = new Date(result.expiresAt).getTime();
    // 15 min ± 5 sekund tolerance
    expect(expiresMs).toBeGreaterThanOrEqual(before + 15 * 60 * 1000 - 5000);
    expect(expiresMs).toBeLessThanOrEqual(after + 15 * 60 * 1000 + 5000);
  });

  it('volá storage.getSignedDownloadUrl se správným klíčem a TTL 900', async () => {
    const db = makeDb([[mockDoc]]);
    const storage = makeStorage();
    await getDocumentDownloadUrl(promoterId, documentId, storage, makeDeps(db));
    expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith(
      'kyc/promo-uuid/doc-uuid.pdf',
      900,
    );
  });

  it('hodí DOCUMENT_NOT_FOUND pokud dokument nepatří promotérovi', async () => {
    const db = makeDb([[]]); // prázdný výsledek
    try {
      await getDocumentDownloadUrl(promoterId, documentId, makeStorage(), makeDeps(db));
      expect.fail('Měla se hodit chyba');
    } catch (err) {
      expect(err instanceof OnboardingError && err.code).toBe('DOCUMENT_NOT_FOUND');
    }
  });
});
