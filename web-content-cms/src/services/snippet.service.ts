import type { ServiceDeps } from '../lib/service-container.js';
import {
  SnippetError,
  MAX_CONTENT_BYTES,
} from '../lib/snippet-errors.js';
import type {
  ContentSnippet,
  SnippetFormat,
  UpsertSnippetInput,
} from '../types/snippet.js';

interface SnippetRow {
  id: string;
  promoter_id: string;
  key: string;
  label: string;
  format: string;
  content: string;
  locale: string;
  category: string | null;
  updated_by: string | null;
  updated_at: Date;
  created_at: Date;
}

const VALID_FORMATS: SnippetFormat[] = ['plain', 'markdown', 'html'];

function mapRow(row: SnippetRow): ContentSnippet {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    key: row.key,
    label: row.label,
    format: row.format as SnippetFormat,
    content: row.content,
    locale: row.locale,
    category: row.category,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

function validateInput(input: UpsertSnippetInput): void {
  if (!input.key || !input.key.trim()) {
    throw new SnippetError('KEY_REQUIRED');
  }
  if (!VALID_FORMATS.includes(input.format)) {
    throw new SnippetError('INVALID_FORMAT');
  }
  if (Buffer.byteLength(input.content, 'utf8') > MAX_CONTENT_BYTES) {
    throw new SnippetError('CONTENT_TOO_LARGE');
  }
}

export async function getSnippet(
  promoterId: string,
  key: string,
  locale: string,
  deps: ServiceDeps,
): Promise<ContentSnippet | null> {
  const rows = await deps.db.query<SnippetRow>(
    `SELECT * FROM cms.content_snippets
     WHERE promoter_id = $1 AND key = $2 AND locale = $3
     LIMIT 1`,
    [promoterId, key, locale],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function getSnippetsByCategory(
  promoterId: string,
  category: string,
  locale: string,
  deps: ServiceDeps,
): Promise<ContentSnippet[]> {
  const rows = await deps.db.query<SnippetRow>(
    `SELECT * FROM cms.content_snippets
     WHERE promoter_id = $1 AND category = $2 AND locale = $3
     ORDER BY key ASC`,
    [promoterId, category, locale],
  );
  return rows.map(mapRow);
}

export async function listSnippets(
  promoterId: string,
  filters: { category?: string; locale?: string },
  deps: ServiceDeps,
): Promise<ContentSnippet[]> {
  const clauses: string[] = ['promoter_id = $1'];
  const params: unknown[] = [promoterId];
  let i = 2;
  if (filters.category) {
    clauses.push(`category = $${i++}`);
    params.push(filters.category);
  }
  if (filters.locale) {
    clauses.push(`locale = $${i++}`);
    params.push(filters.locale);
  }
  const rows = await deps.db.query<SnippetRow>(
    `SELECT * FROM cms.content_snippets
     WHERE ${clauses.join(' AND ')}
     ORDER BY category NULLS LAST, key ASC`,
    params,
  );
  return rows.map(mapRow);
}

export async function upsertSnippet(
  promoterId: string,
  input: UpsertSnippetInput,
  updatedByUserId: string,
  deps: ServiceDeps,
): Promise<ContentSnippet> {
  validateInput(input);
  const locale = input.locale ?? 'cs';
  const category = input.category ?? null;
  const rows = await deps.db.query<SnippetRow>(
    `INSERT INTO cms.content_snippets
       (promoter_id, key, label, format, content, locale, category, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (promoter_id, key, locale)
     DO UPDATE SET
       label = EXCLUDED.label,
       format = EXCLUDED.format,
       content = EXCLUDED.content,
       category = EXCLUDED.category,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING *`,
    [
      promoterId,
      input.key,
      input.label,
      input.format,
      input.content,
      locale,
      category,
      updatedByUserId,
    ],
  );
  if (!rows[0]) {
    throw new SnippetError('SNIPPET_NOT_FOUND');
  }
  return mapRow(rows[0]);
}

export async function deleteSnippet(
  promoterId: string,
  key: string,
  locale: string,
  deps: ServiceDeps,
): Promise<void> {
  const rows = await deps.db.query<{ id: string }>(
    `DELETE FROM cms.content_snippets
     WHERE promoter_id = $1 AND key = $2 AND locale = $3
     RETURNING id`,
    [promoterId, key, locale],
  );
  if (rows.length === 0) {
    throw new SnippetError('SNIPPET_NOT_FOUND');
  }
}

export async function getSnippetsByKeys(
  promoterId: string,
  keys: string[],
  locale: string,
  deps: ServiceDeps,
): Promise<Record<string, ContentSnippet>> {
  if (keys.length === 0) return {};
  const rows = await deps.db.query<SnippetRow>(
    `SELECT * FROM cms.content_snippets
     WHERE promoter_id = $1 AND locale = $2 AND key = ANY($3::text[])`,
    [promoterId, locale, keys],
  );
  const result: Record<string, ContentSnippet> = {};
  for (const row of rows) {
    result[row.key] = mapRow(row);
  }
  return result;
}
