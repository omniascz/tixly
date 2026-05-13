// =============================================================================
// AI event assist — unit testy (Feature #47)
// =============================================================================

import { describe, it, expect, vi } from 'vitest';
import { generateEventContent } from '../services/event-assist.service.js';
import type { CallAiFn } from '../services/event-assist.service.js';

// ---------------------------------------------------------------------------
// Mock AI response
// ---------------------------------------------------------------------------

const VALID_JSON_RESPONSE = JSON.stringify({
  title: 'Rockový festival Pod Hradem 2026',
  description: 'Dva dny skvělé muziky v historickém prostředí.',
  category: 'Hudba',
  subcategory: 'Rock',
  tags: ['rock', 'festival', 'outdoor', 'léto'],
  recommendedPriceHalire: 89900,
  seoTitle: 'Rockový festival Pod Hradem 2026 — vstupenky',
  seoDescription: 'Největší rockový festival roku. Kupte vstupenky online se slevou.',
});

function makeCallAi(text: string, cached = false): CallAiFn {
  return vi.fn().mockResolvedValue({ text, cached });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateEventContent — happy path', () => {
  it('parsuje validní JSON odpověď AI a vrátí strukturovaný výstup', async () => {
    const callAi = makeCallAi(VALID_JSON_RESPONSE);

    const result = await generateEventContent(
      { idea: 'Rockový festival na hradě s 5 kapelami', promoterId: 'p-001' },
      callAi,
    );

    expect(result.title).toBe('Rockový festival Pod Hradem 2026');
    expect(result.category).toBe('Hudba');
    expect(result.subcategory).toBe('Rock');
    expect(result.tags).toEqual(['rock', 'festival', 'outdoor', 'léto']);
    expect(result.recommendedPriceHalire).toBe(89900);
    expect(result.seoTitle.length).toBeLessThanOrEqual(70);
    expect(result.seoDescription.length).toBeLessThanOrEqual(160);
    expect(result.cached).toBe(false);
  });

  it('předá správné parametry volání AI (model, feature, tenantId)', async () => {
    const callAi = makeCallAi(VALID_JSON_RESPONSE) as ReturnType<typeof vi.fn>;

    await generateEventContent(
      { idea: 'Jazzový koncert v klubu', promoterId: 'p-002', lang: 'en' },
      callAi,
    );

    expect(callAi).toHaveBeenCalledTimes(1);
    const opts = callAi.mock.calls[0][0] as { model: string; feature: string; tenantId: string };
    expect(opts.model).toBe('haiku');
    expect(opts.feature).toBe('event-assist');
    expect(opts.tenantId).toBe('p-002');
  });

  it('vrací cached=true pokud AI vrátí cached odpověď', async () => {
    const callAi = makeCallAi(VALID_JSON_RESPONSE, true);

    const result = await generateEventContent(
      { idea: 'Stejná akce jako minule', promoterId: 'p-001' },
      callAi,
    );

    expect(result.cached).toBe(true);
  });

  it('odstraní markdown fences ze začátku a konce AI odpovědi', async () => {
    const withFences = '```json\n' + VALID_JSON_RESPONSE + '\n```';
    const callAi = makeCallAi(withFences);

    const result = await generateEventContent(
      { idea: 'Test', promoterId: 'p-001' },
      callAi,
    );

    expect(result.title).toBe('Rockový festival Pod Hradem 2026');
  });

  it('ořízne seoTitle na 70 znaků a seoDescription na 160 znaků', async () => {
    const longResponse = JSON.stringify({
      ...JSON.parse(VALID_JSON_RESPONSE),
      seoTitle: 'A'.repeat(200),
      seoDescription: 'B'.repeat(300),
    });
    const callAi = makeCallAi(longResponse);

    const result = await generateEventContent(
      { idea: 'Test', promoterId: 'p-001' },
      callAi,
    );

    expect(result.seoTitle.length).toBe(70);
    expect(result.seoDescription.length).toBe(160);
  });

  it('recommendedPriceHalire je vždy nezáporné celé číslo', async () => {
    const negativePrice = JSON.stringify({
      ...JSON.parse(VALID_JSON_RESPONSE),
      recommendedPriceHalire: -500,
    });
    const callAi = makeCallAi(negativePrice);

    const result = await generateEventContent(
      { idea: 'Test', promoterId: 'p-001' },
      callAi,
    );

    expect(result.recommendedPriceHalire).toBe(0);
  });
});

describe('generateEventContent — chybové stavy', () => {
  it('vyhodí chybu při neplatném JSON výstupu AI', async () => {
    const callAi = makeCallAi('Tohle není JSON, omlouvám se.');

    await expect(
      generateEventContent({ idea: 'Test', promoterId: 'p-001' }, callAi),
    ).rejects.toThrow('invalid JSON');
  });

  it('AI chyba (rejected promise) propaguje výjimku', async () => {
    const callAi: CallAiFn = vi.fn().mockRejectedValue(new Error('API rate limit'));

    await expect(
      generateEventContent({ idea: 'Test', promoterId: 'p-001' }, callAi),
    ).rejects.toThrow('API rate limit');
  });

  it('prázdné tagy v odpovědi AI → vrátí prázdné pole', async () => {
    const noTags = JSON.stringify({ ...JSON.parse(VALID_JSON_RESPONSE), tags: null });
    const callAi = makeCallAi(noTags);

    const result = await generateEventContent(
      { idea: 'Test', promoterId: 'p-001' },
      callAi,
    );

    expect(result.tags).toEqual([]);
  });
});
