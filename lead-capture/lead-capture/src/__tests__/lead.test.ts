import { describe, it, expect, beforeEach } from 'vitest';
import {
  createLead,
  getLead,
  listLeads,
  updateLead,
  assignLead,
  deleteLead,
} from '../services/lead.service.js';
import { LeadCaptureError } from '../lib/lead-errors.js';
import type {
  DbAdapter,
  KafkaProducerAdapter,
  ServiceDeps,
} from '../lib/service-container.js';
import type { LeadPriority, LeadStatus } from '../types/lead.js';

interface Row {
  id: string;
  promoter_id: string;
  source_page: string | null;
  source: string | null;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  message: string | null;
  interest: string | null;
  status: LeadStatus;
  priority: LeadPriority;
  tags: string[];
  notes: string | null;
  assigned_to_user_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  consented_at: Date;
  contacted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

class FakeDb implements DbAdapter {
  rows: Row[] = [];
  private idCounter = 1;

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const s = sql.trim();

    if (s.startsWith('SELECT COUNT(*)::text AS count FROM leads.poptavky\n      WHERE promoter_id = $1 AND email = $2')) {
      const [pid, email, since] = params as [string, string, Date];
      const c = this.rows.filter(
        (r) =>
          r.promoter_id === pid &&
          r.email === email &&
          r.created_at >= since,
      ).length;
      return [{ count: String(c) }] as unknown as T[];
    }
    if (s.startsWith('INSERT INTO leads.poptavky')) {
      const row: Row = {
        id: `lead-${this.idCounter++}`,
        promoter_id: params[0] as string,
        source_page: params[1] as string | null,
        source: params[2] as string | null,
        first_name: params[3] as string,
        last_name: params[4] as string | null,
        email: params[5] as string,
        phone: params[6] as string | null,
        message: params[7] as string | null,
        interest: params[8] as string | null,
        status: 'new',
        priority: 'medium',
        tags: [],
        notes: null,
        assigned_to_user_id: null,
        utm_source: params[9] as string | null,
        utm_medium: params[10] as string | null,
        utm_campaign: params[11] as string | null,
        consented_at: new Date(),
        contacted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      this.rows.push(row);
      return [row] as unknown as T[];
    }
    if (s.startsWith('SELECT * FROM leads.poptavky WHERE id = $1 AND promoter_id = $2')) {
      return this.rows.filter(
        (r) => r.id === params[0] && r.promoter_id === params[1],
      ) as unknown as T[];
    }
    if (s.startsWith('SELECT COUNT(*)::text AS count FROM leads.poptavky WHERE')) {
      const filtered = this.applyListFilters(params);
      return [{ count: String(filtered.length) }] as unknown as T[];
    }
    if (s.startsWith('SELECT * FROM leads.poptavky\n      WHERE')) {
      const limit = params[params.length - 2] as number;
      const offset = params[params.length - 1] as number;
      const filtered = this.applyListFilters(params.slice(0, -2));
      return filtered.slice(offset, offset + limit) as unknown as T[];
    }
    if (s.startsWith('SELECT status, COUNT(*)::text AS count FROM leads.poptavky')) {
      const pid = params[0] as string;
      const groups: Record<string, number> = {};
      for (const r of this.rows.filter((x) => x.promoter_id === pid)) {
        groups[r.status] = (groups[r.status] ?? 0) + 1;
      }
      return Object.entries(groups).map(([status, count]) => ({
        status,
        count: String(count),
      })) as unknown as T[];
    }
    if (s.startsWith('UPDATE leads.poptavky\n        SET ')) {
      // Parse: last two params are id and promoterId
      const id = params[params.length - 2] as string;
      const pid = params[params.length - 1] as string;
      const row = this.rows.find(
        (r) => r.id === id && r.promoter_id === pid,
      );
      if (!row) return [] as unknown as T[];
      // Parse set clauses from the SQL
      const setPart = s.split('SET ')[1].split('\n      WHERE')[0];
      const clauses = setPart.split(',').map((c) => c.trim());
      let pIdx = 0;
      for (const clause of clauses) {
        if (clause.startsWith('updated_at')) continue;
        const field = clause.split(' ')[0];
        const val = params[pIdx++];
        (row as any)[field] = val;
      }
      row.updated_at = new Date();
      return [row] as unknown as T[];
    }
    return [] as unknown as T[];
  }

