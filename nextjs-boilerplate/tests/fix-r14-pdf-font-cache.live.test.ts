// @vitest-environment node
/**
 * Kolo 14 / krok 2 — PDF vstupenek při náporu prodeje (C-60): profil serveru ukázal ~23 % CPU v parsování TTF písem
 * (fontkit/restructure) — každé PDF znovu parsovalo NotoSans (2 × 570 kB). Písmo se má rozparsovat JEDNOU za běh
 * procesu a dál se jen sdílet (každý dokument má vlastní subset). Výsledná PDF musí být dál platná s vloženým písmem.
 * Bez DB (běží i v CI live sadě).
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pdfFontCacheStats, renderTicketsPdf } from '@/lib/tickets/pdf-renderer';

const header = {
  eventTitle: 'Racek', eventDateStart: new Date('2026-11-20T19:00:00Z').toISOString(), venueName: 'Městské divadlo Brno',
  buyerName: 'Jana Nováková', buyerEmail: 'jana@example.test', orderId: '11111111-2222-4333-8444-555555555555',
  promoterName: 'Agentura', brandColorHex: null, brandLogoUrl: null, vatRatePct: 12,
};
const ticket = (i: number, name: string) => ({
  ticketId: `11111111-2222-4333-8444-55555555555${i}`, ticketTypeName: 'Zóna A', totpSecretBase32: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  holderLabel: 'jana@example.test', issuer: 'Racek', unitPriceHalire: 45_000, seatLabel: `Přízemí · řada 1 · sedadlo ${i}`,
  accessibleGateInfo: null, categoryName: name, proofLabel: name === 'ZTP/P' ? 'ZTP/P' : null,
});

describe('PDF vstupenek — písmo se parsuje jednou', () => {
  it('pět PDF za sebou: písma rozparsována nejvýš jednou, každé PDF platné s vloženým písmem a českým textem', async () => {
    const before = pdfFontCacheStats().parses;
    const pdfs: Buffer[] = [];
    for (let i = 1; i <= 5; i++) {
      pdfs.push(await renderTicketsPdf(header as never, [ticket(1, 'Plné'), ticket(2, 'ZTP/P')] as never));
    }
    // regular + bold — nejvýš dvě parsování za celý běh procesu (0, když už je cache teplá)
    expect(pdfFontCacheStats().parses - before).toBeLessThanOrEqual(2);
    expect(pdfFontCacheStats().parses).toBeLessThanOrEqual(2);
    for (const pdf of pdfs) {
      const s = pdf.toString('latin1');
      expect(s.startsWith('%PDF-')).toBe(true);
      expect(s).toContain('/FontFile2'); // vložené TrueType písmo (subset)
      expect(s).toMatch(/NotoSans/);
      expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    }
    if (process.env.R14_PDF_OUT) writeFileSync(process.env.R14_PDF_OUT, pdfs[4]); // vizuální kontrola (páté PDF = písmo z cache)
    // dokumenty jsou nezávislé: stejný obsah → stejně velké PDF (subset se nesčítá přes dokumenty)
    const sizes = pdfs.map((p) => p.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThan(200);
  }, 60_000);
});
