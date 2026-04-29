/**
 * Block renderer for landing page content.
 *
 * SECURITY: All user-supplied content is sanitized:
 *  - HTML in `text` and `html` blocks goes through sanitize-html with a strict tag/attr allowlist
 *  - All URLs (a href, img src, etc.) are validated through `sanitizeUrl()` to block javascript:, data:, file: schemes
 *  - All other user-supplied strings are HTML-escaped via `escapeHtml`
 *
 * Trust model: CMS authors are untrusted (multi-tenant). Any new block type
 * MUST sanitize its inputs before emitting HTML.
 */
import sanitizeHtml from 'sanitize-html';
import type { BlockType, ContentBlock } from '../types/landing.js';

/** Escape HTML-unsafe characters in user-supplied strings. */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'em', 'b', 'i', 'u',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'a', 'blockquote', 'hr',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'img', 'figure', 'figcaption',
    'span', 'div',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    '*': ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
};

/** Sanitize rich HTML content from untrusted CMS authors. */
export function sanitizeContentHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

/**
 * Validate and escape a URL. Only http, https, mailto, tel, and relative URLs
 * are allowed. Dangerous schemes (javascript:, data:, file:, etc.) return '#'.
 */
export function sanitizeUrl(url: unknown): string {
  if (url === null || url === undefined) return '#';
  const trimmed = String(url).trim();
  if (!trimmed) return '#';
  // Allow relative URLs
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('?')
  ) {
    return escapeHtml(trimmed);
  }
  try {
    const parsed = new URL(trimmed);
    const scheme = parsed.protocol.replace(':', '').toLowerCase();
    if (!['http', 'https', 'mailto', 'tel'].includes(scheme)) {
      return '#';
    }
    return escapeHtml(parsed.toString());
  } catch {
    return '#';
  }
}

function cls(base: string, variant: string | null | undefined): string {
  return variant ? `${base} ${escapeHtml(variant)}` : base;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

type Renderer = (block: ContentBlock) => string;

const renderers: Record<BlockType, Renderer> = {
  hero: (b) => {
    const d = b.data;
    const title = escapeHtml(asString(d.title));
    const subtitle = escapeHtml(asString(d.subtitle));
    const ctaText = asString(d.ctaText);
    const ctaUrl = asString(d.ctaUrl);
    const cta = ctaText
      ? `<a href="${sanitizeUrl(ctaUrl)}" class="btn">${escapeHtml(ctaText)}</a>`
      : '';
    return `<section class="${cls('hero', b.variant)}"><h1>${title}</h1><p>${subtitle}</p>${cta}</section>`;
  },

  text: (b) => {
    // Untrusted CMS content — sanitize before emitting.
    const html = sanitizeContentHtml(asString(b.data.html));
    return `<section class="${cls('text', b.variant)}">${html}</section>`;
  },

  image: (b) => {
    const src = sanitizeUrl(asString(b.data.src));
    const alt = escapeHtml(asString(b.data.alt));
    return `<figure class="${cls('image', b.variant)}"><img src="${src}" alt="${alt}" loading="lazy"/></figure>`;
  },

  cta: (b) => {
    const heading = escapeHtml(asString(b.data.heading));
    const url = sanitizeUrl(asString(b.data.url));
    const label = escapeHtml(asString(b.data.label));
    return `<section class="${cls('cta', b.variant)}"><h2>${heading}</h2><a href="${url}" class="btn">${label}</a></section>`;
  },

  gallery: (b) => {
    const images = asArray<{ src?: unknown; alt?: unknown }>(b.data.images);
    const items = images
      .map(
        (img) =>
          `<img src="${sanitizeUrl(asString(img.src))}" alt="${escapeHtml(asString(img.alt))}" loading="lazy"/>`,
      )
      .join('');
    return `<section class="${cls('gallery', b.variant)}">${items}</section>`;
  },

  features: (b) => {
    const items = asArray<{ icon?: unknown; title?: unknown; description?: unknown }>(
      b.data.items,
    );
    const li = items
      .map(
        (it) =>
          `<li class="feature"><span class="icon">${escapeHtml(asString(it.icon))}</span><h3>${escapeHtml(asString(it.title))}</h3><p>${escapeHtml(asString(it.description))}</p></li>`,
      )
      .join('');
    return `<section class="${cls('features', b.variant)}"><ul>${li}</ul></section>`;
  },

  testimonial: (b) => {
    const quote = escapeHtml(asString(b.data.quote));
    const author = escapeHtml(asString(b.data.author));
    return `<section class="${cls('testimonial', b.variant)}"><blockquote>${quote}</blockquote><cite>${author}</cite></section>`;
  },

  faq: (b) => {
    const items = asArray<{ q?: unknown; a?: unknown }>(b.data.items);
    const rows = items
      .map(
        (it) =>
          `<details><summary>${escapeHtml(asString(it.q))}</summary><div>${escapeHtml(asString(it.a))}</div></details>`,
      )
      .join('');
    return `<section class="${cls('faq', b.variant)}">${rows}</section>`;
  },

  pricing: (b) => {
    const tiers = asArray<{ name?: unknown; price?: unknown; features?: unknown }>(
      b.data.tiers,
    );
    const cards = tiers
      .map((t) => {
        const features = asArray(t.features)
          .map((f) => `<li>${escapeHtml(asString(f))}</li>`)
          .join('');
        return `<div class="tier"><h3>${escapeHtml(asString(t.name))}</h3><div class="price">${escapeHtml(asString(t.price))}</div><ul>${features}</ul></div>`;
      })
      .join('');
    return `<section class="${cls('pricing', b.variant)}">${cards}</section>`;
  },

  contact_form: (b) => {
    const action = sanitizeUrl(asString(b.data.action) || '/api/landing-pages/contact-submit');
    return `<section class="${cls('contact-form', b.variant)}"><form method="post" action="${action}"><input type="text" name="name" placeholder="Jméno" required/><input type="email" name="email" placeholder="E-mail" required/><input type="tel" name="phone" placeholder="Telefon"/><textarea name="message" placeholder="Zpráva" required></textarea><button type="submit">Odeslat</button></form></section>`;
  },

  html: (b) => {
    // Even the "raw" escape hatch is sanitized — CMS authors are untrusted.
    return sanitizeContentHtml(asString(b.data.html));
  },
};

export function renderBlocks(blocks: ContentBlock[]): string {
  if (!blocks || blocks.length === 0) return '';
  const sorted = [...blocks]
    .filter((b) => b.isActive)
    .sort((a, b) => a.position - b.position);
  return sorted
    .map((b) => {
      const render = renderers[b.type];
      return render ? render(b) : '';
    })
    .join('\n');
}
