// =============================================================================
// DB-backed email template resolver
//
// Checks cms.content_snippets for a per-promoter Handlebars template override
// keyed by `email.<templateName>` (e.g. `email.ems-reservation-confirmed`).
// Falls back to the static .html file in email-templates/ when no DB row exists.
//
// This bridges PulseUp's `web_obsah` (migrated to cms.content_snippets) into
// Tixly's email pipeline, so promoters can customize email copy via the
// admin CMS UI without redeploying.
// =============================================================================

import Handlebars from 'handlebars';
import { Pool } from 'pg';
import { renderEmail } from './email-renderer.js';
import type { EmailRenderResult } from './email-renderer.js';

let _pool: Pool | undefined;
function pool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

/** Exposed for tests */
export function __setResolverPool(p: Pool | undefined): void {
  _pool = p;
}

/**
 * Resolve and render an email template.
 *
 * Resolution order:
 *   1. cms.content_snippets row WHERE key = `email.<templateName>` AND promoter_id AND locale
 *   2. Static .html file in email-templates/
 *
 * @param templateName - e.g. "ems-reservation-confirmed", "order-confirmation"
 * @param variables    - Handlebars variables
 * @param promoterId   - promoter UUID (for per-tenant overrides)
 * @param locale       - e.g. "cs" (default)
 */
export async function resolveAndRender(
  templateName: string,
  variables: Record<string, unknown>,
  promoterId?: string | null,
  locale = 'cs',
): Promise<EmailRenderResult> {
  if (promoterId) {
    try {
      const key = `email.${templateName}`;
      const { rows } = await pool().query<{ content: string; format: string }>(
        `SELECT content, format FROM cms.content_snippets
          WHERE promoter_id = $1 AND key = $2 AND locale = $3
          LIMIT 1`,
        [promoterId, key, locale],
      );
      if (rows[0]) {
        const compiled = Handlebars.compile(rows[0].content);
        const html = compiled(variables);
        const text = htmlToText(html);
        return { html, text };
      }
    } catch {
      // DB unavailable or schema missing — fall through to static
    }
  }

  // Fallback to static file
  return renderEmail(templateName, variables);
}

function htmlToText(html: string): string {
  let text = html;
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l)
    .join('\n');
}
