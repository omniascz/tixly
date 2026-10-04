/**
 * ISDOC 6.0.2 proti OFICIÁLNÍMU XSD (kolo 7, C-54). Schéma: src/lib/accounting/xsd/isdoc-invoice-6.0.2.xsd,
 * staženo z https://isdoc.cz/6.0.2/xsd/isdoc-invoice-6.0.2.xsd (MVČR, verze 6.0.2 z 23. 3. 2022),
 * sha256 fb5de36fe7b5517acb8aa0c7950d91f8e28910e63b8cdcaaf7db0b0f4f0420bb. Validátor: xmllint-wasm (libxml2).
 */
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { validateXML } from 'xmllint-wasm';
import { buildIsdocXml } from './isdoc';
import type { TaxDocument } from './tax-document';

const XSD_PATH = path.join(__dirname, 'xsd', 'isdoc-invoice-6.0.2.xsd');
const XSD = readFileSync(XSD_PATH, 'utf8');

async function validate(xml: string): Promise<{ valid: boolean; errors: string[] }> {
  const r = await validateXML({
    xml: [{ fileName: 'doklad.isdoc', contents: xml }],
    schema: [{ fileName: 'isdoc-invoice-6.0.2.xsd', contents: XSD }],
  });
  return { valid: r.valid, errors: r.errors.map((e) => e.rawMessage ?? e.message) };
}

const supplierPayer = {
  name: 'Divadlo Test s.r.o.', ico: '12345678', dic: 'CZ12345678', vatPayer: true,
  address: { street: 'Celetná 17', city: 'Praha', zip: '11000', country: 'CZ' }, email: 'pokladna@divadlo.test',
};
const customer = { name: 'Jana Nováková', email: 'jana@example.test', address: null };

const payerDoc: TaxDocument = {
  id: '6f1c3a1e-2b4d-4c8e-9a7b-1d2e3f4a5b6c', docType: 'invoice', number: '2026-0001',
  issueDate: '2026-10-04', taxableSupplyDate: '2026-10-03', dueDate: '2026-10-03', currency: 'CZK',
  supplier: supplierPayer, customer,
  items: [
    { description: 'Vstupné (sazba DPH 21 %)', quantity: 1, totalMinor: 12100, vatRateCode: 'CZ_STANDARD', ratePct: 21 },
    { description: 'Vstupné (sazba DPH 12 %)', quantity: 1, totalMinor: 50000, vatRateCode: 'CZ_REDUCED', ratePct: 12 },
  ],
  vatLines: [
    { vatRateCode: 'CZ_STANDARD', ratePct: 21, baseMinor: 10000, vatMinor: 2100, totalMinor: 12100 },
    { vatRateCode: 'CZ_REDUCED', ratePct: 12, baseMinor: 44643, vatMinor: 5357, totalMinor: 50000 },
  ],
  totalMinor: 62100, correctedDocument: null, paid: true,
};

const nonPayerDoc: TaxDocument = {
  ...payerDoc, id: '0a1b2c3d-4e5f-4061-8a9b-0c1d2e3f4a5b', number: '2026-0007',
  supplier: { ...supplierPayer, dic: null, vatPayer: false },
  items: [{ description: 'Vstupné', quantity: 2, totalMinor: 60000, vatRateCode: null, ratePct: null }],
  vatLines: [], totalMinor: 60000,
};

const creditNote: TaxDocument = {
  ...payerDoc, id: '9e8d7c6b-5a49-4382-9172-6b5a4c3d2e1f', docType: 'credit_note', number: 'D2026-0001',
  items: [{ description: 'Vstupné (sazba DPH 12 %)', quantity: 1, totalMinor: -50000, vatRateCode: 'CZ_REDUCED', ratePct: 12 }],
  vatLines: [{ vatRateCode: 'CZ_REDUCED', ratePct: 12, baseMinor: -44643, vatMinor: -5357, totalMinor: -50000 }],
  totalMinor: -50000,
  correctedDocument: { id: payerDoc.id, number: payerDoc.number, issueDate: payerDoc.issueDate },
};

describe('ISDOC 6.0.2 proti oficiálnímu XSD', () => {
  it('schéma je to oficiální (otisk souboru)', () => {
    expect(createHash('sha256').update(readFileSync(XSD_PATH)).digest('hex')).toBe('fb5de36fe7b5517acb8aa0c7950d91f8e28910e63b8cdcaaf7db0b0f4f0420bb');
  });

  it('validátor skutečně hlídá: doklad bez povinného ID neprojde, starý tvar UUID neprojde', async () => {
    const xml = buildIsdocXml(payerDoc);
    const noId = await validate(xml.replace('<ID>2026-0001</ID>', ''));
    expect(noId.valid).toBe(false);
    const badUuid = await validate(xml.replace(/<UUID>[^<]+<\/UUID>/, '<UUID>tixly-2026-0001</UUID>'));
    expect(badUuid.valid).toBe(false);
    expect(badUuid.errors.join(' ')).toMatch(/UUID/);
  });

  it('plátce DPH, dvě sazby — projde validací, rozpis po sazbách', async () => {
    const xml = buildIsdocXml(payerDoc);
    const v = await validate(xml);
    expect(v.errors).toEqual([]);
    expect(v.valid).toBe(true);
    expect(xml).toContain('<DocumentType>1</DocumentType>');
    expect(xml).toContain('<TaxAmount>74.57</TaxAmount>');
  });

  it('neplátce — projde validací, VATApplicable=false a text o neplátci', async () => {
    const xml = buildIsdocXml(nonPayerDoc);
    const v = await validate(xml);
    expect(v.errors).toEqual([]);
    expect(xml).toContain('<VATApplicable>false</VATApplicable>');
    expect(xml).toContain('Prodávající není plátcem DPH.');
  });

  it('dobropis při refundu — projde validací, DocumentType 2, odkaz na původní doklad, záporné částky', async () => {
    const xml = buildIsdocXml(creditNote);
    const v = await validate(xml);
    expect(v.errors).toEqual([]);
    expect(xml).toContain('<DocumentType>2</DocumentType>');
    expect(xml).toContain('<ID>2026-0001</ID>');
    expect(xml).toContain('<TaxInclusiveAmount>-500.00</TaxInclusiveAmount>');
  });
});
