import { describe, it, expect } from 'vitest';
import { renderBlocks, escapeHtml, sanitizeUrl } from '../lib/block-renderer.js';
import type { BlockType, ContentBlock } from '../types/landing.js';

function block(
  type: BlockType,
  data: Record<string, unknown>,
  overrides: Partial<ContentBlock> = {},
): ContentBlock {
  return {
    id: 'b1',
    pageId: 'p1',
    type,
    position: 0,
    data,
    variant: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('renderBlocks', () => {
  it('returns empty string for empty array', () => {
    expect(renderBlocks([])).toBe('');
  });

  it('renders hero with title + subtitle + cta', () => {
    const html = renderBlocks([
      block('hero', {
        title: 'Hello',
        subtitle: 'World',
        ctaText: 'Buy',
        ctaUrl: '/x',
      }),
    ]);
    expect(html).toContain('<section class="hero"');
    expect(html).toContain('<h1>Hello</h1>');
    expect(html).toContain('<p>World</p>');
    expect(html).toContain('<a href="/x" class="btn">Buy</a>');
  });

  it('renders text block with safe HTML preserved', () => {
    const html = renderBlocks([
      block('text', { html: '<p>Hello <strong>world</strong></p>' }),
    ]);
    expect(html).toContain('<p>Hello <strong>world</strong></p>');
  });

  it('renders image with lazy loading', () => {
    const html = renderBlocks([block('image', { src: '/a.jpg', alt: 'A' })]);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('src="/a.jpg"');
  });

  it('renders cta', () => {
    const html = renderBlocks([
      block('cta', { heading: 'Go', url: '/go', label: 'Click' }),
    ]);
    expect(html).toContain('<h2>Go</h2>');
    expect(html).toContain('href="/go"');
  });

  it('renders gallery items', () => {
    const html = renderBlocks([
      block('gallery', { images: [{ src: '/1.jpg', alt: '1' }, { src: '/2.jpg', alt: '2' }] }),
    ]);
    expect(html).toContain('/1.jpg');
    expect(html).toContain('/2.jpg');
  });

  it('renders features items', () => {
    const html = renderBlocks([
      block('features', {
        items: [{ icon: 'i', title: 'T', description: 'D' }],
      }),
    ]);
    expect(html).toContain('<h3>T</h3>');
    expect(html).toContain('<p>D</p>');
  });

  it('renders testimonial', () => {
    const html = renderBlocks([
      block('testimonial', { quote: 'Great', author: 'Jane' }),
    ]);
    expect(html).toContain('<blockquote>Great</blockquote>');
    expect(html).toContain('<cite>Jane</cite>');
  });

  it('renders faq as details/summary', () => {
    const html = renderBlocks([
      block('faq', { items: [{ q: 'Why?', a: 'Because.' }] }),
    ]);
    expect(html).toContain('<details>');
    expect(html).toContain('<summary>Why?</summary>');
    expect(html).toContain('Because.');
  });

  it('renders pricing tiers', () => {
    const html = renderBlocks([
      block('pricing', {
        tiers: [{ name: 'Basic', price: '100', features: ['a', 'b'] }],
      }),
    ]);
    expect(html).toContain('<h3>Basic</h3>');
    expect(html).toContain('<li>a</li>');
  });

  it('renders contact form', () => {
    const html = renderBlocks([block('contact_form', {})]);
    expect(html).toContain('<form');
    expect(html).toContain('action="/api/landing-pages/contact-submit"');
    expect(html).toContain('name="email"');
  });

  it('strips script tags from html block (no raw passthrough)', () => {
    const html = renderBlocks([
      block('html', { html: '<p>ok</p><script>raw</script>' }),
    ]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('<p>ok</p>');
  });

  it('escapes <script> in user-supplied data (hero title)', () => {
    const html = renderBlocks([
      block('hero', { title: '<script>alert(1)</script>', subtitle: '' }),
    ]);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('sorts by position and skips inactive', () => {
    const html = renderBlocks([
      block('hero', { title: 'Second' }, { id: '2', position: 1 }),
      block('hero', { title: 'First' }, { id: '1', position: 0 }),
      block('hero', { title: 'Hidden' }, { id: '3', position: 2, isActive: false }),
    ]);
    const firstIdx = html.indexOf('First');
    const secondIdx = html.indexOf('Second');
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(firstIdx);
    expect(html).not.toContain('Hidden');
  });
});

describe('escapeHtml', () => {
  it('escapes all HTML specials', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    );
  });
});

describe('XSS sanitization (P0 #5)', () => {
  it('text block strips <script> tags', () => {
    const html = renderBlocks([
      block('text', { html: "<p>hi</p><script>alert('xss')</script>" }),
    ]);
    expect(html).not.toContain('<script');
    expect(html).not.toContain("alert('xss')");
    expect(html).toContain('<p>hi</p>');
  });

  it('text block strips javascript: href on anchors', () => {
    const html = renderBlocks([
      block('text', { html: '<a href="javascript:alert(1)">click</a>' }),
    ]);
    expect(html).not.toContain('javascript:');
  });

  it('text block strips inline event handlers like onerror', () => {
    const html = renderBlocks([
      block('text', { html: '<img src="x" onerror="alert(1)">' }),
    ]);
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('alert(1)');
  });

  it('text block preserves safe formatting HTML unchanged', () => {
    const html = renderBlocks([
      block('text', { html: '<p>Hello <strong>world</strong></p>' }),
    ]);
    expect(html).toContain('<p>Hello <strong>world</strong></p>');
  });

  it('cta block with javascript: url falls back to #', () => {
    const html = renderBlocks([
      block('cta', { heading: 'Go', url: 'javascript:alert(1)', label: 'Click' }),
    ]);
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="#"');
  });

  it('cta block preserves relative url', () => {
    const html = renderBlocks([
      block('cta', { heading: 'Go', url: '/event/123', label: 'Click' }),
    ]);
    expect(html).toContain('href="/event/123"');
  });

  it('cta block preserves https url', () => {
    const html = renderBlocks([
      block('cta', { heading: 'Go', url: 'https://example.com/', label: 'Click' }),
    ]);
    expect(html).toContain('https://example.com/');
  });

  it('image block with javascript: src falls back to #', () => {
    const html = renderBlocks([
      block('image', { src: 'javascript:alert(1)', alt: 'x' }),
    ]);
    expect(html).not.toContain('javascript:');
    expect(html).toContain('src="#"');
  });

  it('image block with data: src falls back to #', () => {
    const html = renderBlocks([
      block('image', { src: 'data:text/html,<script>alert(1)</script>', alt: 'x' }),
    ]);
    expect(html).not.toContain('data:');
    expect(html).not.toContain('<script');
    expect(html).toContain('src="#"');
  });

  it('gallery block sanitizes each image src', () => {
    const html = renderBlocks([
      block('gallery', {
        images: [
          { src: 'javascript:alert(1)', alt: 'bad' },
          { src: '/ok.jpg', alt: 'ok' },
        ],
      }),
    ]);
    expect(html).not.toContain('javascript:');
    expect(html).toContain('/ok.jpg');
  });

  it('hero cta url sanitized', () => {
    const html = renderBlocks([
      block('hero', {
        title: 'T',
        subtitle: 'S',
        ctaText: 'Go',
        ctaUrl: 'javascript:alert(1)',
      }),
    ]);
    expect(html).not.toContain('javascript:');
  });

  it('contact_form action sanitized against dangerous scheme', () => {
    const html = renderBlocks([
      block('contact_form', { action: 'javascript:alert(1)' }),
    ]);
    expect(html).not.toContain('javascript:');
  });
});

describe('sanitizeUrl', () => {
  it('returns # for empty', () => {
    expect(sanitizeUrl('')).toBe('#');
    expect(sanitizeUrl(null)).toBe('#');
    expect(sanitizeUrl(undefined)).toBe('#');
  });
  it('allows relative', () => {
    expect(sanitizeUrl('/foo/bar')).toBe('/foo/bar');
    expect(sanitizeUrl('#anchor')).toBe('#anchor');
    expect(sanitizeUrl('?q=1')).toBe('?q=1');
  });
  it('allows http(s), mailto, tel', () => {
    expect(sanitizeUrl('https://example.com/')).toContain('https://example.com');
    expect(sanitizeUrl('mailto:a@b.cz')).toContain('mailto:');
    expect(sanitizeUrl('tel:+420123')).toContain('tel:');
  });
  it('blocks javascript:, data:, file:', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('#');
    expect(sanitizeUrl('JaVaScRiPt:alert(1)')).toBe('#');
    expect(sanitizeUrl('data:text/html,<script>')).toBe('#');
    expect(sanitizeUrl('file:///etc/passwd')).toBe('#');
  });
  it('blocks garbage', () => {
    expect(sanitizeUrl('not a url')).toBe('#');
  });
});
