#!/usr/bin/env node
/**
 * Markdown → printable HTML converter (zero external deps).
 *
 * Použití:
 *   node scripts/md-to-html.mjs DEPLOYMENT.md A11Y_AUDIT.md
 *
 * Output: DEPLOYMENT.html, A11Y_AUDIT.html vedle vstupních MD.
 *
 * Pak: otevři HTML v Chrome → Ctrl+P → „Save as PDF" → hotovo.
 *
 * Style: A4 portrait, optimalizováno pro print (page breaks, hyphenation,
 * tabulky se zachovaným okrajem).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(s) {
  // Bold, italic, code, links
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function escAndInline(s) {
  // Escape HTML first, then convert markdown inline syntax
  return inline(escapeHtml(s));
}

function convertMarkdown(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  let inCode = false;
  let codeLines = [];
  let codeLang = '';

  function flushList(buf, ordered) {
    if (buf.length === 0) return '';
    const tag = ordered ? 'ol' : 'ul';
    const items = buf.map((l) => `<li>${escAndInline(l)}</li>`).join('');
    return `<${tag}>${items}</${tag}>`;
  }

  function flushTable(rows) {
    if (rows.length < 2) return '';
    const header = rows[0].split('|').map((c) => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
    const dataRows = rows.slice(2).map((row) =>
      row.split('|').map((c) => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1),
    );
    const th = header.map((h) => `<th>${escAndInline(h)}</th>`).join('');
    const body = dataRows
      .map((row) => `<tr>${row.map((c) => `<td>${escAndInline(c)}</td>`).join('')}</tr>`)
      .join('');
    return `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
  }

  while (i < lines.length) {
    const line = lines[i];

    // Code fence
    if (line.startsWith('```')) {
      if (inCode) {
        out.push(
          `<pre><code class="lang-${codeLang}">${escapeHtml(codeLines.join('\n'))}</code></pre>`,
        );
        codeLines = [];
        codeLang = '';
        inCode = false;
      } else {
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      i++;
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      i++;
      continue;
    }

    // Headings
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${escAndInline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      out.push('<hr />');
      i++;
      continue;
    }

    // Table (detect | a separator row)
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && lines[i].includes('|')) {
        rows.push(lines[i]);
        i++;
      }
      out.push(flushTable(rows));
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      out.push(flushList(buf, false));
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      out.push(flushList(buf, true));
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph (collect adjacent non-blank lines)
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('```') &&
      !/^---+$/.test(lines[i].trim()) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]))
    ) {
      para.push(lines[i]);
      i++;
    }
    if (para.length > 0) {
      out.push(`<p>${escAndInline(para.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}

const STYLE = `
  @page {
    size: A4 portrait;
    margin: 20mm 18mm 22mm 18mm;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 10.5pt;
    line-height: 1.6;
    color: #1a1a1a;
    background: white;
  }
  .container {
    max-width: 180mm;
    margin: 0 auto;
    padding: 8mm 0;
  }
  .cover {
    border-bottom: 4px solid #10b981;
    padding-bottom: 12pt;
    margin-bottom: 18pt;
  }
  .cover h1 {
    font-size: 26pt;
    color: #10b981;
    margin: 0 0 4pt;
  }
  .cover .subtitle {
    font-size: 11pt;
    color: #6b7280;
  }
  .cover .meta {
    font-size: 9pt;
    color: #9ca3af;
    margin-top: 8pt;
  }

  h1, h2, h3, h4 {
    page-break-after: avoid;
    color: #0f172a;
    line-height: 1.25;
    margin-top: 18pt;
    margin-bottom: 6pt;
  }
  h1 { font-size: 20pt; border-bottom: 2px solid #e5e7eb; padding-bottom: 4pt; }
  h2 { font-size: 15pt; color: #10b981; }
  h3 { font-size: 12pt; }
  h4 { font-size: 11pt; color: #475569; }

  p { margin: 6pt 0; orphans: 3; widows: 3; }

  ul, ol { margin: 6pt 0; padding-left: 20pt; }
  li { margin: 2pt 0; }

  a { color: #2563eb; text-decoration: none; word-break: break-all; }
  a::after {
    content: " (" attr(href) ")";
    font-size: 8pt;
    color: #6b7280;
    word-break: break-all;
  }
  a[href^="#"]::after { content: ""; }

  code {
    font-family: 'JetBrains Mono', Consolas, Monaco, 'Courier New', monospace;
    font-size: 9pt;
    background: #f3f4f6;
    padding: 1pt 4pt;
    border-radius: 3pt;
    color: #be185d;
  }
  pre {
    background: #0f172a;
    color: #f3f4f6;
    padding: 10pt;
    border-radius: 4pt;
    overflow-x: auto;
    font-size: 8.5pt;
    line-height: 1.4;
    page-break-inside: avoid;
    margin: 8pt 0;
  }
  pre code {
    background: transparent;
    color: inherit;
    padding: 0;
    font-size: inherit;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 8pt 0;
    font-size: 9.5pt;
    page-break-inside: avoid;
  }
  th, td {
    border: 1px solid #e5e7eb;
    padding: 5pt 8pt;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: #f9fafb;
    font-weight: 600;
    color: #374151;
  }
  tr:nth-child(even) td { background: #fcfcfd; }

  hr {
    border: 0;
    border-top: 1px solid #e5e7eb;
    margin: 14pt 0;
  }

  strong { color: #0f172a; }
  em { color: #475569; }

  /* Page breaks */
  h1, h2 { page-break-before: auto; }
  h1 + * { page-break-before: avoid; }
  pre, table, ul, ol { page-break-inside: avoid; }

  /* Print: hide URL annotations on internal anchors */
  @media print {
    body { font-size: 10pt; }
  }
`;

function buildHtml(title, body) {
  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} — Tixly</title>
<style>${STYLE}</style>
</head>
<body>
  <div class="container">
    <div class="cover">
      <h1>${escapeHtml(title)}</h1>
      <div class="subtitle">Tixly — interní dokument</div>
      <div class="meta">Vygenerováno ${new Date().toLocaleString('cs-CZ', { dateStyle: 'long', timeStyle: 'short' })}</div>
    </div>
    ${body}
    <hr />
    <p style="font-size:8pt;color:#9ca3af;text-align:center;margin-top:20pt">
      Tixly · ${new Date().getFullYear()} · Interní dokumentace
    </p>
  </div>
</body>
</html>`;
}

// CLI
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Použití: node scripts/md-to-html.mjs <file.md> [file2.md ...]');
  process.exit(1);
}

for (const file of args) {
  const path = resolve(file);
  const md = readFileSync(path, 'utf-8');
  const name = basename(path, '.md');
  const body = convertMarkdown(md);
  const html = buildHtml(name.replace(/_/g, ' '), body);
  const outPath = path.replace(/\.md$/, '.html');
  writeFileSync(outPath, html, 'utf-8');
  console.log(`✓ ${file} → ${outPath}`);
}

console.log('');
console.log('Hotovo. Pro PDF:');
console.log('  1. Otevři .html v Chrome / Edge / Firefox (double-click)');
console.log('  2. Ctrl+P (Cmd+P na Mac)');
console.log('  3. Cíl: „Uložit jako PDF" → uložit');