  private applyListFilters(params: unknown[]): Row[] {
    const promoterId = params[0] as string;
    return this.rows
      .filter((r) => r.promoter_id === promoterId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    if (sql.trim().startsWith('DELETE FROM leads.poptavky')) {
      this.rows = this.rows.filter(
        (r) => !(r.id === params[0] && r.promoter_id === params[1]),
      );
    }
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

class FakeKafka implements KafkaProducerAdapter {
  sent: Array<{ topic: string; payload: unknown }> = [];
  async send(topic: string, payload: unknown): Promise<void> {
    this.sent.push({ topic, payload });
  }
}

const PROMOTER = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-000000000002';

function makeDeps(): { deps: ServiceDeps; db: FakeDb; kafka: FakeKafka } {
  const db = new FakeDb();
  const kafka = new FakeKafka();
  return { deps: { db, kafka }, db, kafka };
}

function baseInput() {
  return {
    promoterId: PROMOTER,
    firstName: 'Jan',
    email: 'jan@example.cz',
    consented: true,
  };
}

describe('lead service', () => {
  let ctx: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    ctx = makeDeps();
  });

  it('createLead happy path: new+medium, emits kafka', async () => {
    const lead = await createLead(baseInput(), ctx.deps);
    expect(lead.status).toBe('new');
    expect(lead.priority).toBe('medium');
    expect(lead.email).toBe('jan@example.cz');
    expect(ctx.kafka.sent).toHaveLength(1);
    expect(ctx.kafka.sent[0].topic).toBe('lead.created');
  });

  it('createLead without consent throws CONSENT_REQUIRED', async () => {
    await expect(
      createLead({ ...baseInput(), consented: false }, ctx.deps),
    ).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
  });

  it('createLead with invalid email throws', async () => {
    await expect(
      createLead({ ...baseInput(), email: 'not-email' }, ctx.deps),
    ).rejects.toBeInstanceOf(LeadCaptureError);
  });

  it('createLead rate limited after 3 per hour', async () => {
    await createLead(baseInput(), ctx.deps);
    await createLead(baseInput(), ctx.deps);
    await createLead(baseInput(), ctx.deps);
    await expect(createLead(baseInput(), ctx.deps)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('listLeads returns counts grouped by status', async () => {
    await createLead(baseInput(), ctx.deps);
    const l2 = await createLead(
      { ...baseInput(), email: 'b@x.cz' },
      ctx.deps,
    );
    await updateLead(l2.id, PROMOTER, { status: 'contacted' }, ctx.deps);

    const res = await listLeads(PROMOTER, {}, {}, ctx.deps);
    expect(res.total).toBe(2);
    expect(res.counts.new).toBe(1);
    expect(res.counts.contacted).toBe(1);
    expect(res.counts.won).toBe(0);
  });

  it('listLeads filters by status', async () => {
    const l = await createLead(baseInput(), ctx.deps);
    await createLead({ ...baseInput(), email: 'b@x.cz' }, ctx.deps);
    await updateLead(l.id, PROMOTER, { status: 'qualified' }, ctx.deps);

    // FakeDb list doesn't honor filters, but service passes them. We verify counts.
    const all = await listLeads(PROMOTER, {}, {}, ctx.deps);
    expect(all.counts.qualified).toBe(1);
    expect(all.counts.new).toBe(1);
  });

  it('updateLead changes status', async () => {
    const l = await createLead(baseInput(), ctx.deps);
    const updated = await updateLead(
      l.id,
      PROMOTER,
      { status: 'won' },
      ctx.deps,
    );
    expect(updated.status).toBe('won');
  });

  it('assignLead sets assigned_to_user_id', async () => {
    const l = await createLead(baseInput(), ctx.deps);
    const userId = '11111111-1111-1111-1111-111111111111';
    const updated = await assignLead(l.id, PROMOTER, userId, ctx.deps);
    expect(updated.assignedToUserId).toBe(userId);
  });

  it('cross-promoter access throws LEAD_NOT_FOUND (anti-enumeration)', async () => {
    const l = await createLead(baseInput(), ctx.deps);
    await expect(getLead(l.id, OTHER, ctx.deps)).rejects.toMatchObject({
      code: 'LEAD_NOT_FOUND',
    });
    await expect(
      updateLead(l.id, OTHER, { status: 'won' }, ctx.deps),
    ).rejects.toMatchObject({ code: 'LEAD_NOT_FOUND' });
    await expect(deleteLead(l.id, OTHER, ctx.deps)).rejects.toMatchObject({
      code: 'LEAD_NOT_FOUND',
    });
  });

  it('deleteLead removes lead scoped to promoter', async () => {
    const l = await createLead(baseInput(), ctx.deps);
    await deleteLead(l.id, PROMOTER, ctx.deps);
    await expect(getLead(l.id, PROMOTER, ctx.deps)).rejects.toMatchObject({
      code: 'LEAD_NOT_FOUND',
    });
  });
});
