import { describe, it, expect, vi } from 'vitest';
import {
  createCampaign,
  startCampaign,
  processCampaignBatch,
  cancelCampaign,
  previewSegment,
} from '../services/bulk-email.service.js';
import { resolveSegment } from '../services/segment.service.js';
import { BulkEmailError } from '../lib/bulk-email-errors.js';
import type { ServiceDeps } from '../lib/service-container.js';

interface MockState {
  campaigns: Map<string, any>;
  recipients: Map<string, any>;
  segmentResult: Array<{ client_id: string; email: string; first_name: string }>;
}

function makeDeps(): { deps: ServiceDeps; state: MockState } {
  const state: MockState = {
    campaigns: new Map(),
    recipients: new Map(),
    segmentResult: [
      { client_id: 'c1', email: 'a@b.cz', first_name: 'Jan' },
      { client_id: 'c2', email: 'b@b.cz', first_name: 'Eva' },
    ],
  };
  const email = { send: vi.fn(async () => {}) };

  const db = {
    query: vi.fn(async (sql: string, params?: any[]) => {
      if (sql.includes('FROM platform.clients')) {
        return state.segmentResult;
      }
      if (sql.startsWith('INSERT INTO bulk_email.campaigns')) {
        const id = `camp${state.campaigns.size + 1}`;
        const row = {
          id,
          promoter_id: params![0],
          name: params![1],
          subject: params![2],
          html_body: params![3],
          segment: JSON.parse(params![4]),
          status: 'draft',
          total_recipients: 0,
          sent: 0,
          failed: 0,
          skipped: 0,
          created_by: params![5],
          created_at: new Date(),
          started_at: null,
          completed_at: null,
        };
        state.campaigns.set(id, row);
        return [row];
      }
      if (sql.startsWith('SELECT * FROM bulk_email.campaigns WHERE id = $1 AND promoter_id')) {
        const row = state.campaigns.get(params![0]);
        return row && row.promoter_id === params![1] ? [row] : [];
      }
      if (sql.startsWith('SELECT * FROM bulk_email.campaigns WHERE id = $1')) {
        const row = state.campaigns.get(params![0]);
        return row ? [row] : [];
      }
      if (sql.includes('SELECT id, email, first_name') && sql.includes('bulk_email.recipients')) {
        const out: any[] = [];
        for (const [id, r] of state.recipients) {
          if (r.campaign_id === params![0] && r.status === 'pending') {
            out.push({ id, email: r.email, first_name: r.first_name });
            if (out.length >= params![1]) break;
          }
        }
        return out;
      }
      if (sql.includes('COUNT(*)') && sql.includes('bulk_email.recipients')) {
        let count = 0;
        for (const r of state.recipients.values()) {
          if (r.campaign_id === params![0] && r.status === 'pending') count++;
        }
        return [{ count: String(count) }];
      }
      if (sql.includes('COUNT(*)') && sql.includes('bulk_email.campaigns')) {
        return [{ count: String(state.campaigns.size) }];
      }
      return [];
    }),
    execute: vi.fn(async (sql: string, params?: any[]) => {
      if (sql.startsWith('INSERT INTO bulk_email.recipients')) {
        const id = `rcp${state.recipients.size + 1}`;
        state.recipients.set(id, {
          campaign_id: params![0],
          client_id: params![1],
          email: params![2],
          first_name: params![3],
          status: 'pending',
        });
        return;
      }
      if (sql.includes("UPDATE bulk_email.campaigns") && sql.includes("total_recipients")) {
        const c = state.campaigns.get(params![1]);
        if (c) {
          c.total_recipients = params![0];
          c.status = 'queued';
          c.started_at = new Date();
        }
        return;
      }
      if (sql.includes("UPDATE bulk_email.campaigns") && sql.includes("status = 'sending'")) {
        const c = state.campaigns.get(params![0]);
        if (c && c.status === 'queued') c.status = 'sending';
        return;
      }
      if (sql.includes("UPDATE bulk_email.campaigns") && sql.includes("status = 'completed'")) {
        const c = state.campaigns.get(params![0]);
        if (c && c.status === 'sending') {
          c.status = 'completed';
          c.completed_at = new Date();
        }
        return;
      }
      if (sql.includes("UPDATE bulk_email.campaigns") && sql.includes("status = 'cancelled'")) {
        const c = state.campaigns.get(params![0]);
        if (c) {
          c.status = 'cancelled';
          c.completed_at = new Date();
        }
        return;
      }
      if (sql.includes("UPDATE bulk_email.campaigns") && sql.includes("sent = sent +")) {
        const c = state.campaigns.get(params![2]);
        if (c) {
          c.sent += params![0];
          c.failed += params![1];
        }
        return;
      }
      if (sql.includes("UPDATE bulk_email.recipients") && sql.includes("status = 'sent'")) {
        const r = state.recipients.get(params![0]);
        if (r) {
          r.status = 'sent';
          r.sent_at = new Date();
        }
        return;
      }
      if (sql.includes("UPDATE bulk_email.recipients") && sql.includes("status = 'failed'")) {
        const r = state.recipients.get(params![1]);
        if (r) {
          r.status = 'failed';
          r.error_message = params![0];
        }
        return;
      }
      if (sql.includes("UPDATE bulk_email.recipients") && sql.includes("status = 'skipped'")) {
        for (const r of state.recipients.values()) {
          if (r.campaign_id === params![0] && r.status === 'pending') {
            r.status = 'skipped';
            r.error_message = 'cancelled';
          }
        }
        return;
      }
    }),
    transaction: vi.fn(async (fn: any) => fn({ query: db.query, execute: db.execute })),
  };

  return {
    deps: { db, email } as unknown as ServiceDeps,
    state,
  };
}

