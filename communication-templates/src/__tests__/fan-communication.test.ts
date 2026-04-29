import { describe, it, expect, vi } from 'vitest';
import {
  upsertTemplate,
  listTemplates,
  previewTemplate,
  toggleTemplateEnabled,
} from '../services/fan-communication.service.js';
import type { DbAdapter } from '../services/fan-communication.service.js';

const PROMOTER_ID = 'promoter-001';
const EVENT_ID = 'event-001';
const TEMPLATE_ID = 'template-001';

function makeTemplateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TEMPLATE_ID,
    promoter_id: PROMOTER_ID,
    event_id: EVENT_ID,
    type: 'email',
    template_name: 'countdown_7d',
    subject: '{{eventTitle}} — Zbývá 7 dní!',
    body: 'Ahoj!\n\n{{eventTitle}} proběhne {{eventDate}} v {{eventTime}}.\nVenue: {{venueAddress}}\n\nZískej vstupenku: {{ticketUrl}}',
    enabled: true,
    scheduled_for: null,
    created_at: '2026-04-14T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = []): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: vi.fn(),
    transaction: vi.fn(async (fn) => fn({
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn(),
      transaction: vi.fn(),
    } as DbAdapter)),
  };
}

describe('upsertTemplate', () => {
  it('vytvoří šablonu s ON CONFLICT upsert', async () => {
    const db = makeDb([[makeTemplateRow()]]);

    const result = await upsertTemplate(PROMOTER_ID, EVENT_ID, {
      type: 'email',
      templateName: 'countdown_7d',
      subject: 'Days left!',
      body: 'Ahoj {{eventTitle}}!',
    }, db);

    expect(result.type).toBe('email');
    expect(result.templateName).toBe('countdown_7d');
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('ON CONFLICT');
  });

  it('podporuje SMS bez subject', async () => {
    const db = makeDb([[makeTemplateRow({ type: 'sms', subject: null })]]);

    const result = await upsertTemplate(PROMOTER_ID, EVENT_ID, {
      type: 'sms',
      templateName: 'countdown_1d',
      body: '{{eventTitle}} zítra v {{eventTime}}!',
    }, db);

    expect(result.type).toBe('sms');
    expect(result.subject).toBeNull();
  });

  it('přijme scheduledFor pro automatické odeslání', async () => {
    const db = makeDb([[makeTemplateRow({ scheduled_for: '2026-04-13T08:00:00Z' })]]);

    const result = await upsertTemplate(PROMOTER_ID, EVENT_ID, {
      type: 'email',
      templateName: 'countdown_1d',
      body: 'Body',
      scheduledFor: '2026-04-13T08:00:00Z',
    }, db);

    expect(result.scheduledFor).toBe('2026-04-13T08:00:00Z');
  });
});

describe('listTemplates', () => {
  it('vrátí všechny šablony pro event (tenant-scoped)', async () => {
    const db = makeDb([[
      makeTemplateRow({ template_name: 'countdown_7d' }),
      makeTemplateRow({ id: 'tpl-2', template_name: 'countdown_1d' }),
      makeTemplateRow({ id: 'tpl-3', type: 'sms', template_name: 'venue_info' }),
    ]]);

    const result = await listTemplates(EVENT_ID, PROMOTER_ID, db);

    expect(result).toHaveLength(3);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('promoter_id = $2');
  });
});

describe('previewTemplate', () => {
  it('nahradí placeholders za konkrétní hodnoty', async () => {
    const db = makeDb([[makeTemplateRow()]]);

    const result = await previewTemplate(TEMPLATE_ID, {
      eventTitle: 'Rolling Stones Live',
      eventDate: '2026-04-20',
      eventTime: '19:00',
      venueAddress: 'O2 Arena, Praha',
      ticketUrl: 'https://tickets.example.com/event-001',
    }, db);

    expect(result.subject).toContain('Rolling Stones Live');
    expect(result.subject).toContain('7 dní');
    expect(result.body).toContain('Rolling Stones Live');
    expect(result.body).toContain('2026-04-20');
    expect(result.body).toContain('19:00');
    expect(result.body).toContain('O2 Arena');
  });

  it('vyhodí NOT_FOUND pokud šablona neexistuje', async () => {
    const db = makeDb([[]]);

    await expect(
      previewTemplate(TEMPLATE_ID, {
        eventTitle: '', eventDate: '', eventTime: '', venueAddress: '', ticketUrl: '',
      }, db),
    ).rejects.toThrow('NOT_FOUND');
  });
});

describe('toggleTemplateEnabled', () => {
  it('změní enabled flag', async () => {
    const db = makeDb([[makeTemplateRow({ enabled: false })]]);

    const result = await toggleTemplateEnabled(TEMPLATE_ID, PROMOTER_ID, false, db);

    expect(result.enabled).toBe(false);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('enabled = $1');
  });

  it('je tenant-scoped na promoter_id', async () => {
    const db = makeDb([[]]);

    await expect(
      toggleTemplateEnabled(TEMPLATE_ID, 'wrong-promoter', true, db),
    ).rejects.toThrow('NOT_FOUND');
  });
});
