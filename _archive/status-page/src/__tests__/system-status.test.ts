import { describe, it, expect, vi } from 'vitest';
import {
  getSystemStatus,
  updateComponentStatus,
  createIncident,
  addIncidentUpdate,
  resolveIncident,
  getActiveIncidents,
} from '../services/system-status.service.js';
import type { DbAdapter } from '../services/system-status.service.js';

const COMPONENT_ID = 'api';
const INCIDENT_ID = 'incident-001';

function makeComponentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: COMPONENT_ID,
    name: 'Main API',
    description: 'Ticketing API',
    status: 'operational',
    last_updated_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeIncidentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INCIDENT_ID,
    title: 'API Latency',
    description: 'Elevated response times',
    affected_component_ids: ['api'],
    severity: 'major',
    status: 'investigating',
    started_at: '2026-04-14T10:30:00Z',
    resolved_at: null,
    updates: [],
    created_at: '2026-04-14T10:30:00Z',
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

describe('getSystemStatus', () => {
  it('vrátí všechny komponenty seřazené dle name', async () => {
    const db = makeDb([[
      makeComponentRow({ id: 'api', status: 'operational' }),
      makeComponentRow({ id: 'db', status: 'operational' }),
    ]]);

    const result = await getSystemStatus(db);

    expect(result).toHaveLength(2);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('ORDER BY name');
  });
});

describe('updateComponentStatus', () => {
  it('změní status komponenty a nastaví last_updated_at', async () => {
    const db = makeDb([[makeComponentRow({ status: 'degraded' })]]);

    const result = await updateComponentStatus(COMPONENT_ID, 'degraded', db);

    expect(result.status).toBe('degraded');
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('last_updated_at = NOW()');
  });

  it('vyhodí NOT_FOUND pokud komponenta neexistuje', async () => {
    const db = makeDb([[]]);

    await expect(updateComponentStatus('nonexistent', 'down', db)).rejects.toThrow('NOT_FOUND');
  });
});

describe('createIncident', () => {
  it('vytvoří nový incident s investigování statusem', async () => {
    const db = makeDb([[makeIncidentRow()]]);

    const result = await createIncident(
      'API Latency',
      'Elevated response times',
      ['api'],
      'major',
      db,
    );

    expect(result.status).toBe('investigating');
    expect(result.severity).toBe('major');
    expect(result.affectedComponentIds).toEqual(['api']);
  });
});

describe('addIncidentUpdate', () => {
  it('přidá update do updates pole JSONB', async () => {
    const db = makeDb([[makeIncidentRow({
      updates: [{ message: 'Initial', timestamp: '2026-04-14T10:30:00Z' }],
    })]]);

    const result = await addIncidentUpdate(INCIDENT_ID, 'Investigating database', db);

    expect(result.updates).toHaveLength(1);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('jsonb_build_array');
  });

  it('vyhodí NOT_FOUND pokud incident je již resolved', async () => {
    const db = makeDb([[]]);

    await expect(addIncidentUpdate(INCIDENT_ID, 'Message', db)).rejects.toThrow('NOT_FOUND');
  });
});

describe('resolveIncident', () => {
  it('změní status na resolved a nastaví resolved_at', async () => {
    const db = makeDb([[makeIncidentRow({ status: 'resolved', resolved_at: '2026-04-14T11:30:00Z' })]]);

    const result = await resolveIncident(INCIDENT_ID, 'Database scaled up', db);

    expect(result.status).toBe('resolved');
    expect(result.resolvedAt).toBe('2026-04-14T11:30:00Z');
  });
});

describe('getActiveIncidents', () => {
  it('vrátí aktivní incidenty a nedávné (7 dní)', async () => {
    const db = makeDb([[
      makeIncidentRow({ status: 'investigating' }),
      makeIncidentRow({ id: 'inc-2', status: 'resolved', resolved_at: '2026-04-10T10:00:00Z' }),
    ]]);

    const result = await getActiveIncidents(db);

    expect(result).toHaveLength(2);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('resolved_at > NOW() - INTERVAL \'7 days\'');
  });
});