describe('segment resolution', () => {
  it('resolves all segment', async () => {
    const { deps } = makeDeps();
    const result = await resolveSegment('p1', { type: 'all' }, deps);
    expect(result).toHaveLength(2);
    expect(result[0]!.email).toBe('a@b.cz');
  });

  it('throws on unknown segment type', async () => {
    const { deps } = makeDeps();
    await expect(resolveSegment('p1', { type: 'bogus' }, deps)).rejects.toThrow(BulkEmailError);
  });

  it('requires tags for tag segment', async () => {
    const { deps } = makeDeps();
    await expect(resolveSegment('p1', { type: 'tag' }, deps)).rejects.toThrow();
  });
});

describe('bulk-email service', () => {
  it('createCampaign happy path', async () => {
    const { deps } = makeDeps();
    const c = await createCampaign(
      {
        promoterId: 'p1',
        name: 'Jaro 2026',
        subject: 'Jarní sleva',
        htmlBody: '<p>Ahoj {{firstName}}</p>',
        segment: { type: 'all' },
      },
      'user1',
      deps,
    );
    expect(c.status).toBe('draft');
    expect(c.name).toBe('Jaro 2026');
  });

  it('previewSegment returns count + sample', async () => {
    const { deps } = makeDeps();
    const result = await previewSegment('p1', { type: 'all' }, deps);
    expect(result.count).toBe(2);
    expect(result.sample).toHaveLength(2);
  });

  it('startCampaign queues recipients and processes batch', async () => {
    const { deps, state } = makeDeps();
    const c = await createCampaign(
      {
        promoterId: 'p1',
        name: 'T',
        subject: 'S',
        htmlBody: 'Ahoj {{firstName}}',
        segment: { type: 'all' },
      },
      'u',
      deps,
    );
    const started = await startCampaign(c.id, 'p1', deps);
    expect(started.totalRecipients).toBe(2);
    expect(state.recipients.size).toBe(2);
    expect((deps.email.send as any).mock.calls.length).toBe(2);
  });

  it('empty segment rejects', async () => {
    const { deps, state } = makeDeps();
    state.segmentResult = [];
    const c = await createCampaign(
      {
        promoterId: 'p1',
        name: 'T',
        subject: 'S',
        htmlBody: 'x',
        segment: { type: 'all' },
      },
      'u',
      deps,
    );
    await expect(startCampaign(c.id, 'p1', deps)).rejects.toThrow(BulkEmailError);
  });

  it('cancel stops processing', async () => {
    const { deps } = makeDeps();
    const c = await createCampaign(
      { promoterId: 'p1', name: 'T', subject: 'S', htmlBody: 'x', segment: { type: 'all' } },
      'u',
      deps,
    );
    const cancelled = await cancelCampaign(c.id, 'p1', deps);
    expect(cancelled.status).toBe('cancelled');
  });

  it('processCampaignBatch updates counters', async () => {
    const { deps } = makeDeps();
    const c = await createCampaign(
      { promoterId: 'p1', name: 'T', subject: 'S', htmlBody: 'x', segment: { type: 'all' } },
      'u',
      deps,
    );
    await startCampaign(c.id, 'p1', deps);
    const result = await processCampaignBatch(c.id, 100, deps);
    expect(result.remaining).toBe(0);
  });
});
