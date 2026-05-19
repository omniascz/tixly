import { describe, expect, it } from 'vitest';
import { buildIsdocXml, IsdocInvoiceData } from './isdoc';

const fixture: IsdocInvoiceData = {
  invoiceNumber: '2026-0042',
  issueDate: '2026-05-20',
  taxableSupplyDate: '2026-05-20',
  dueDate: '2026-06-03',
  supplier: {
    name: 'Tixly s.r.o.',
    ico: '12345678',
    dic: 'CZ12345678',
    address: {
      street: 'Václavské náměstí 1',
      city: 'Praha 1',
      zip: '11000',
      country: 'CZ',
    },
    bankAccount: '123456789/0100',
    email: 'fakturace@tixly.cz',
  },
  customer: {
    name: 'Jan Novák',
    email: 'jan@example.com',
    address: {
      street: 'Tržiště 22',
      city: 'Brno',
      zip: '60200',
      country: 'CZ',
    },
  },
  lines: [
    {
      description: 'Vstupenka — Koncert XY (kat. VIP)',
      quantity: 2,
      unitPriceWithoutVat: 1000,
      vatRatePct: 10,
    },
    {
      description: 'Servisní poplatek',
      quantity: 1,
      unitPriceWithoutVat: 50,
      vatRatePct: 21,
    },
  ],
  currency: 'CZK',
  subtotal: 2050,
  vatAmount: 210.5,
  total: 2260.5,
  paymentMeans: 'transfer',
  variableSymbol: '20260042',
};

describe('buildIsdocXml', () => {
  it('startuje UTF-8 BOM (Money S3 kompatibilita)', () => {
    const xml = buildIsdocXml(fixture);
    expect(xml.charCodeAt(0)).toBe(0xfeff);
  });

  it('obsahuje correct invoice number + UUID', () => {
    const xml = buildIsdocXml(fixture);
    expect(xml).toContain('<ID>2026-0042</ID>');
    expect(xml).toContain('<UUID>tixly-2026-0042</UUID>');
  });

  it('escapuje XML special characters', () => {
    const f = {
      ...fixture,
      lines: [{ ...fixture.lines[0], description: 'Test & "quote" <tag>' }],
    };
    const xml = buildIsdocXml(f);
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&quot;');
    expect(xml).toContain('&lt;tag&gt;');
  });

  it('obsahuje DIČ supplier when set', () => {
    const xml = buildIsdocXml(fixture);
    expect(xml).toMatch(/<CompanyID>CZ12345678<\/CompanyID>/);
  });

  it('grupuje VAT rates do TaxSubTotal breakdown', () => {
    const xml = buildIsdocXml(fixture);
    // 10% sazba (2 ks × 1000 = 2000 base)
    expect(xml).toMatch(/<TaxableAmount>2000\.00<\/TaxableAmount>\s+<TaxAmount>200\.00<\/TaxAmount>/);
    // 21% sazba (1 ks × 50 = 50 base)
    expect(xml).toMatch(/<TaxableAmount>50\.00<\/TaxableAmount>\s+<TaxAmount>10\.50<\/TaxAmount>/);
  });

  it('payment means code: bankovní převod = 42', () => {
    const xml = buildIsdocXml(fixture);
    expect(xml).toContain('<PaymentMeansCode>42</PaymentMeansCode>');
  });

  it('LegalMonetaryTotal odpovídá zadanému subtotal/vat/total', () => {
    const xml = buildIsdocXml(fixture);
    expect(xml).toContain('<TaxExclusiveAmount>2050.00</TaxExclusiveAmount>');
    expect(xml).toContain('<TaxInclusiveAmount>2260.50</TaxInclusiveAmount>');
    expect(xml).toContain('<PayableAmount>2260.50</PayableAmount>');
  });

  it('VariableSymbol je v PaymentMeans Details', () => {
    const xml = buildIsdocXml(fixture);
    expect(xml).toContain('<VariableSymbol>20260042</VariableSymbol>');
  });

  it('cash payment → kód 10', () => {
    const xml = buildIsdocXml({ ...fixture, paymentMeans: 'cash' });
    expect(xml).toContain('<PaymentMeansCode>10</PaymentMeansCode>');
  });

  it('SK customer country se mapuje na "Slovensko"', () => {
    const xml = buildIsdocXml({
      ...fixture,
      customer: {
        ...fixture.customer,
        address: { ...fixture.customer.address!, country: 'SK' },
      },
    });
    expect(xml).toContain('<Name>Slovensko</Name>');
  });
});
