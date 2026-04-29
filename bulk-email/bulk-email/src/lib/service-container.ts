import { Pool, PoolClient } from 'pg';

export type { DbAdapter } from '@tixly/db-adapter';
import type { DbAdapter } from '@tixly/db-adapter';

export interface EmailAdapter {
  send(to: string, subject: string, html: string): Promise<void>;
}

export interface ServiceDeps {
  db: DbAdapter;
  email: EmailAdapter;
}

declare global {
  var _bulkEmailDeps: ServiceDeps | undefined;
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
    (this as any).pool = {
      query: (sql: string, params?: unknown[]) => client.query(sql, params),
    };
  }
}

class NodemailerEmailAdapter implements EmailAdapter {
  private transporter: any = null;
  private from: string;

  constructor() {
    this.from = process.env.EMAIL_FROM ?? 'noreply@tixly.cz';
    const host = process.env.SMTP_HOST;
    if (host) {
      const nodemailer = require('nodemailer');
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
  if (!global._bulkEmailDeps) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    global._bulkEmailDeps = {
      db: new PgDbAdapter(pool),
      email: new NodemailerEmailAdapter(),
    };
  }
  return global._bulkEmailDeps;
}
