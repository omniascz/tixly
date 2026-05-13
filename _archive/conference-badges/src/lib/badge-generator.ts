// =============================================================================
// Badge Generator — pure TypeScript, no external PDF library
// =============================================================================

export interface BadgeData {
  activationId: string;
  accessToken: string;
  displayName: string;
  displayCompany?: string;
  displayRole?: string;
  photoUrl?: string;
  badgeColor?: string;
  qrPayload: string; // the string to encode in QR (access_token)
}

export interface BadgeTemplate {
  widthMm: number;
  heightMm: number;
  backgroundColor: string;
  accentColor: string;
  logoUrl?: string;
  showPhoto: boolean;
  showCompany: boolean;
  showQr: boolean;
  showRole: boolean;
  fontSizeName: number;
  fontSizeCompany: number;
}

export interface GeneratedBadge {
  activationId: string;
  svgContent: string;   // SVG representation
  pdfBytes: Uint8Array; // mock PDF bytes
}

// px/mm conversion factor
const PX_PER_MM = 3.7795;

/**
 * Generate SVG badge (real SVG implementation).
 */
export function generateBadgeSvg(data: BadgeData, template: BadgeTemplate): string {
  const w = Math.round(template.widthMm * PX_PER_MM);
  const h = Math.round(template.heightMm * PX_PER_MM);

  const bgColor = data.badgeColor ?? template.backgroundColor;
  const accent = template.accentColor;

  // Header strip height (20% of badge)
  const headerH = Math.round(h * 0.22);

  // Layout constants
  const padding = 10;
  const photoSize = 48;
  const qrSize = 52;

  let elements = '';

  // Background
  elements += `<rect width="${w}" height="${h}" fill="${bgColor}" rx="6" ry="6"/>`;

  // Accent header strip
  elements += `<rect width="${w}" height="${headerH}" fill="${accent}" rx="6" ry="6"/>`;
  elements += `<rect y="${headerH - 6}" width="${w}" height="6" fill="${accent}"/>`;

  // Logo text in header (if logoUrl provided, show placeholder; otherwise show "BADGE")
  if (template.logoUrl) {
    elements += `<image href="${escapeXml(template.logoUrl)}" x="${padding}" y="6" height="${headerH - 12}" preserveAspectRatio="xMidYMid meet"/>`;
  } else {
    elements += `<text x="${padding}" y="${Math.round(headerH * 0.65)}" font-family="Arial,sans-serif" font-size="12" font-weight="bold" fill="#ffffff">BADGE</text>`;
  }

  // Content area starts below header
  let contentY = headerH + padding;

  // Photo placeholder (circle) — top-left of content area
  if (template.showPhoto) {
    const cx = padding + photoSize / 2;
    const cy = contentY + photoSize / 2;
    if (data.photoUrl) {
      elements += `<clipPath id="photoClip"><circle cx="${cx}" cy="${cy}" r="${photoSize / 2}"/></clipPath>`;
      elements += `<image href="${escapeXml(data.photoUrl)}" x="${padding}" y="${contentY}" width="${photoSize}" height="${photoSize}" clip-path="url(#photoClip)"/>`;
    } else {
      elements += `<circle cx="${cx}" cy="${cy}" r="${photoSize / 2}" fill="#e5e7eb"/>`;
      elements += `<text x="${cx}" y="${cy + 4}" font-family="Arial,sans-serif" font-size="10" fill="#9ca3af" text-anchor="middle">PHOTO</text>`;
    }
  }

  // Text content — offset right if photo shown
  const textX = template.showPhoto ? padding + photoSize + padding : padding;
  let textY = contentY + template.fontSizeName;

  // Name
  elements += `<text x="${textX}" y="${textY}" font-family="Arial,sans-serif" font-size="${template.fontSizeName}" font-weight="bold" fill="#111827">${escapeXml(data.displayName)}</text>`;
  textY += Math.round(template.fontSizeName * 1.4);

  // Company
  if (template.showCompany && data.displayCompany) {
    elements += `<text x="${textX}" y="${textY}" font-family="Arial,sans-serif" font-size="${template.fontSizeCompany}" fill="#6b7280">${escapeXml(data.displayCompany)}</text>`;
    textY += Math.round(template.fontSizeCompany * 1.4);
  }

  // Role
  if (template.showRole && data.displayRole) {
    const roleFontSize = Math.round(template.fontSizeCompany * 0.9);
    elements += `<rect x="${textX}" y="${textY - roleFontSize}" width="${Math.min(data.displayRole.length * roleFontSize * 0.6, w - textX - padding)}" height="${roleFontSize + 4}" fill="${accent}" rx="3" ry="3"/>`;
    elements += `<text x="${textX + 4}" y="${textY}" font-family="Arial,sans-serif" font-size="${roleFontSize}" fill="#ffffff">${escapeXml(data.displayRole)}</text>`;
  }

  // QR placeholder — bottom-right corner
  if (template.showQr) {
    const qrX = w - qrSize - padding;
    const qrY = h - qrSize - padding;
    elements += `<rect x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" fill="#f3f4f6" stroke="#d1d5db" stroke-width="1" rx="3" ry="3"/>`;
    elements += `<text x="${qrX + qrSize / 2}" y="${qrY + qrSize / 2 + 4}" font-family="Arial,sans-serif" font-size="10" fill="#374151" text-anchor="middle">QR</text>`;
    // embed qrPayload as data attribute for downstream processing
    elements += `<text x="${qrX + qrSize / 2}" y="${qrY + qrSize - 4}" font-family="Arial,sans-serif" font-size="6" fill="#9ca3af" text-anchor="middle">${escapeXml(data.qrPayload.substring(0, 12))}...</text>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n${elements}\n</svg>`;
}

/**
 * Generate mock PDF bytes from SVG (pure TS, no lib needed).
 * Format: PDF header marker + JSON metadata + badge data.
 */
export function generateBadgePdf(svg: string, data: BadgeData): Uint8Array {
  const header = '%PDF-1.4\n';
  const metadata = JSON.stringify({
    type: 'badge-pdf',
    activationId: data.activationId,
    displayName: data.displayName,
    displayCompany: data.displayCompany ?? null,
    displayRole: data.displayRole ?? null,
    qrPayload: data.qrPayload,
    generatedAt: new Date().toISOString(),
    svgLength: svg.length,
  });

  const body = `\n%%BeginMetadata\n${metadata}\n%%EndMetadata\n\n1 0 obj\n<< /Type /Catalog >>\nendobj\n\n2 0 obj\n<< /Type /Page /SVGContent ${svg.length} >>\nendobj\n\n%%EOF\n`;

  const full = header + body;
  const encoder = new TextEncoder();
  return encoder.encode(full);
}

/**
 * Generate PDF for multiple badges (batch).
 * Returns a single Uint8Array representing a merged PDF.
 */
export function generateBatchPdf(badges: GeneratedBadge[]): Uint8Array {
  const header = '%PDF-1.4\n%%BatchBadges\n';
  const metaParts: string[] = badges.map((b, idx) =>
    `%% Badge ${idx + 1}: activation=${b.activationId} svgLen=${b.svgContent.length}`,
  );
  const body = [
    header,
    metaParts.join('\n'),
    '\n',
    `%% Total badges: ${badges.length}`,
    '\n%%EOF\n',
  ].join('\n');

  // Concatenate all individual pdfBytes after the header
  const parts: Uint8Array[] = [new TextEncoder().encode(body)];
  for (const badge of badges) {
    parts.push(badge.pdfBytes);
  }

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
