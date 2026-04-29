// =============================================================================
// PDF GENERÁTOR — vstupenky pro Tixly
// Používá pdf-lib (čistý TypeScript, bez Chromia), qrcode a bwip-js.
// =============================================================================

import { PDFDocument, PDFPage, PDFFont, rgb, StandardFonts, degrees } from 'pdf-lib';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js';
import type { PdfTicketData, PdfGenerationResult } from '../types/pdf-ticket.types.js';
import { PdfGenerationError } from '../types/pdf-ticket.types.js';

// ---------------------------------------------------------------------------
// Konstanty layoutu (body units — 1 pt = 1/72 palce)
// A4 na výšku: 595.28 × 841.89 pt
// ---------------------------------------------------------------------------

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// Barvy (rgb 0–1)
const COLOR_BLUE = rgb(0.102, 0.337, 0.859);   // #1a56db
const COLOR_BLACK = rgb(0, 0, 0);
const COLOR_GRAY = rgb(0.45, 0.45, 0.45);
const COLOR_LIGHT_GRAY = rgb(0.75, 0.75, 0.75);
const COLOR_WHITE = rgb(1, 1, 1);

// ---------------------------------------------------------------------------
// Pomocné čisté funkce (exportovány pro testování)
// ---------------------------------------------------------------------------

/**
 * Formátuje datum a čas akce do lokalizovaného řetězce.
 *
 * cs: "pátek 15. srpna 2026, 19:00"
 * en: "Friday, August 15, 2026, 7:00 PM"
 */
