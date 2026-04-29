import { describe, it, expect, beforeEach } from 'vitest';
import {
  subscribe,
  confirmSubscription,
  unsubscribe,
  unsubscribeByEmail,
  listSubscribers,
  tagSubscriber,
} from '../services/newsletter.service.js';
import { NewsletterError } from '../lib/newsletter-errors.js';
import type { DbAdapter } from '../lib/service-container.js';

interface SubRow {
  id: string;
  promoter_id: string;
  email: string;
  first_name: string | null;
  status: string;
  tags: string[];
  source: string | null;
  confirmed_at: Date | null;
  unsubscribed_at: Date | null;
  created_at: Date;
}

interface TokRow {
  token: string;
  subscriber_id: string;
  type: string;
  expires_at: Date;
  used_at: Date | null;
}

class FakeDb implements DbAdapter {
  subscribers: SubRow[] = [];
  tokens: TokRow[] = [];
  private idCounter = 1;

  private nextId(): string {
    return `sub-${this.idCounter++}`;
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const s = sql.trim();

    if (s.startsWith('SELECT * FROM newsletter.subscribers WHERE promoter_id = $1 AND email = $2')) {
      return this.subscribers.filter(
        (x) => x.promoter_id === params[0] && x.email === params[1],
      ) as unknown as T[];
    }
    if (s.startsWith('SELECT * FROM newsletter.subscribers WHERE id = $1')) {
      return this.subscribers.filter((x) => x.id === params[0]) as unknown as T[];
    }
    if (s.startsWith('INSERT INTO newsletter.subscribers')) {
      const row: SubRow = {
        id: this.nextId(),
        promoter_id: params[0] as string,
        email: params[1] as string,
        first_name: params[2] as string | null,
        status: 'pending',
        tags: (params[3] as string[]) ?? [],
        source: params[4] as string | null,
        confirmed_at: null,
        unsubscribed_at: null,
        created_at: new Date(),
      };
      this.subscribers.push(row);
      return [row] as unknown as T[];
    }
    if (s.startsWith('UPDATE newsletter.subscribers\n        SET status = \'confirmed\'')) {
      const row = this.subscribers.find((x) => x.id === params[0]);
      if (!row) return [] as unknown as T[];
      row.status = 'confirmed';
      row.confirmed_at = new Date();
      return [row] as unknown as T[];
    }
    if (s.startsWith('UPDATE newsletter.subscribers\n        SET status = \'unsubscribed\'')) {
      let row: SubRow | undefined;
      if (s.includes('WHERE id = $1\n      RETURNING')) {
        row = this.subscribers.find((x) => x.id === params[0]);
      } else {
        row = this.subscribers.find(
          (x) => x.promoter_id === params[0] && x.email === params[1],
        );
      }
      if (!row) return [] as unknown as T[];
      row.status = 'unsubscribed';
      row.unsubscribed_at = new Date();
      return [row] as unknown as T[];
    }
    if (s.startsWith('UPDATE newsletter.subscribers\n        SET tags')) {
      const row = this.subscribers.find(
        (x) => x.id === params[0] && x.promoter_id === params[1],
      );
      if (!row) return [] as unknown as T[];
      row.tags = params[2] as string[];
      return [row] as unknown as T[];
    }
    if (s.startsWith('SELECT * FROM newsletter.tokens WHERE token = $1 AND type = $2')) {
      return this.tokens.filter(
        (t) => t.token === params[0] && t.type === params[1],
      ) as unknown as T[];
    }
    if (s.startsWith('SELECT * FROM newsletter.tokens WHERE token = $1')) {
      return this.tokens.filter((t) => t.token === params[0]) as unknown as T[];
    }
    if (s.startsWith('SELECT COUNT(*)')) {
      const filtered = this.filterSubs(params);
      return [{ count: String(filtered.length) }] as unknown as T[];
    }
    if (s.startsWith('SELECT * FROM newsletter.subscribers\n      WHERE')) {
      const limit = params[params.length - 2] as number;
      const offset = params[params.length - 1] as number;
      const filtered = this.filterSubs(params.slice(0, -2));
      return filtered.slice(offset, offset + limit) as unknown as T[];
    }
    return [] as unknown as T[];
  }

