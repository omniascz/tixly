import { describe, it, expect, vi } from 'vitest';
import {
  createTemplate,
  getDefaultTemplate,
  listTemplatesForEvent,
  setDefaultTemplate,
  deleteTemplate,
} from '../services/ticket-template.service.js';
import type { DbAdapter } from '../services/ticket-template.service.js';

const EVENT_ID = 'event-001';
const PROMOTER_ID = 'promoter-001';
const TEMPLATE_ID = 'template-001';

function makeTemplateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TEMPLATE_ID,
    event_id: EVENT_ID,
    promoter_id: PROMOTER_ID,
    name: 'Standard',
    logo_url: 'https://cdn.example.com/logo.png',
    background_color: '#1a1a1a',
    background_image_url: null,
    text_color: '#ffffff',
    custom_text: 'www.example.com',
    qr_position: 'bottom-right',
    is_default: false,
    created_at: '2026-04-14T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
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
    transaction: vi.fn(async (fn) => fn({
      query: vi.fn().mockResolvedValue([]),
      execute: executeMock,
      transaction: vi.fn(),
    } as DbAdapter)),
  };
}

describe('createTemplate', () => {
  it('vytvoří novou ticket template', async () => {
    const db = makeDb([[makeTemplateRow()]]);

    const result = await createTemplate(PROMOTER_ID, {
      eventId: EVENT_ID,
      name: 'Standard',
      logoUrl: 'https://cdn.example.com/logo.png',
      backgroundColor: '#1a1a1a',
      textColor: '#ffffff',
      customText: 'www.example.com',
      qrPosition: 'bottom-right',
    }, db);

    expect(result.name).toBe('Standard');
    expect(result.logoUrl).toBe('https://cdn.example.com/logo.png');
    expect(result.isDefault).toBe(false);
  });

  it('vyhodí VALIDATION_ERROR bez logoUrl', async () => {
    const db = makeDb([]);

    await expect(
      createTemplate(PROMOTER_ID, {
        eventId: EVENT_ID,
        name: 'Template',
        logoUrl: '',
      }, db),
    ).rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('getDefaultTemplate', () => {
  it('vrátí výchozí šablonu pro event', async () => {
    const db = makeDb([[makeTemplateRow({ is_default: true })]]);

    const result = await getDefaultTemplate(EVENT_ID, db);

    expect(result).not.toBeNull();
    expect(result?.isDefault).toBe(true);
  });

  it('vrátí null pokud žádná default šablona neexistuje', async () => {
    const db = makeDb([[]]);

    const result = await getDefaultTemplate(EVENT_ID, db);

    expect(result).toBeNull();
  });
});

describe('listTemplatesForEvent', () => {
  it('vrátí všechny šablony pro event (default first)', async () => {
    const db = makeDb([[
      makeTemplateRow({ id: 't1', is_default: true }),
      makeTemplateRow({ id: 't2', is_default: false }),
    ]]);

    const result = await listTemplatesForEvent(EVENT_ID, PROMOTER_ID, db);

    expect(result).toHaveLength(2);
    expect(result[0].isDefault).toBe(true);
  });
});

describe('setDefaultTemplate', () => {
  it('nastaví šablonu jako default (transakce) a ostatní na false', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb(
      [[makeTemplateRow({ is_default: true })]],
      executeMock,
    );

    const result = await setDefaultTemplate(TEMPLATE_ID, EVENT_ID, PROMOTER_ID, db);

    expect(result.isDefault).toBe(true);
    // Ověř že byly volány UPDATE příkazy pro clear ostatních a set nového
    expect(executeMock).toHaveBeenCalledTimes(2);
  });
});

describe('deleteTemplate', () => {
  it('smaže šablonu (tenant-scoped)', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([], executeMock);

    await deleteTemplate(TEMPLATE_ID, PROMOTER_ID, db);

    expect(executeMock).toHaveBeenCalledTimes(1);
    const sql = executeMock.mock.calls[0][0] as string;
    expect(sql).toContain('DELETE');
    expect(sql).toContain('promoter_id = $2');
  });
});
