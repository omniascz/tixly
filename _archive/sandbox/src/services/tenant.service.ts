/**
 * Sandbox tenant management — each developer gets an isolated sandbox tenant
 * with a dedicated schema prefix and auto-expiring credentials.
 *
 * Tenants are identified by `sandbox_key` which is included in all API calls
 * to route them to the sandbox DB instead of production.
 */
import { randomBytes, createHash } from 'crypto';
import { SandboxError } from '../lib/sandbox-errors.js';

export interface SandboxDB {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface SandboxTenant {
  id: string;
  name: string;
  ownerEmail: string;
  sandboxKey: string;
  schemaPrefix: string;
  expiresAt: Date;
  createdAt: Date;
  isActive: boolean;
}

export interface CreateTenantInput {
  name: string;
  ownerEmail: string;
  lifetimeDays?: number;
}

// Per-email limit on active sandbox tenants
const MAX_TENANTS_PER_OWNER = 5;

function generateKey(): string {
  return 'sbx_' + randomBytes(16).toString('hex');
}

function generateSchemaPrefix(): string {
  // Short identifier suitable for a PostgreSQL schema suffix
  return 'sbx_' + randomBytes(6).toString('hex');
}

// ---------------------------------------------------------------------------
// Create + list
// ---------------------------------------------------------------------------

export async function createTenant(input: CreateTenantInput, db: SandboxDB): Promise<SandboxTenant> {
  // Check per-owner limit
  const { rows: counts } = await db.query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM sandbox.tenants
     WHERE owner_email = $1 AND is_active = TRUE AND expires_at > NOW()`,
    [input.ownerEmail.toLowerCase()],
  );
  if (parseInt(counts[0]?.cnt ?? '0', 10) >= MAX_TENANTS_PER_OWNER) {
    throw new SandboxError('TENANT_LIMIT_REACHED', `Maximum ${MAX_TENANTS_PER_OWNER} sandbox tenants per owner.`);
  }

  const lifetimeDays = input.lifetimeDays ?? 30;
  const expiresAt = new Date(Date.now() + lifetimeDays * 86400000);

  const { rows } = await db.query<SandboxTenant>(
    `INSERT INTO sandbox.tenants (name, owner_email, sandbox_key, schema_prefix, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, owner_email AS "ownerEmail",
               sandbox_key AS "sandboxKey", schema_prefix AS "schemaPrefix",
               expires_at AS "expiresAt", created_at AS "createdAt", is_active AS "isActive"`,
    [input.name, input.ownerEmail.toLowerCase(), generateKey(), generateSchemaPrefix(), expiresAt.toISOString()],
  );
  return rows[0];
}

export async function getTenant(id: string, db: SandboxDB): Promise<SandboxTenant> {
  const { rows } = await db.query<SandboxTenant>(
    `SELECT id, name, owner_email AS "ownerEmail",
            sandbox_key AS "sandboxKey", schema_prefix AS "schemaPrefix",
            expires_at AS "expiresAt", created_at AS "createdAt", is_active AS "isActive"
     FROM sandbox.tenants WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) throw new SandboxError('TENANT_NOT_FOUND');
  return rows[0];
}

export async function getTenantByKey(key: string, db: SandboxDB): Promise<SandboxTenant> {
  const { rows } = await db.query<SandboxTenant>(
    `SELECT id, name, owner_email AS "ownerEmail",
            sandbox_key AS "sandboxKey", schema_prefix AS "schemaPrefix",
            expires_at AS "expiresAt", created_at AS "createdAt", is_active AS "isActive"
     FROM sandbox.tenants WHERE sandbox_key = $1`,
    [key],
  );
  if (rows.length === 0) throw new SandboxError('TENANT_NOT_FOUND');

  const tenant = rows[0];
  if (!tenant.isActive) throw new SandboxError('TENANT_NOT_FOUND');
  if (new Date(tenant.expiresAt) < new Date()) throw new SandboxError('TENANT_EXPIRED');

  return tenant;
}

export async function listTenants(ownerEmail: string, db: SandboxDB): Promise<SandboxTenant[]> {
  const { rows } = await db.query<SandboxTenant>(
    `SELECT id, name, owner_email AS "ownerEmail",
            sandbox_key AS "sandboxKey", schema_prefix AS "schemaPrefix",
            expires_at AS "expiresAt", created_at AS "createdAt", is_active AS "isActive"
     FROM sandbox.tenants WHERE owner_email = $1 AND is_active = TRUE
     ORDER BY created_at DESC`,
    [ownerEmail.toLowerCase()],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Delete / expire
// ---------------------------------------------------------------------------

export async function deleteTenant(id: string, db: SandboxDB): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE sandbox.tenants SET is_active = FALSE WHERE id = $1 RETURNING id`,
    [id],
  );
  if (rows.length === 0) throw new SandboxError('TENANT_NOT_FOUND');
}

export async function extendTenant(id: string, days: number, db: SandboxDB): Promise<SandboxTenant> {
  if (days <= 0 || days > 365) {
    throw new SandboxError('INVALID_SCENARIO', 'Extension must be between 1 and 365 days.');
  }

  const { rows } = await db.query<SandboxTenant>(
    `UPDATE sandbox.tenants
     SET expires_at = expires_at + ($1::int || ' days')::interval
     WHERE id = $2 AND is_active = TRUE
     RETURNING id, name, owner_email AS "ownerEmail",
               sandbox_key AS "sandboxKey", schema_prefix AS "schemaPrefix",
               expires_at AS "expiresAt", created_at AS "createdAt", is_active AS "isActive"`,
    [days, id],
  );
  if (rows.length === 0) throw new SandboxError('TENANT_NOT_FOUND');
  return rows[0];
}
