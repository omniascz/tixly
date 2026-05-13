import { Pool, PoolClient } from 'pg';
import Redis from 'ioredis';
import nodemailer from 'nodemailer';

export type { DbAdapter } from '@tixly/db-adapter';
import type { DbAdapter } from '@tixly/db-adapter';

export interface RedisAdapter {
  setex(key: string, seconds: number, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
}

export interface KafkaProducerAdapter {
  send(topic: string, payload: unknown): Promise<void>;
}

export interface EmailAdapter {
  send(to: string, subject: string, html: string): Promise<void>;
}

export interface ServiceDeps {
  db: DbAdapter;
  redis: RedisAdapter;
  kafka: KafkaProducerAdapter;
  email: EmailAdapter;
}

declare global {
  var _promoterOnboardingDeps: ServiceDeps | undefined;
}

class PgDbAdapter implements DbAdapter {
  constructor(private pool: Pool) {}

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await this.pool.query(sql, params);
    return result.rows as T[];
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    await this.pool.query(sql, params);
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txAdapter = new PgDbAdapter(this.pool);
      txAdapter.setClient(client);
      const result = await fn(txAdapter);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  setClient(client: PoolClient): void {
    // Override pool with single client for transaction
    (this as any).pool = {
      query: (sql: string, params?: unknown[]) => client.query(sql, params),
    };
  }
}

class IoRedisAdapter implements RedisAdapter {
  private client: Redis;

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl);
  }

  async setex(key: string, seconds: number, value: string): Promise<void> {
    await this.client.setex(key, seconds, value);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds);
  }
}

class HttpKafkaProducerAdapter implements KafkaProducerAdapter {
  constructor(private brokerUrl: string) {}

  async send(topic: string, payload: unknown): Promise<void> {
    if (!this.brokerUrl) {
      // No-op for tests/dev when KAFKA_BROKER_URL is not set
      return;
    }
    try {
      await fetch(`${this.brokerUrl}/topics/${topic}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.kafka.json.v2+json' },
        body: JSON.stringify({
          records: [{ value: JSON.stringify(payload) }],
        }),
      });
    } catch (err) {
      // Fire-and-forget: log but don't throw
      console.error(`Failed to send Kafka message to topic ${topic}:`, err);
    }
  }
}

class NodemailerEmailAdapter implements EmailAdapter {
  private transporter: any = null;
  private from: string;

  constructor() {
    this.from = process.env.EMAIL_FROM ?? 'noreply@tixly.cz';
    const host = process.env.SMTP_HOST;
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT ?? '587'),
        secure: false, // STARTTLS
        auth: {
          user: process.env.SMTP_USER ?? '',
          pass: process.env.SMTP_PASS ?? '',
        },
      });
    }
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.transporter) {
      console.log(`[email-dev] To: ${to} | Subject: ${subject}`);
      return;
    }
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject,
      html,
    });
  }
}

export function getServiceDeps(): ServiceDeps {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  if (!global._promoterOnboardingDeps) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });

    const db = new PgDbAdapter(pool);
    const redis = new IoRedisAdapter(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const kafka = new HttpKafkaProducerAdapter(process.env.KAFKA_BROKER_URL ?? '');
    const email = new NodemailerEmailAdapter();

    global._promoterOnboardingDeps = { db, redis, kafka, email };
  }

  return global._promoterOnboardingDeps;
}