  private filterSubs(params: unknown[]): SubRow[] {
    const [promoterId, status, tags] = [
      params[0],
      params[1],
      params[2],
    ] as [string, string | undefined, string[] | undefined];
    return this.subscribers.filter((x) => {
      if (x.promoter_id !== promoterId) return false;
      if (status && x.status !== status) return false;
      if (tags && !tags.some((t) => x.tags.includes(t))) return false;
      return true;
    });
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    const s = sql.trim();
    if (s.startsWith('INSERT INTO newsletter.tokens')) {
      this.tokens.push({
        token: params[0] as string,
        subscriber_id: params[1] as string,
        type: params[2] as string,
        expires_at: params[3] as Date,
        used_at: null,
      });
      return;
    }
    if (s.startsWith('UPDATE newsletter.tokens SET used_at')) {
      const t = this.tokens.find((x) => x.token === params[0]);
      if (t) t.used_at = new Date();
      return;
    }
    if (s.startsWith('UPDATE newsletter.subscribers\n         SET status = \'pending\'')) {
      const row = this.subscribers.find(
        (x) => x.id === params[0] && x.promoter_id === params[1],
      );
      if (!row) return;
      row.status = 'pending';
      if (params[2] !== null) row.first_name = params[2] as string;
      if (params[3] !== null) row.source = params[3] as string;
      if (params[4] !== null) row.tags = params[4] as string[];
      row.unsubscribed_at = null;
      return;
    }
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

const PROMOTER = '00000000-0000-0000-0000-000000000001';

describe('newsletter service', () => {
  let db: FakeDb;
  let deps: { db: FakeDb };

  beforeEach(() => {
    db = new FakeDb();
    deps = { db };
  });

  it('subscribe happy path: pending + token generated', async () => {
    const { subscriber, confirmationToken } = await subscribe(
      { promoterId: PROMOTER, email: 'Test@Example.COM' },
      deps,
    );
    expect(subscriber.status).toBe('pending');
    expect(subscriber.email).toBe('test@example.com');
    expect(confirmationToken).toHaveLength(128);
    expect(db.tokens).toHaveLength(1);
  });

  it('subscribe duplicate confirmed throws ALREADY_SUBSCRIBED', async () => {
    const { confirmationToken } = await subscribe(
      { promoterId: PROMOTER, email: 'a@b.cz' },
      deps,
    );
    await confirmSubscription(confirmationToken, deps);
    await expect(
      subscribe({ promoterId: PROMOTER, email: 'a@b.cz' }, deps),
    ).rejects.toMatchObject({ code: 'ALREADY_SUBSCRIBED' });
  });

  it('subscribe duplicate pending re-issues token (no error)', async () => {
    await subscribe({ promoterId: PROMOTER, email: 'a@b.cz' }, deps);
    const second = await subscribe(
      { promoterId: PROMOTER, email: 'a@b.cz' },
      deps,
    );
    expect(second.confirmationToken).toHaveLength(128);
    expect(db.tokens).toHaveLength(2);
    expect(db.subscribers).toHaveLength(1);
  });

  it('subscribe invalid email throws', async () => {
    await expect(
      subscribe({ promoterId: PROMOTER, email: 'not-an-email' }, deps),
    ).rejects.toBeInstanceOf(NewsletterError);
  });

  it('confirmSubscription happy path', async () => {
    const { confirmationToken } = await subscribe(
      { promoterId: PROMOTER, email: 'a@b.cz' },
      deps,
    );
    const confirmed = await confirmSubscription(confirmationToken, deps);
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.confirmedAt).toBeInstanceOf(Date);
  });

  it('confirmSubscription expired token throws', async () => {
    const { confirmationToken } = await subscribe(
      { promoterId: PROMOTER, email: 'a@b.cz' },
      deps,
    );
    const t = db.tokens.find((x) => x.token === confirmationToken)!;
    t.expires_at = new Date(Date.now() - 1000);
    await expect(
      confirmSubscription(confirmationToken, deps),
    ).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  });

  it('confirmSubscription with invalid token throws', async () => {
    await expect(
      confirmSubscription('nope', deps),
    ).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('unsubscribe via token', async () => {
    const { confirmationToken } = await subscribe(
      { promoterId: PROMOTER, email: 'a@b.cz' },
      deps,
    );
    await confirmSubscription(confirmationToken, deps);
    // re-subscribe to get a fresh token to use as unsub target
    const r = await subscribe({ promoterId: PROMOTER, email: 'a@b.cz' }, deps)
      .catch(() => null);
    // already confirmed throws; use the old token row instead
    const row = db.tokens[0];
    const result = await unsubscribe(row.token, deps);
    expect(result.status).toBe('unsubscribed');
  });

  it('unsubscribeByEmail', async () => {
    const { confirmationToken } = await subscribe(
      { promoterId: PROMOTER, email: 'a@b.cz' },
      deps,
    );
    await confirmSubscription(confirmationToken, deps);
    const result = await unsubscribeByEmail(PROMOTER, 'a@b.cz', deps);
    expect(result.status).toBe('unsubscribed');
  });

  it('listSubscribers filters by status and tags', async () => {
    await subscribe(
      { promoterId: PROMOTER, email: 'a@b.cz', tags: ['ems'] },
      deps,
    );
    const { confirmationToken } = await subscribe(
      { promoterId: PROMOTER, email: 'c@d.cz', tags: ['ems', 'brno'] },
      deps,
    );
    await confirmSubscription(confirmationToken, deps);

    const pending = await listSubscribers(
      PROMOTER,
      { status: 'pending' },
      {},
      deps,
    );
    expect(pending.total).toBe(1);

    const brno = await listSubscribers(
      PROMOTER,
      { tags: ['brno'] },
      {},
      deps,
    );
    expect(brno.total).toBe(1);
    expect(brno.items[0].email).toBe('c@d.cz');
  });

  it('tagSubscriber updates tags scoped by promoter', async () => {
    const { subscriber } = await subscribe(
      { promoterId: PROMOTER, email: 'a@b.cz' },
      deps,
    );
    const updated = await tagSubscriber(
      subscriber.id,
      PROMOTER,
      ['vip'],
      deps,
    );
    expect(updated.tags).toEqual(['vip']);

    await expect(
      tagSubscriber(subscriber.id, 'other-promoter', ['x'], deps),
    ).rejects.toMatchObject({ code: 'SUBSCRIBER_NOT_FOUND' });
  });
});
