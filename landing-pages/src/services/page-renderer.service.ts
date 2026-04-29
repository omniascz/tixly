import type { ServiceDeps } from '../lib/service-container.js';
import { renderBlocks, escapeHtml } from '../lib/block-renderer.js';
import { loadStaticHtml } from '../lib/static-file-loader.js';
import { LandingPageError } from '../lib/landing-errors.js';
import { getPageBySlug } from './landing-page.service.js';
import type { LandingPage } from '../types/landing.js';

export interface RenderedPageMeta {
  title: string;
  description: string;
  canonical: string | null;
  ogImage: string | null;
  hreflang: Record<string, string> | null;
}

export interface RenderedPage {
  html: string;
  meta: RenderedPageMeta;
}

function buildMeta(page: LandingPage): RenderedPageMeta {
  return {
    title: page.metaTitle,
    description: page.metaDescription,
    canonical: page.canonicalUrl,
    ogImage: page.ogImage,
    hreflang: page.hreflang,
  };
}

function buildHeadTags(page: LandingPage): string {
  const parts: string[] = [
    `<meta charset="utf-8"/>`,
    `<meta name="viewport" content="width=device-width,initial-scale=1"/>`,
    `<title>${escapeHtml(page.metaTitle)}</title>`,
    `<meta name="description" content="${escapeHtml(page.metaDescription)}"/>`,
  ];
  if (page.metaKeywords) {
    parts.push(`<meta name="keywords" content="${escapeHtml(page.metaKeywords)}"/>`);
  }
  if (page.canonicalUrl) {
    parts.push(`<link rel="canonical" href="${escapeHtml(page.canonicalUrl)}"/>`);
  }
  const ogTitle = page.ogTitle ?? page.metaTitle;
  const ogDesc = page.ogDescription ?? page.metaDescription;
  parts.push(`<meta property="og:title" content="${escapeHtml(ogTitle)}"/>`);
  parts.push(`<meta property="og:description" content="${escapeHtml(ogDesc)}"/>`);
  if (page.ogImage) {
    parts.push(`<meta property="og:image" content="${escapeHtml(page.ogImage)}"/>`);
  }
  if (page.hreflang) {
    for (const [lang, url] of Object.entries(page.hreflang)) {
      parts.push(
        `<link rel="alternate" hreflang="${escapeHtml(lang)}" href="${escapeHtml(url)}"/>`,
      );
    }
  }
  return parts.join('\n');
}

function wrapDocument(page: LandingPage, body: string): string {
  return `<!DOCTYPE html>
<html lang="cs">
<head>
${buildHeadTags(page)}
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * Inject meta tags into an existing static HTML document's <head>.
 * Falls back to prepending them if no <head> tag is found.
 */
function injectMetaIntoStatic(html: string, page: LandingPage): string {
  const tags = buildHeadTags(page);
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, (_m, attrs) => `<head${attrs}>\n${tags}`);
  }
  return `${tags}\n${html}`;
}

export async function renderLandingPage(
  promoterId: string,
  slug: string,
  deps: ServiceDeps,
): Promise<RenderedPage | null> {
  const page = await getPageBySlug(promoterId, slug, deps);
  if (!page) return null;

  const meta = buildMeta(page);

  if (page.blocks && page.blocks.length > 0) {
    const body = renderBlocks(page.blocks);
    return { html: wrapDocument(page, body), meta };
  }

  if (page.staticHtmlPath) {
    try {
      const raw = await loadStaticHtml(page.staticHtmlPath);
      return { html: injectMetaIntoStatic(raw, page), meta };
    } catch (err) {
      if (err instanceof LandingPageError && err.code === 'STATIC_FILE_NOT_FOUND') {
        return null;
      }
      throw err;
    }
  }

  return null;
}
