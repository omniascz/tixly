import type { DbAdapter } from '@tixly/db-adapter';
import type { ServiceDeps } from '../lib/service-container.js';
import { LandingPageError } from '../lib/landing-errors.js';
import {
  BLOCK_TYPES,
  type ContentBlock,
  type CreatePageInput,
  type LandingPage,
  type PageStatus,
  type PageWithBlocks,
  type UpdatePageInput,
  type UpsertBlockInput,
  type BlockType,
} from '../types/landing.js';

// ── Row types ─────────────────────────────────────────────────────────────

interface LandingPageRow {
  id: string;
  promoter_id: string;
  slug: string;
  title: string;
  meta_title: string;
  meta_description: string;
  meta_keywords: string | null;
  og_title: string | null;
  og_description: string | null;
  og_image: string | null;
  canonical_url: string | null;
  hreflang: Record<string, string> | null;
  status: PageStatus;
  static_html_path: string | null;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface ContentBlockRow {
  id: string;
  page_id: string;
  type: BlockType;
  position: number;
  data: Record<string, unknown>;
  variant: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

function mapPage(row: LandingPageRow): LandingPage {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    slug: row.slug,
    title: row.title,
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
    metaKeywords: row.meta_keywords,
    ogTitle: row.og_title,
    ogDescription: row.og_description,
    ogImage: row.og_image,
    canonicalUrl: row.canonical_url,
    hreflang: row.hreflang,
    status: row.status,
    staticHtmlPath: row.static_html_path,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBlock(row: ContentBlockRow): ContentBlock {
  return {
    id: row.id,
    pageId: row.page_id,
    type: row.type,
    position: row.position,
    data: row.data,
    variant: row.variant,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateBlockType(type: string): void {
  if (!BLOCK_TYPES.includes(type as BlockType)) {
    throw new LandingPageError('INVALID_BLOCK_TYPE');
  }
}

function validateHreflang(h: Record<string, string> | null | undefined): void {
  if (h === null || h === undefined) return;
  if (typeof h !== 'object' || Array.isArray(h)) {
    throw new LandingPageError('INVALID_HREFLANG');
  }
  for (const [k, v] of Object.entries(h)) {
    if (typeof k !== 'string' || typeof v !== 'string' || !k || !v) {
      throw new LandingPageError('INVALID_HREFLANG');
    }
  }
}

// ── Service functions ────────────────────────────────────────────────────

export async function createPage(
  promoterId: string,
  input: CreatePageInput,
  deps: ServiceDeps,
): Promise<LandingPage> {
  const existing = await deps.db.query<LandingPageRow>(
    `SELECT id FROM cms.landing_pages WHERE promoter_id = $1 AND slug = $2 LIMIT 1`,
    [promoterId, input.slug],
  );
  if (existing.length > 0) {
    throw new LandingPageError('SLUG_DUPLICATE');
  }

  const rows = await deps.db.query<LandingPageRow>(
    `INSERT INTO cms.landing_pages
       (promoter_id, slug, title, meta_title, meta_description, meta_keywords,
        og_title, og_description, og_image, static_html_path, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft')
     RETURNING *`,
    [
      promoterId,
      input.slug,
      input.title,
      input.metaTitle,
      input.metaDescription,
      input.metaKeywords ?? null,
      input.ogTitle ?? null,
      input.ogDescription ?? null,
      input.ogImage ?? null,
      input.staticHtmlPath ?? null,
    ],
  );

  const row = rows[0];
  if (!row) throw new LandingPageError('PAGE_NOT_FOUND');
  return mapPage(row);
}

async function loadBlocksForPage(
  pageId: string,
  db: DbAdapter,
): Promise<ContentBlock[]> {
  const rows = await db.query<ContentBlockRow>(
    `SELECT * FROM cms.content_blocks
     WHERE page_id = $1 AND is_active = TRUE
     ORDER BY position ASC`,
    [pageId],
  );
  return rows.map(mapBlock);
}

export async function getPageBySlug(
  promoterId: string,
  slug: string,
  deps: ServiceDeps,
): Promise<PageWithBlocks | null> {
  const rows = await deps.db.query<LandingPageRow>(
    `SELECT * FROM cms.landing_pages
     WHERE promoter_id = $1 AND slug = $2 AND status = 'published'
     LIMIT 1`,
    [promoterId, slug],
  );
  const row = rows[0];
  if (!row) return null;

  const page = mapPage(row);
  const blocks = await loadBlocksForPage(page.id, deps.db);
  return { ...page, blocks };
}

export async function getPageById(
  pageId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<PageWithBlocks> {
  const rows = await deps.db.query<LandingPageRow>(
    `SELECT * FROM cms.landing_pages
     WHERE id = $1 AND promoter_id = $2
     LIMIT 1`,
    [pageId, promoterId],
  );
  const row = rows[0];
  if (!row) throw new LandingPageError('PAGE_NOT_FOUND');

  const page = mapPage(row);
  const blocks = await loadBlocksForPage(page.id, deps.db);
  return { ...page, blocks };
}

export async function listPages(
  promoterId: string,
  filters: { status?: PageStatus },
  deps: ServiceDeps,
): Promise<LandingPage[]> {
  if (filters.status) {
    const rows = await deps.db.query<LandingPageRow>(
      `SELECT * FROM cms.landing_pages
       WHERE promoter_id = $1 AND status = $2
       ORDER BY updated_at DESC`,
      [promoterId, filters.status],
    );
    return rows.map(mapPage);
  }
  const rows = await deps.db.query<LandingPageRow>(
    `SELECT * FROM cms.landing_pages
     WHERE promoter_id = $1
     ORDER BY updated_at DESC`,
    [promoterId],
  );
  return rows.map(mapPage);
}

export async function updatePage(
  pageId: string,
  promoterId: string,
  input: UpdatePageInput,
  deps: ServiceDeps,
): Promise<LandingPage> {
  // Verify ownership first (anti-enumeration: return 404)
  const existing = await deps.db.query<LandingPageRow>(
    `SELECT id FROM cms.landing_pages WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
    [pageId, promoterId],
  );
  if (existing.length === 0) {
    throw new LandingPageError('PAGE_NOT_FOUND');
  }

  if (input.hreflang !== undefined) {
    validateHreflang(input.hreflang);
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  const addSet = (col: string, value: unknown) => {
    sets.push(`${col} = $${i++}`);
    params.push(value);
  };

  if (input.title !== undefined) addSet('title', input.title);
  if (input.metaTitle !== undefined) addSet('meta_title', input.metaTitle);
  if (input.metaDescription !== undefined)
    addSet('meta_description', input.metaDescription);
  if (input.metaKeywords !== undefined) addSet('meta_keywords', input.metaKeywords);
  if (input.ogTitle !== undefined) addSet('og_title', input.ogTitle);
  if (input.ogDescription !== undefined)
    addSet('og_description', input.ogDescription);
  if (input.ogImage !== undefined) addSet('og_image', input.ogImage);
  if (input.canonicalUrl !== undefined) addSet('canonical_url', input.canonicalUrl);
  if (input.hreflang !== undefined)
    addSet('hreflang', input.hreflang === null ? null : JSON.stringify(input.hreflang));
  if (input.status !== undefined) addSet('status', input.status);
  if (input.staticHtmlPath !== undefined)
    addSet('static_html_path', input.staticHtmlPath);

  sets.push(`updated_at = NOW()`);

  if (sets.length === 1) {
    // Only updated_at — nothing meaningful to change. Just refetch.
    const rows = await deps.db.query<LandingPageRow>(
      `SELECT * FROM cms.landing_pages WHERE id = $1 AND promoter_id = $2`,
      [pageId, promoterId],
    );
    const row = rows[0];
    if (!row) throw new LandingPageError('PAGE_NOT_FOUND');
    return mapPage(row);
  }

  params.push(pageId, promoterId);
  const rows = await deps.db.query<LandingPageRow>(
    `UPDATE cms.landing_pages SET ${sets.join(', ')}
     WHERE id = $${i++} AND promoter_id = $${i++}
     RETURNING *`,
    params,
  );
  const row = rows[0];
  if (!row) throw new LandingPageError('PAGE_NOT_FOUND');
  return mapPage(row);
}

export async function deletePage(
  pageId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<void> {
  const rows = await deps.db.query<{ id: string }>(
    `DELETE FROM cms.landing_pages
     WHERE id = $1 AND promoter_id = $2
     RETURNING id`,
    [pageId, promoterId],
  );
  if (rows.length === 0) {
    throw new LandingPageError('PAGE_NOT_FOUND');
  }
}

export async function publishPage(
  pageId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<LandingPage> {
  const rows = await deps.db.query<LandingPageRow>(
    `UPDATE cms.landing_pages
     SET status = 'published', published_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND promoter_id = $2
     RETURNING *`,
    [pageId, promoterId],
  );
  const row = rows[0];
  if (!row) throw new LandingPageError('PAGE_NOT_FOUND');
  return mapPage(row);
}

export async function setPageBlocks(
  pageId: string,
  promoterId: string,
  blocks: UpsertBlockInput[],
  deps: ServiceDeps,
): Promise<ContentBlock[]> {
  // Validate ownership
  const existing = await deps.db.query<{ id: string }>(
    `SELECT id FROM cms.landing_pages WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
    [pageId, promoterId],
  );
  if (existing.length === 0) {
    throw new LandingPageError('PAGE_NOT_FOUND');
  }

  for (const b of blocks) {
    validateBlockType(b.type);
  }

  return deps.db.transaction(async (tx) => {
    await tx.execute(`DELETE FROM cms.content_blocks WHERE page_id = $1`, [pageId]);

    const inserted: ContentBlock[] = [];
    for (let idx = 0; idx < blocks.length; idx++) {
      const b = blocks[idx]!;
      const rows = await tx.query<ContentBlockRow>(
        `INSERT INTO cms.content_blocks
           (page_id, type, position, data, variant, is_active)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         RETURNING *`,
        [pageId, b.type, idx, JSON.stringify(b.data), b.variant ?? null],
      );
      const row = rows[0];
      if (row) inserted.push(mapBlock(row));
    }

    await tx.execute(
      `UPDATE cms.landing_pages SET updated_at = NOW() WHERE id = $1`,
      [pageId],
    );

    return inserted;
  });
}

export async function upsertBlock(
  pageId: string,
  promoterId: string,
  blockId: string | null,
  input: UpsertBlockInput,
  deps: ServiceDeps,
): Promise<ContentBlock> {
  validateBlockType(input.type);

  // Verify page ownership
  const owns = await deps.db.query<{ id: string }>(
    `SELECT id FROM cms.landing_pages WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
    [pageId, promoterId],
  );
  if (owns.length === 0) {
    throw new LandingPageError('PAGE_NOT_FOUND');
  }

  if (blockId) {
    const rows = await deps.db.query<ContentBlockRow>(
      `UPDATE cms.content_blocks
       SET type = $1, position = $2, data = $3, variant = $4, updated_at = NOW()
       WHERE id = $5 AND page_id = $6
       RETURNING *`,
      [
        input.type,
        input.position,
        JSON.stringify(input.data),
        input.variant ?? null,
        blockId,
        pageId,
      ],
    );
    const row = rows[0];
    if (!row) throw new LandingPageError('BLOCK_NOT_FOUND');
    return mapBlock(row);
  }

  const rows = await deps.db.query<ContentBlockRow>(
    `INSERT INTO cms.content_blocks (page_id, type, position, data, variant, is_active)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     RETURNING *`,
    [
      pageId,
      input.type,
      input.position,
      JSON.stringify(input.data),
      input.variant ?? null,
    ],
  );
  const row = rows[0];
  if (!row) throw new LandingPageError('BLOCK_NOT_FOUND');
  return mapBlock(row);
}

export async function deleteBlock(
  blockId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<void> {
  const rows = await deps.db.query<{ id: string }>(
    `DELETE FROM cms.content_blocks
     WHERE id = $1
       AND page_id IN (SELECT id FROM cms.landing_pages WHERE promoter_id = $2)
     RETURNING id`,
    [blockId, promoterId],
  );
  if (rows.length === 0) {
    throw new LandingPageError('BLOCK_NOT_FOUND');
  }
}

export async function getSitemapEntries(
  promoterId: string,
  deps: ServiceDeps,
): Promise<Array<{ slug: string; updatedAt: Date }>> {
  const rows = await deps.db.query<{ slug: string; updated_at: Date }>(
    `SELECT slug, updated_at FROM cms.landing_pages
     WHERE promoter_id = $1 AND status = 'published'
     ORDER BY updated_at DESC`,
    [promoterId],
  );
  return rows.map((r) => ({ slug: r.slug, updatedAt: r.updated_at }));
}
