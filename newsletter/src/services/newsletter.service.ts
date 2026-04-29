import { randomBytes } from 'crypto';
import type { ServiceDeps } from '../lib/service-container.js';
import { NewsletterError } from '../lib/newsletter-errors.js';
import type {
  NewsletterSubscriber,
  SubscribeInput,
  SubscriberStatus,
} from '../types/newsletter.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_TTL_DAYS = 7;

interface SubscriberRow {
  id: string;
  promoter_id: string;
  email: string;
  first_name: string | null;
  status: SubscriberStatus;
  tags: string[] | null;
  source: string | null;
  confirmed_at: Date | null;
  unsubscribed_at: Date | null;
  created_at: Date;
}

function mapSubscriber(row: SubscriberRow): NewsletterSubscriber {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    email: row.email,
    firstName: row.first_name,
    status: row.status,
    tags: row.tags ?? [],
    source: row.source,
    confirmedAt: row.confirmed_at,
    unsubscribedAt: row.unsubscribed_at,
    createdAt: row.created_at,
  };
}

function generateToken(): string {
  return randomBytes(64).toString('hex');
}

function expiresAt(): Date {
  return new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

async function issueToken(
  subscriberId: string,
  type: 'confirm' | 'unsubscribe',
  deps: ServiceDeps,
): Promise<string> {
  const token = generateToken();
  await deps.db.execute(
    `INSERT INTO newsletter.tokens (token, subscriber_id, type, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [token, subscriberId, type, expiresAt()],
  );
  return token;
}

export async function subscribe(
  input: SubscribeInput,
  deps: ServiceDeps,
): Promise<{ subscriber: NewsletterSubscriber; confirmationToken: string }> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    throw new NewsletterError('EMAIL_INVALID');
  }

  const existing = await deps.db.query<SubscriberRow>(
    `SELECT * FROM newsletter.subscribers WHERE promoter_id = $1 AND email = $2`,
    [input.promoterId, email],
  );

  if (existing.length > 0) {
    const row = existing[0];
    if (row.status === 'confirmed') {
      throw new NewsletterError('ALREADY_SUBSCRIBED');
    }
    // pending/unsubscribed/bounced: re-issue confirmation
    await deps.db.execute(
      `UPDATE newsletter.subscribers
         SET status = 'pending',
             first_name = COALESCE($3, first_name),
             source = COALESCE($4, source),
             tags = COALESCE($5, tags),
             unsubscribed_at = NULL
       WHERE id = $1 AND promoter_id = $2`,
      [
        row.id,
        input.promoterId,
        input.firstName ?? null,
        input.source ?? null,
        input.tags ?? null,
      ],
    );
    const token = await issueToken(row.id, 'confirm', deps);
    const refreshed = await deps.db.query<SubscriberRow>(
      `SELECT * FROM newsletter.subscribers WHERE id = $1`,
      [row.id],
    );
    return { subscriber: mapSubscriber(refreshed[0]), confirmationToken: token };
  }

  const inserted = await deps.db.query<SubscriberRow>(
    `INSERT INTO newsletter.subscribers
       (promoter_id, email, first_name, status, tags, source)
     VALUES ($1, $2, $3, 'pending', $4, $5)
     RETURNING *`,
    [
      input.promoterId,
      email,
      input.firstName ?? null,
      input.tags ?? [],
      input.source ?? null,
    ],
  );
  const subscriber = mapSubscriber(inserted[0]);
  const token = await issueToken(subscriber.id, 'confirm', deps);
  return { subscriber, confirmationToken: token };
}

interface TokenRow {
  token: string;
  subscriber_id: string;
  type: 'confirm' | 'unsubscribe';
  expires_at: Date;
  used_at: Date | null;
}

async function consumeToken(
  token: string,
  type: 'confirm' | 'unsubscribe',
  deps: ServiceDeps,
): Promise<TokenRow> {
  const rows = await deps.db.query<TokenRow>(
    `SELECT * FROM newsletter.tokens WHERE token = $1 AND type = $2`,
    [token, type],
  );
  if (rows.length === 0) {
    throw new NewsletterError('TOKEN_INVALID');
  }
  const row = rows[0];
  if (row.used_at) {
    throw new NewsletterError('TOKEN_INVALID');
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new NewsletterError('TOKEN_EXPIRED');
  }
  await deps.db.execute(
    `UPDATE newsletter.tokens SET used_at = NOW() WHERE token = $1`,
    [token],
  );
  return row;
}

export async function confirmSubscription(
  token: string,
  deps: ServiceDeps,
): Promise<NewsletterSubscriber> {
  const row = await consumeToken(token, 'confirm', deps);
  const updated = await deps.db.query<SubscriberRow>(
    `UPDATE newsletter.subscribers
        SET status = 'confirmed', confirmed_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [row.subscriber_id],
  );
  if (updated.length === 0) {
    throw new NewsletterError('SUBSCRIBER_NOT_FOUND');
  }
  return mapSubscriber(updated[0]);
}

export async function unsubscribe(
  token: string,
  deps: ServiceDeps,
): Promise<NewsletterSubscriber> {
  // Allow either a dedicated unsubscribe token OR a confirm token (some UX flows reuse it).
  const rows = await deps.db.query<TokenRow>(
    `SELECT * FROM newsletter.tokens WHERE token = $1`,
    [token],
  );
  if (rows.length === 0) {
    throw new NewsletterError('TOKEN_INVALID');
  }
  const tokenRow = rows[0];
  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    throw new NewsletterError('TOKEN_EXPIRED');
  }
  const existing = await deps.db.query<SubscriberRow>(
    `SELECT * FROM newsletter.subscribers WHERE id = $1`,
    [tokenRow.subscriber_id],
  );
  if (existing.length === 0) {
    throw new NewsletterError('SUBSCRIBER_NOT_FOUND');
  }
  if (existing[0].status === 'unsubscribed') {
    throw new NewsletterError('ALREADY_UNSUBSCRIBED');
  }
  const updated = await deps.db.query<SubscriberRow>(
    `UPDATE newsletter.subscribers
        SET status = 'unsubscribed', unsubscribed_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [tokenRow.subscriber_id],
  );
  return mapSubscriber(updated[0]);
}

export async function unsubscribeByEmail(
  promoterId: string,
  email: string,
  deps: ServiceDeps,
): Promise<NewsletterSubscriber> {
  const normalized = email.trim().toLowerCase();
  const existing = await deps.db.query<SubscriberRow>(
    `SELECT * FROM newsletter.subscribers WHERE promoter_id = $1 AND email = $2`,
    [promoterId, normalized],
  );
  if (existing.length === 0) {
    throw new NewsletterError('SUBSCRIBER_NOT_FOUND');
  }
  if (existing[0].status === 'unsubscribed') {
    throw new NewsletterError('ALREADY_UNSUBSCRIBED');
  }
  const updated = await deps.db.query<SubscriberRow>(
    `UPDATE newsletter.subscribers
        SET status = 'unsubscribed', unsubscribed_at = NOW()
      WHERE promoter_id = $1 AND email = $2
      RETURNING *`,
    [promoterId, normalized],
  );
  return mapSubscriber(updated[0]);
}

export async function listSubscribers(
  promoterId: string,
  filters: { status?: SubscriberStatus; tags?: string[] },
  pagination: { limit?: number; offset?: number },
  deps: ServiceDeps,
): Promise<{ items: NewsletterSubscriber[]; total: number }> {
  const where: string[] = ['promoter_id = $1'];
  const params: unknown[] = [promoterId];
  if (filters.status) {
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  }
  if (filters.tags && filters.tags.length > 0) {
    params.push(filters.tags);
    where.push(`tags && $${params.length}::text[]`);
  }
  const whereSql = where.join(' AND ');

  const limit = Math.min(pagination.limit ?? 50, 200);
  const offset = pagination.offset ?? 0;

  const countRows = await deps.db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM newsletter.subscribers WHERE ${whereSql}`,
    params,
  );
  const total = parseInt(countRows[0]?.count ?? '0', 10);

  const pagedParams = [...params, limit, offset];
  const items = await deps.db.query<SubscriberRow>(
    `SELECT * FROM newsletter.subscribers
      WHERE ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${pagedParams.length - 1} OFFSET $${pagedParams.length}`,
    pagedParams,
  );

  return { items: items.map(mapSubscriber), total };
}

export async function tagSubscriber(
  subscriberId: string,
  promoterId: string,
  tags: string[],
  deps: ServiceDeps,
): Promise<NewsletterSubscriber> {
  const updated = await deps.db.query<SubscriberRow>(
    `UPDATE newsletter.subscribers
        SET tags = $3
      WHERE id = $1 AND promoter_id = $2
      RETURNING *`,
    [subscriberId, promoterId, tags],
  );
  if (updated.length === 0) {
    throw new NewsletterError('SUBSCRIBER_NOT_FOUND');
  }
  return mapSubscriber(updated[0]);
}
