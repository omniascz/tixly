import { describe, it, expect, vi } from 'vitest';
import {
  createDonationCampaign,
  recordDonation,
  getCampaignProgress,
  listDonors,
} from '../services/donation.service.js';
import type { DbAdapter } from '../services/donation.service.js';

function makeCampaignRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'campaign-001',
    event_id: 'event-001',
    promoter_id: 'promoter-001',
    ticket_type_id: 'tt-donation',
    name: 'Podpůrný fond kapely',
    description: 'Přispějte kapele na nové album',
    goal_hellers: '500000',       // 5000 CZK
    min_amount_hellers: '5000',   // 50 CZK
    max_amount_hellers: '1000000',
    total_raised_hellers: '0',
    donor_count: 0,
    is_active: true,
    created_at: '2026-04-14T08:00:00Z',
    updated_at: '2026-04-14T08:00:00Z',
    ...overrides,
  };
}

function makeDonationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'donation-001',
    campaign_id: 'campaign-001',
    order_id: 'order-001',
    donor_name: 'Petr Novák',
    donor_email: 'petr@test.cz',
    amount_hellers: '10000',
    message: 'Držte se!',
    is_anonymous: false,
    donated_at: '2026-04-14T14:00:00Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = [], executeMock = vi.fn()): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: executeMock,
  };
}

describe('createDonationCampaign', () => {
  it('vytvoří fundraisingovou kampaň a označí ticket type jako donation', async () => {
    const db = makeDb([[makeCampaignRow()]]);
    const result = await createDonationCampaign({
      eventId: 'event-001',
      promoterId: 'promoter-001',
      ticketTypeId: 'tt-donation',
      name: 'Podpůrný fond kapely',
      goalHellers: 500000,
      minAmountHellers: 5000,
    }, db);

    expect(result.name).toBe('Podpůrný fond kapely');
    expect(result.goalHellers).toBe(500000);
    expect(result.totalRaisedHellers).toBe(0);
    expect(db.execute).toHaveBeenCalledOnce(); // UPDATE ticket_types SET is_donation
  });

  it('odmítne prázdné jméno kampaně', async () => {
    const db = makeDb();
    await expect(createDonationCampaign({
      eventId: 'e', promoterId: 'p', ticketTypeId: 'tt',
      name: '   ',
    }, db)).rejects.toThrow('name is required');
  });

  it('odmítne minAmountHellers < 1', async () => {
    const db = makeDb();
    await expect(createDonationCampaign({
      eventId: 'e', promoterId: 'p', ticketTypeId: 'tt',
      name: 'Kampaň', minAmountHellers: 0,
    }, db)).rejects.toThrow('minAmountHellers must be >= 1');
  });

  it('odmítne maxAmount < minAmount', async () => {
    const db = makeDb();
    await expect(createDonationCampaign({
      eventId: 'e', promoterId: 'p', ticketTypeId: 'tt',
      name: 'Kampaň', minAmountHellers: 10000, maxAmountHellers: 5000,
    }, db)).rejects.toThrow('maxAmountHellers must be >= minAmountHellers');
  });

  it('výchozí minAmount je 100 haléřů (1 Kč)', async () => {
    const db = makeDb([[makeCampaignRow({ min_amount_hellers: '100' })]]);
    const result = await createDonationCampaign({
      eventId: 'e', promoterId: 'p', ticketTypeId: 'tt', name: 'Kampaň',
    }, db);
    expect(result.minAmountHellers).toBe(100);
  });
});

describe('recordDonation', () => {
  it('zaznamená dar a aktualizuje součty kampaně', async () => {
    const db = makeDb([
      [makeCampaignRow()],            // campaign check
      [makeDonationRow()],            // insert donation
    ]);

    const result = await recordDonation({
      campaignId: 'campaign-001',
      donorName: 'Petr Novák',
      donorEmail: 'petr@test.cz',
      amountHellers: 10000,
      message: 'Držte se!',
    }, db);

    expect(result.amountHellers).toBe(10000);
    expect(db.execute).toHaveBeenCalledOnce(); // UPDATE total_raised
  });

  it('odmítne dar pod minimální výší', async () => {
    const db = makeDb([[makeCampaignRow({ min_amount_hellers: '5000' })]]);
    await expect(recordDonation({
      campaignId: 'campaign-001',
      amountHellers: 1000, // below 5000 min
    }, db)).rejects.toThrow('amount below minimum');
  });

  it('odmítne dar nad maximální výší', async () => {
    const db = makeDb([[makeCampaignRow({ max_amount_hellers: '1000000' })]]);
    await expect(recordDonation({
      campaignId: 'campaign-001',
      amountHellers: 2000000,
    }, db)).rejects.toThrow('amount above maximum');
  });

  it('odmítne neaktivní kampaň', async () => {
    const db = makeDb([[]]); // empty = not active
    await expect(recordDonation({
      campaignId: 'campaign-001', amountHellers: 10000,
    }, db)).rejects.toThrow('CAMPAIGN_NOT_FOUND');
  });
});

describe('getCampaignProgress', () => {
  it('vrátí progress jako procenta ze cíle', async () => {
    const db = makeDb([[makeCampaignRow({ total_raised_hellers: '250000', goal_hellers: '500000' })]]);
    const result = await getCampaignProgress('campaign-001', db);
    expect(result.progressPct).toBe(50);
    expect(result.totalRaisedHellers).toBe(250000);
  });

  it('vrátí 100% pokud překročen cíl', async () => {
    const db = makeDb([[makeCampaignRow({ total_raised_hellers: '600000', goal_hellers: '500000' })]]);
    const result = await getCampaignProgress('campaign-001', db);
    expect(result.progressPct).toBe(100);
  });

  it('vrátí null progressPct pokud není cíl', async () => {
    const db = makeDb([[makeCampaignRow({ goal_hellers: null })]]);
    const result = await getCampaignProgress('campaign-001', db);
    expect(result.progressPct).toBeNull();
  });

  it('vyhodí chybu pro neexistující kampaň', async () => {
    const db = makeDb([[]]); // empty
    await expect(getCampaignProgress('bad-id', db)).rejects.toThrow('CAMPAIGN_NOT_FOUND');
  });
});

describe('listDonors', () => {
  it('vrátí seznam dárců s maskovými anonymními záznamy', async () => {
    const db = makeDb([
      [{ id: 'campaign-001' }],  // ownership check
      [
        makeDonationRow({ is_anonymous: false }),
        makeDonationRow({ id: 'donation-002', is_anonymous: true, donor_name: 'Jan Skrytý', donor_email: 'jan@secret.cz' }),
      ],
    ]);

    const result = await listDonors('campaign-001', 'promoter-001', db);
    expect(result).toHaveLength(2);
    expect(result[0].donorName).toBe('Petr Novák');  // visible
    expect(result[1].donorName).toBeNull();            // masked
    expect(result[1].donorEmail).toBeNull();           // masked
  });

  it('vyhodí chybu pro kampaň jiného pořadatele', async () => {
    const db = makeDb([[]]); // empty ownership check
    await expect(listDonors('campaign-001', 'wrong-promoter', db))
      .rejects.toThrow('CAMPAIGN_NOT_FOUND');
  });
});
