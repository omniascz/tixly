/**
 * Fan Ticket renderer — premium sběratelská digitální vstupenka.
 *
 * Formát: A4 landscape (842 × 595 pt)
 *   - Levá část (60 %): artwork promotéra (poster / fotka umělce)
 *   - Pravá část (40 %): tmavý panel se jménem akce, datem, QR kódem
 *
 * Analogie k Eventim FanTicket, ale 100 % digitální — bez fyzického tisku.
 * Generuje se pouze pokud promotér nahrál artwork a zapnul fan_ticket_enabled.
 */

import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

const FONT_DIR = join(process.cwd(), 'src', 'lib', 'tickets', 'fonts');
const FONT_REGULAR = join(FONT_DIR, 'NotoSans-Regular.ttf');
const FONT_BOLD    = join(FONT_DIR, 'NotoSans-Bold.ttf');

// A4 landscape
const W      = 842;
const H      = 595;
const SPLIT  = 505; // artwork panel šířka (60 %)
const PANEL  = W - SPLIT; // info panel šířka (337 pt)
const PAD    = 28;  // padding uvnitř info panelu

function hex2rgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  return [parseInt(c.slice(0,2),16), parseInt(c.slice(2,4),16), parseInt(c.slice(4,6),16)];
}

function isValidHex(c: string | null | undefined): c is string {
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
}

export interface FanTicketInput {
  eventTitle: string;
  eventDateStart: string;
  venueName: string | null;
  ticketTypeName: string;
  seatLabel: string | null;
  holderName: string;
  holderEmail: string;
  ticketId: string;
  orderId: string;
  /** TOTP secret base32 pro QR kód */
  totpSecretBase32: string;
  brandColorHex: string | null;
  artworkUrl: string | null;
  promoterName: string | null;
}

async function loadImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  } catch {
    return null;
  }
}