export function formatEventDate(date: Date, lang: 'cs' | 'en'): string {
  if (lang === 'cs') {
    const dayName = date.toLocaleDateString('cs-CZ', { weekday: 'long' });
    const day = date.getDate();
    const monthName = date.toLocaleDateString('cs-CZ', { month: 'long' });
    const year = date.getFullYear();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${dayName} ${day}. ${monthName} ${year}, ${hours}:${minutes}`;
  } else {
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
    const monthName = date.toLocaleDateString('en-US', { month: 'long' });
    const day = date.getDate();
    const year = date.getFullYear();
    const timeStr = date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return `${dayName}, ${monthName} ${day}, ${year}, ${timeStr}`;
  }
}

/**
 * Generuje bezpečný název souboru z názvu akce a ID vstupenky.
 * Odstraní diakritiku, převede na lowercase, mezery nahradí pomlčkami.
 * Maximální délka: 60 znaků (bez .pdf přípony).
 *
 * Příklad: "Kabát — O2 Arena Praha" + "abc12345" → "kabat-o2-arena-praha-abc12345.pdf"
 */
export function generateFilename(eventName: string, ticketId: string): string {
  const shortTicketId = ticketId.slice(0, 8);

  // Normalizace diakritiky: NFD rozloží znaky + accent removal
  const normalized = eventName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // odstraní akcenty
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')    // nahradí speciální znaky mezerou
    .trim()
    .replace(/\s+/g, '-')              // mezery → pomlčky
    .replace(/-+/g, '-')               // více pomlček → jedna
    .replace(/^-|-$/g, '');            // trim pomlček na krajích

  // Maximální délka základu (bez "-ticketId" a ".pdf")
  const maxBase = 60 - 1 - shortTicketId.length; // "-" + shortTicketId
  const truncatedBase = normalized.slice(0, maxBase).replace(/-$/, '');

  return `${truncatedBase}-${shortTicketId}.pdf`;
}

/**
 * Zkrátí ID na N znaků a přidá "..." pokud je delší.
 *
 * Příklady:
 *   truncateId("abc123def456", 8) → "abc123de..."
 *   truncateId("abc123", 8)       → "abc123"
 */
export function truncateId(id: string, length: number): string {
  if (id.length <= length) {
    return id;
  }
  return id.slice(0, length) + '...';
}

// ---------------------------------------------------------------------------
// Normalizace textu pro WinAnsi (standard PDF fonts nepodporují diakritiku)
// ---------------------------------------------------------------------------

/**
 * Převede znaky s diakritikou na jejich ASCII ekvivalenty.
 * Standard PDF fonty (Helvetica, Times, Courier) používají WinAnsi kódování,
 * které neumí zobrazit česká písmenka. Tato funkce je nahradí.
 */
function normalizeForPdf(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Odstraní kombinující diakritická znaménka
    .replace(/\u0141/g, 'L').replace(/\u0142/g, 'l') // Ł ł
    .replace(/[\u0110\u00D0]/g, 'D').replace(/[\u0111\u00F0]/g, 'd') // Đ đ
    .replace(/[\u0218\u015E]/g, 'S').replace(/[\u0219\u015F]/g, 's') // Ş ş
    .replace(/[\u021A\u0162]/g, 'T').replace(/[\u021B\u0163]/g, 't'); // Ţ ţ
}

// ---------------------------------------------------------------------------
// Interní pomocné funkce pro generování kódů
// ---------------------------------------------------------------------------

async function generateQrDataUrl(totpCode: string): Promise<string> {
  try {
    const dataUrl = await QRCode.toDataURL(totpCode, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 300,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });
    return dataUrl;
  } catch (err) {
    throw new PdfGenerationError(
      `Nepodařilo se vygenerovat QR kód: ${err instanceof Error ? err.message : String(err)}`,
      'QR_GENERATION_FAILED',
      err,
    );
  }
}

async function generateBarcodePngBuffer(barcodeCode: string): Promise<Buffer> {
  try {
    const buffer = await bwipjs.toBuffer({
      bcid: 'code128',
      text: barcodeCode,
      scale: 3,
      height: 10,
      includetext: true,
      textsize: 10,
      backgroundcolor: 'ffffff',
      barcolor: '000000',
    });
    return buffer;
  } catch (err) {
    throw new PdfGenerationError(
      `Nepodařilo se vygenerovat čárový kód: ${err instanceof Error ? err.message : String(err)}`,
      'BARCODE_GENERATION_FAILED',
      err,
    );
  }
}

/**
 * Převede data URL (PNG base64) na Uint8Array pro vložení do pdf-lib.
 */
function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1];
  if (!base64) {
    throw new PdfGenerationError(
      'Neplatný formát data URL pro QR kód',
      'QR_GENERATION_FAILED',
    );
  }
  const binaryStr = Buffer.from(base64, 'base64').toString('binary');
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Hlavní generátor PDF
// ---------------------------------------------------------------------------

/**
 * Generuje PDF vstupenku s QR kódem, čárovým kódem a všemi informacemi o akci.
 *
 * PDF se generuje on-demand — každé volání vytvoří nový soubor s aktuálním TOTP kódem.
 * Výsledek se neukládá na disk ani do databáze.
 *
 * @param data - Kompletní data vstupenky sestavenou callerem
 * @returns PdfGenerationResult s binárními daty PDF, názvem souboru a velikostí
 * @throws {PdfGenerationError} Pokud generování QR/barcode nebo sestavení PDF selže
 */
export async function generateTicketPdf(
  data: PdfTicketData,
): Promise<PdfGenerationResult> {
  try {
    // --- Generování kódů souběžně ---
    const [qrDataUrl, barcodePngBuffer] = await Promise.all([
      generateQrDataUrl(data.totpCode),
      generateBarcodePngBuffer(data.barcodeCode),
    ]);

    // --- Sestavení PDF dokumentu ---
    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(`Vstupenka - ${normalizeForPdf(data.eventName)}`);
    pdfDoc.setAuthor('Tixly');
    pdfDoc.setCreator('Tixly PDF Service');
    pdfDoc.setCreationDate(new Date());

    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

    // Fonty (Standard PDF fonts — nevyžadují embedding licenci)
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    // Vložení obrázků
    const qrImageBytes = dataUrlToUint8Array(qrDataUrl);
    const qrImage = await pdfDoc.embedPng(qrImageBytes);
    const barcodeImage = await pdfDoc.embedPng(barcodePngBuffer);

    // Normalize all user-supplied text for WinAnsi compatibility
    const safeData = {
      ...data,
      eventName: normalizeForPdf(data.eventName),
      eventVenue: normalizeForPdf(data.eventVenue),
      eventAddress: normalizeForPdf(data.eventAddress),
      ticketTypeName: normalizeForPdf(data.ticketTypeName),
      zone: data.zone ? normalizeForPdf(data.zone) : data.zone,
      seatNumber: data.seatNumber ? normalizeForPdf(data.seatNumber) : data.seatNumber,
      holderName: normalizeForPdf(data.holderName),
    };

    // ---------------------------------------------------------------------------
    // WATERMARK — nejprve (pod vším ostatním)
    // ---------------------------------------------------------------------------
    const wmFontSize = 80;
    const wmText = 'TIXLY';
    const wmTextWidth = fontBold.widthOfTextAtSize(wmText, wmFontSize);

    page.drawText(wmText, {
      x: PAGE_WIDTH / 2 - wmTextWidth / 2,
      y: PAGE_HEIGHT / 2 - wmFontSize / 2,
      size: wmFontSize,
      font: fontBold,
      color: COLOR_GRAY,
      opacity: 0.06,
      rotate: degrees(45),
    });

    // ---------------------------------------------------------------------------
    // ZÁHLAVÍ (top ~40mm = ~113pt)
    // ---------------------------------------------------------------------------
    const headerY = PAGE_HEIGHT - MARGIN;

    // Logo placeholder — "TIXLY" velkým písmem, modrá barva
    const logoFontSize = 28;
    const logoText = 'TIXLY';
    const logoTextWidth = fontBold.widthOfTextAtSize(logoText, logoFontSize);

    // Záhlaví pozadí (modrý pruh)
    page.drawRectangle({
      x: 0,
      y: PAGE_HEIGHT - 80,
      width: PAGE_WIDTH,
      height: 80,
      color: COLOR_BLUE,
    });

    // Logo text
    page.drawText(logoText, {
      x: PAGE_WIDTH / 2 - logoTextWidth / 2,
      y: headerY - 40,
      size: logoFontSize,
      font: fontBold,
      color: COLOR_WHITE,
    });

    // Podtext "Vstupenka / Ticket"
    const subtitleText = safeData.language === 'cs' ? 'Vstupenka' : 'Ticket';
    const subtitleFontSize = 11;
    const subtitleWidth = fontRegular.widthOfTextAtSize(subtitleText, subtitleFontSize);
    page.drawText(subtitleText, {
      x: PAGE_WIDTH / 2 - subtitleWidth / 2,
      y: PAGE_HEIGHT - 70,
      size: subtitleFontSize,
      font: fontRegular,
      color: rgb(0.8, 0.88, 0.98),
    });

    // ---------------------------------------------------------------------------
    // NÁZEV AKCE
    // ---------------------------------------------------------------------------
    let currentY = PAGE_HEIGHT - 110;

    const eventFontSize = 22;
    // Zalamování dlouhého názvu akce
    const maxEventNameWidth = CONTENT_WIDTH;
    const eventNameLines = wrapText(safeData.eventName, fontBold, eventFontSize, maxEventNameWidth);

    for (const line of eventNameLines) {
      const lineWidth = fontBold.widthOfTextAtSize(line, eventFontSize);
      page.drawText(line, {
        x: PAGE_WIDTH / 2 - lineWidth / 2,
        y: currentY,
        size: eventFontSize,
        font: fontBold,
        color: COLOR_BLACK,
      });
      currentY -= eventFontSize + 6;
    }

    currentY -= 8;

    // ---------------------------------------------------------------------------
    // DATUM A MÍSTO
    // ---------------------------------------------------------------------------
    const dateFontSize = 13;
    const dateText = formatEventDate(safeData.eventDate, safeData.language);
    const dateWidth = fontRegular.widthOfTextAtSize(dateText, dateFontSize);
    page.drawText(dateText, {
      x: PAGE_WIDTH / 2 - dateWidth / 2,
      y: currentY,
      size: dateFontSize,
      font: fontRegular,
      color: COLOR_GRAY,
    });

    currentY -= dateFontSize + 6;

    const venueText = `${safeData.eventVenue} - ${safeData.eventAddress}`;
    const venueFontSize = 11;
    const venueLines = wrapText(venueText, fontRegular, venueFontSize, CONTENT_WIDTH);
    for (const line of venueLines) {
      const lineWidth = fontRegular.widthOfTextAtSize(line, venueFontSize);
      page.drawText(line, {
        x: PAGE_WIDTH / 2 - lineWidth / 2,
        y: currentY,
        size: venueFontSize,
        font: fontRegular,
        color: COLOR_GRAY,
      });
      currentY -= venueFontSize + 4;
    }

    currentY -= 12;

    // ---------------------------------------------------------------------------
    // ODDĚLOVAČ
    // ---------------------------------------------------------------------------
    page.drawLine({
      start: { x: MARGIN, y: currentY },
      end: { x: PAGE_WIDTH - MARGIN, y: currentY },
      thickness: 0.5,
      color: COLOR_LIGHT_GRAY,
    });

    currentY -= 20;

    // ---------------------------------------------------------------------------
    // INFORMACE O VSTUPENCE (2 sloupce)
    // ---------------------------------------------------------------------------
    const colLeft = MARGIN;
    const colRight = PAGE_WIDTH / 2 + 10;
    const labelSize = 8;
    const valueSize = 11;
    const rowGap = 28;

    const lang = safeData.language;

    // --- Levý sloupec ---
    let leftY = currentY;

    // Typ vstupenky
    drawLabelValue(
      page,
      lang === 'cs' ? 'Typ vstupenky' : 'Ticket type',
      safeData.ticketTypeName,
      colLeft,
      leftY,
      labelSize,
      valueSize,
      fontOblique,
      fontBold,
    );
    leftY -= rowGap;

    // Zona / Sedadlo
    const zoneValue =
      safeData.zone && safeData.seatNumber
        ? `${safeData.zone} - ${safeData.seatNumber}`
        : safeData.zone ?? safeData.seatNumber ?? (lang === 'cs' ? 'Volne stani' : 'General admission');
    drawLabelValue(
      page,
      lang === 'cs' ? 'Zona / Sedadlo' : 'Zone / Seat',
      zoneValue,
      colLeft,
      leftY,
      labelSize,
      valueSize,
      fontOblique,
      fontBold,
    );
    leftY -= rowGap;

    // Jméno držitele
    drawLabelValue(
      page,
      lang === 'cs' ? 'Jmeno drzitele' : 'Holder name',
      safeData.holderName,
      colLeft,
      leftY,
      labelSize,
      valueSize,
      fontOblique,
      fontBold,
    );

    // --- Pravý sloupec ---
    let rightY = currentY;

    // Order ID
    drawLabelValue(
      page,
      lang === 'cs' ? 'Cislo objednavky' : 'Order ID',
      truncateId(safeData.orderId, 8),
      colRight,
      rightY,
      labelSize,
      valueSize,
      fontOblique,
      fontRegular,
    );
    rightY -= rowGap;

    // Ticket ID
    drawLabelValue(
      page,
      lang === 'cs' ? 'ID vstupenky' : 'Ticket ID',
      truncateId(safeData.ticketId, 8),
      colRight,
      rightY,
      labelSize,
      valueSize,
      fontOblique,
      fontRegular,
    );
    rightY -= rowGap;

    // Vydáno
    const issuedDateStr = safeData.issuedAt.toLocaleDateString(
      lang === 'cs' ? 'cs-CZ' : 'en-US',
      { day: 'numeric', month: 'long', year: 'numeric' },
    );
    drawLabelValue(
      page,
      lang === 'cs' ? 'Vydano' : 'Issued',
      issuedDateStr,
      colRight,
      rightY,
      labelSize,
      valueSize,
      fontOblique,
      fontRegular,
    );

    // Posun za oba sloupce
    currentY = Math.min(leftY, rightY) - 20;

    // ---------------------------------------------------------------------------
    // ODDĚLOVAČ 2
    // ---------------------------------------------------------------------------
    page.drawLine({
      start: { x: MARGIN, y: currentY },
      end: { x: PAGE_WIDTH - MARGIN, y: currentY },
      thickness: 0.5,
      color: COLOR_LIGHT_GRAY,
    });

    currentY -= 20;

    // ---------------------------------------------------------------------------
    // QR KÓD (80×80mm = ~227×227pt)
    // ---------------------------------------------------------------------------
    const qrSizePt = 227;
    const qrX = PAGE_WIDTH / 2 - qrSizePt / 2;
    const qrY = currentY - qrSizePt;

    page.drawImage(qrImage, {
      x: qrX,
      y: qrY,
      width: qrSizePt,
      height: qrSizePt,
    });

    // Popisek QR kódu
    const qrLabelText = lang === 'cs' ? 'Naskenujte pri vstupu' : 'Scan at entry';
    const qrLabelSize = 10;
    const qrLabelWidth = fontRegular.widthOfTextAtSize(qrLabelText, qrLabelSize);
    page.drawText(qrLabelText, {
      x: PAGE_WIDTH / 2 - qrLabelWidth / 2,
      y: qrY - qrLabelSize - 6,
      size: qrLabelSize,
      font: fontRegular,
      color: COLOR_GRAY,
    });

    currentY = qrY - qrLabelSize - 22;

    // ---------------------------------------------------------------------------
    // ČÁROVÝ KÓD Code 128 (120×25mm = ~340×71pt)
    // ---------------------------------------------------------------------------
    const barWidth = 340;
    const barHeight = 71;
    const barX = PAGE_WIDTH / 2 - barWidth / 2;
    const barY = currentY - barHeight;

    page.drawImage(barcodeImage, {
      x: barX,
      y: barY,
      width: barWidth,
      height: barHeight,
    });

    // Text barcode_code pod čárovým kódem
    const barTextSize = 9;
    const barTextWidth = fontRegular.widthOfTextAtSize(safeData.barcodeCode, barTextSize);
    page.drawText(safeData.barcodeCode, {
      x: PAGE_WIDTH / 2 - barTextWidth / 2,
      y: barY - barTextSize - 4,
      size: barTextSize,
      font: fontRegular,
      color: COLOR_GRAY,
    });

    currentY = barY - barTextSize - 20;

    // ---------------------------------------------------------------------------
    // PODMÍNKY
    // ---------------------------------------------------------------------------
    const conditionsFontSize = 8;
    const conditions: Record<'cs' | 'en', string[]> = {
      cs: [
        'Vstupenka je platna pouze jednou.',
        'Vstupenka neni prenosna bez souhlasu poradatele.',
        'V pripade ztraty kontaktujte podporu.',
      ],
      en: [
        'This ticket is valid for single use only.',
        'The ticket is non-transferable without the organizer\'s consent.',
        'In case of loss, please contact support.',
      ],
    };

    const conditionsLabel = lang === 'cs' ? 'Podminky vstupu:' : 'Entry conditions:';
    page.drawText(conditionsLabel, {
      x: MARGIN,
      y: currentY,
      size: conditionsFontSize,
      font: fontBold,
      color: COLOR_GRAY,
    });
    currentY -= conditionsFontSize + 4;

    for (const line of conditions[lang]) {
      page.drawText(`• ${line}`, {
        x: MARGIN,
        y: currentY,
        size: conditionsFontSize,
        font: fontRegular,
        color: COLOR_GRAY,
      });
      currentY -= conditionsFontSize + 3;
    }

    // ---------------------------------------------------------------------------
    // Serializace PDF
    // ---------------------------------------------------------------------------
    const pdfBytes = await pdfDoc.save();
    const filename = generateFilename(data.eventName, data.ticketId);

    return {
      pdfBytes,
      filename,
      sizeBytes: pdfBytes.length,
    };
  } catch (err) {
    // Re-throw PdfGenerationError tak jak je
    if (err instanceof PdfGenerationError) {
      throw err;
    }
    // Ostatní chyby zabal do PdfGenerationError
    throw new PdfGenerationError(
      `Sestavení PDF vstupenky selhalo: ${err instanceof Error ? err.message : String(err)}`,
      'PDF_ASSEMBLY_FAILED',
      err,
    );
  }
}

// ---------------------------------------------------------------------------
// Interní helpers pro kreslení
// ---------------------------------------------------------------------------

/**
 * Nakreslí label + hodnotu pod sebou na dané souřadnice.
 */
function drawLabelValue(
  page: PDFPage,
  label: string,
  value: string,
  x: number,
  y: number,
  labelSize: number,
  valueSize: number,
  labelFont: PDFFont,
  valueFont: PDFFont,
): void {
  page.drawText(label, {
    x,
    y: y + valueSize + 2,
    size: labelSize,
    font: labelFont,
    color: COLOR_GRAY,
  });
  page.drawText(value, {
    x,
    y,
    size: valueSize,
    font: valueFont,
    color: COLOR_BLACK,
  });
}

/**
 * Jednoduchý text wrapper — rozdělí text do řádků dle maximální šířky.
 */
function wrapText(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = font.widthOfTextAtSize(testLine, fontSize);

    if (testWidth <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [''];
}