export async function renderFanTicketPdf(data: FanTicketInput): Promise<Buffer> {
  const accentColor = isValidHex(data.brandColorHex) ? data.brandColorHex : '#c9a84c';
  const [ar, ag, ab] = hex2rgb(accentColor);

  // Load artwork
  const artworkBuf = data.artworkUrl ? await loadImageBuffer(data.artworkUrl) : null;

  const doc = new PDFDocument({ size: [W, H], margin: 0, autoFirstPage: false });
  doc.registerFont('regular', FONT_REGULAR);
  doc.registerFont('bold', FONT_BOLD);

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  doc.addPage({ size: [W, H], margin: 0 });

  // ─── Artwork panel (left) ─────────────────────────────────────────────────

  if (artworkBuf) {
    // Clip to left panel, then draw image scaled to fill width
    doc.save();
    doc.rect(0, 0, SPLIT, H).clip();
    doc.image(artworkBuf, 0, 0, { width: SPLIT });
    // Dark gradient overlay on right edge of artwork for smooth transition
    // Simulate gradient with 4 overlapping semi-transparent rects
    const fade = 80; // transition width
    for (let i = 0; i < 4; i++) {
      const opacity = (i + 1) * 0.18;
      const xStart = SPLIT - fade + i * (fade / 4);
      doc.rect(xStart, 0, fade / 4 + 2, H)
         .fillOpacity(opacity)
         .fill('#000000');
    }
    doc.restore();
    doc.fillOpacity(1);
  } else {
    // Fallback: gradient from brand color to dark
    const [br, bg, bb] = hex2rgb(accentColor);
    // Top area — brand color (lighter)
    doc.rect(0, 0, SPLIT, H / 2)
       .fill(`rgb(${Math.min(br + 30, 255)},${Math.min(bg + 20, 255)},${Math.min(bb + 10, 255)})`);
    // Bottom area — darker
    doc.rect(0, H / 2, SPLIT, H / 2)
       .fill(`rgb(${Math.round(br * 0.5)},${Math.round(bg * 0.5)},${Math.round(bb * 0.5)})`);
    // Tixly logotype watermark
    doc.font('bold').fontSize(72).fillColor('#ffffff').fillOpacity(0.06)
       .text('T', SPLIT / 2 - 36, H / 2 - 50);
    doc.fillOpacity(1);
    // Subtle right fade
    for (let i = 0; i < 4; i++) {
      const opacity = (i + 1) * 0.2;
      doc.rect(SPLIT - 80 + i * 20, 0, 22, H)
         .fillOpacity(opacity)
         .fill('#000000');
    }
    doc.fillOpacity(1);
  }

  // Thin accent stripe separating artwork from info panel
  doc.rect(SPLIT - 2, 0, 2, H).fill(accentColor);

  // ─── Info panel (right, dark) ─────────────────────────────────────────────

  const PX = SPLIT + PAD; // panel content x start
  const PW = PANEL - PAD * 2; // panel content width

  doc.rect(SPLIT, 0, PANEL, H).fill('#0a0a0a');

  // Top: small promoter name
  doc.font('regular').fontSize(9).fillColor(`rgba(${ar},${ag},${ab},0.8)`)
     .text((data.promoterName ?? 'Tixly').toUpperCase(), PX, PAD, { width: PW });

  // Thin accent line under promoter name
  const lineY = PAD + 16;
  doc.rect(PX, lineY, PW, 1).fillOpacity(0.3).fill(accentColor).fillOpacity(1);

  // Event title — large, bold, white
  const titleY = lineY + 10;
  doc.font('bold').fontSize(22).fillColor('#ffffff')
     .text(data.eventTitle, PX, titleY, { width: PW, lineGap: 2 });

  const afterTitleY = doc.y + 6;

  // Date
  const dateStr = (() => {
    try {
      return new Date(data.eventDateStart).toLocaleDateString('cs-CZ', {
        weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
      });
    } catch { return data.eventDateStart; }
  })();
  doc.font('regular').fontSize(11).fillColor('rgba(255,255,255,0.65)')
     .text(dateStr, PX, afterTitleY, { width: PW });

  // Venue
  if (data.venueName) {
    doc.font('regular').fontSize(11).fillColor('rgba(255,255,255,0.5)')
       .text(data.venueName, PX, doc.y + 1, { width: PW });
  }

  // Ticket type + seat
  const typeY = doc.y + 14;
  doc.rect(PX, typeY, 3, 36).fill(accentColor);
  doc.font('bold').fontSize(11).fillColor('#ffffff')
     .text(data.ticketTypeName, PX + 10, typeY, { width: PW - 10 });
  if (data.seatLabel) {
    doc.font('regular').fontSize(9).fillColor('rgba(255,255,255,0.5)')
       .text(data.seatLabel, PX + 10, doc.y + 1, { width: PW - 10 });
  }

  // ─── QR code ──────────────────────────────────────────────────────────────

  const otpUri = `otpauth://totp/${encodeURIComponent(data.eventTitle)}:${encodeURIComponent(data.holderEmail)}?secret=${data.totpSecretBase32}&issuer=${encodeURIComponent(data.eventTitle)}&algorithm=SHA1&digits=6&period=30`;
  const qrPng = await QRCode.toBuffer(otpUri, {
    errorCorrectionLevel: 'M',
    margin: 0,
    color: { dark: '#000000', light: '#ffffff' },
    width: 140,
  });

  const qrSize = 130;
  const qrX = PX + (PW - qrSize) / 2;
  const qrY = H - PAD - qrSize - 36;

  // White QR background with border radius effect (rounded rect)
  doc.roundedRect(qrX - 6, qrY - 6, qrSize + 12, qrSize + 12, 4)
     .fill('#ffffff');
  doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });

  // ─── Footer ───────────────────────────────────────────────────────────────

  const footerY = H - PAD - 20;
  doc.font('regular').fontSize(7).fillColor('rgba(255,255,255,0.25)')
     .text(
       `${data.ticketId.slice(0, 16).toUpperCase()} · Tixly`,
       PX, footerY, { width: PW, align: 'center' },
     );

  // ─── Bottom-left on artwork: holder name watermark ────────────────────────

  if (artworkBuf) {
    doc.save();
    doc.rect(0, H - 60, SPLIT, 60).clip();
    // Semi-transparent dark bar at bottom of artwork
    doc.rect(0, H - 60, SPLIT, 60).fillOpacity(0.55).fill('#000000').fillOpacity(1);
    doc.font('regular').fontSize(10).fillColor('rgba(255,255,255,0.7)')
       .text(data.holderName || data.holderEmail, PAD, H - 38, { width: SPLIT - PAD * 2 });
    doc.font('regular').fontSize(8).fillColor('rgba(255,255,255,0.4)')
       .text('Fan Ticket · Tixly', PAD, H - 22, { width: SPLIT - PAD * 2 });
    doc.restore();
    doc.fillOpacity(1);
  }

  doc.end();

  return new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}
