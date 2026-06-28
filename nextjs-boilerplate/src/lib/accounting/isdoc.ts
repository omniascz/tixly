/**
 * ISDOC 6.0.2 export — český standard pro elektronickou výměnu faktur.
 *
 * Podporuje import do: Pohoda, Money S3, Helios Easy, Helios Orange, ABRA,
 * Stormware, Premier System, FlexiBee.
 *
 * Spec: https://isdoc.cz/6.0.2/documentation/ISDOC%206.0.2%20schema.html
 *
 * Aktuální podpora:
 *   - InvoiceTypeCode 1 (vystavená faktura — daňový doklad)
 *   - Reverse-charge (B2B EU) — nepodporujeme, M2 (potřeba dodavatel DIČ EU)
 *   - Zálohy (Z00, Z01) — nepodporujeme, M2
 *   - Cizí měna (kurz ČNB) — single-currency invoice ano, multi-currency ne
 *
 * Limity ISDOC parser kompatibility:
 *   - Pohoda: vyžaduje UID atribut na <Invoice> (přidáno)
 *   - Money S3: vyžaduje <ID> i <IssueDate> a kódování UTF-8 BOM (přidáno)
 *   - Helios: vyžaduje VATAmount = sum(LineExtensionAmount * VatRate/100)
 */

export interface IsdocInvoiceData {
  // Identifikace faktury
  invoiceNumber: string;          // "2026-0042"
  issueDate: string;              // ISO date "2026-05-20"
  taxableSupplyDate: string;      // DUZP (date of taxable supply, ISO)
  dueDate: string;                // ISO

  // Dodavatel (promotér)
  supplier: {
    name: string;
    ico: string;                  // 8 znaků CZ IČO
    dic?: string;                 // CZ + 8-10 znaků
    address: {
      street: string;
      city: string;
      zip: string;
      country: string;            // "CZ"
    };
    bankAccount?: string;         // "123456789/0100"
    iban?: string;
    bic?: string;
    email?: string;
    phone?: string;
  };

  // Odběratel (kupec)
  customer: {
    name: string;
    ico?: string;
    dic?: string;
    address?: {
      street?: string;
      city?: string;
      zip?: string;
      country?: string;
    };
    email?: string;
  };

  // Řádky faktury
  lines: Array<{
    description: string;
    quantity: number;
    unitPriceWithoutVat: number;  // CZK (decimal, ne haléře)
    vatRatePct: number;           // 0, 10, 12, 15, 21
  }>;

  // Souhrny (CZK decimal)
  currency: string;               // "CZK" | "EUR"
  subtotal: number;               // sum řádků bez DPH
  vatAmount: number;              // celkem DPH
  total: number;                  // s DPH
  exchangeRate?: number;          // pokud currency != "CZK"

  // Platba
  paymentMeans?: 'transfer' | 'card' | 'cash';
  variableSymbol?: string;

  // EU B2B Reverse charge (mig 390)
  isReverseCharge?: boolean;
  reverseChargeNote?: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fmt(n: number): string {
  return n.toFixed(2);
}

function paymentMeansCode(p?: string): string {
  switch (p) {
    case 'transfer':
      return '42'; // bankovní převod
    case 'card':
      return '48';
    case 'cash':
      return '10';
    default:
      return '42';
  }
}

/**
 * Vygeneruje ISDOC 6.0.2 XML jako string.
 *
 * Návratová hodnota OBSAHUJE UTF-8 BOM (Money S3 ho vyžaduje).
 */
export function buildIsdocXml(d: IsdocInvoiceData): string {
  const uid = `tixly-${d.invoiceNumber.replace(/[^A-Za-z0-9-]/g, '-')}`;

  // VAT breakdown by rate
  const vatBreakdown = new Map<number, { base: number; vat: number }>();
  for (const line of d.lines) {
    const lineSubtotal = line.quantity * line.unitPriceWithoutVat;
    const lineVat = (lineSubtotal * line.vatRatePct) / 100;
    const prev = vatBreakdown.get(line.vatRatePct) ?? { base: 0, vat: 0 };
    vatBreakdown.set(line.vatRatePct, {
      base: prev.base + lineSubtotal,
      vat: prev.vat + lineVat,
    });
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.2">
  <DocumentType>1</DocumentType>
  <ID>${escapeXml(d.invoiceNumber)}</ID>
  <UUID>${uid}</UUID>
  <IssueDate>${d.issueDate}</IssueDate>
  <TaxPointDate>${d.taxableSupplyDate}</TaxPointDate>
  <VATApplicable>${d.isReverseCharge ? 'false' : 'true'}</VATApplicable>
  <ElectronicPossibilityAgreementReference />
  <Note>${d.isReverseCharge ? escapeXml(d.reverseChargeNote ?? 'Přenesená daňová povinnost – Article 44, Council Directive 2006/112/EC.') : 'Vystaveno přes Tixly (tixly.cz)'}</Note>
  <LocalCurrencyCode>${escapeXml(d.currency)}</LocalCurrencyCode>
  <CurrRate>${d.exchangeRate ? fmt(d.exchangeRate) : '1.00'}</CurrRate>
  <RefCurrRate>1.00</RefCurrRate>
  <AccountingSupplierParty>
    <Party>
      <PartyIdentification>
        <ID>${escapeXml(d.supplier.ico)}</ID>
      </PartyIdentification>
      <PartyName>
        <Name>${escapeXml(d.supplier.name)}</Name>
      </PartyName>
      <PostalAddress>
        <StreetName>${escapeXml(d.supplier.address.street)}</StreetName>
        <CityName>${escapeXml(d.supplier.address.city)}</CityName>
        <PostalZone>${escapeXml(d.supplier.address.zip)}</PostalZone>
        <Country>
          <IdentificationCode>${escapeXml(d.supplier.address.country)}</IdentificationCode>
          <Name>${escapeXml(d.supplier.address.country === 'CZ' ? 'Česká republika' : d.supplier.address.country)}</Name>
        </Country>
      </PostalAddress>
      ${d.supplier.dic ? `<PartyTaxScheme>
        <CompanyID>${escapeXml(d.supplier.dic)}</CompanyID>
        <TaxScheme>VAT</TaxScheme>
      </PartyTaxScheme>` : ''}
      ${d.supplier.email || d.supplier.phone ? `<Contact>
        ${d.supplier.email ? `<ElectronicMail>${escapeXml(d.supplier.email)}</ElectronicMail>` : ''}
        ${d.supplier.phone ? `<Telephone>${escapeXml(d.supplier.phone)}</Telephone>` : ''}
      </Contact>` : ''}
    </Party>
  </AccountingSupplierParty>
  <AccountingCustomerParty>
    <Party>
      <PartyIdentification>
        <ID>${escapeXml(d.customer.ico ?? '')}</ID>
      </PartyIdentification>
      <PartyName>
        <Name>${escapeXml(d.customer.name)}</Name>
      </PartyName>
      ${d.customer.address ? `<PostalAddress>
        <StreetName>${escapeXml(d.customer.address.street ?? '')}</StreetName>
        <CityName>${escapeXml(d.customer.address.city ?? '')}</CityName>
        <PostalZone>${escapeXml(d.customer.address.zip ?? '')}</PostalZone>
        <Country>
          <IdentificationCode>${escapeXml(d.customer.address.country ?? 'CZ')}</IdentificationCode>
          <Name>${d.customer.address.country === 'SK' ? 'Slovensko' : 'Česká republika'}</Name>
        </Country>
      </PostalAddress>` : ''}
      ${d.customer.dic ? `<PartyTaxScheme>
        <CompanyID>${escapeXml(d.customer.dic)}</CompanyID>
        <TaxScheme>VAT</TaxScheme>
      </PartyTaxScheme>` : ''}
      ${d.customer.email ? `<Contact>
        <ElectronicMail>${escapeXml(d.customer.email)}</ElectronicMail>
      </Contact>` : ''}
    </Party>
  </AccountingCustomerParty>
  <InvoiceLines>
    ${d.lines.map((line, idx) => {
      const lineSubtotal = line.quantity * line.unitPriceWithoutVat;
      const lineVat = (lineSubtotal * line.vatRatePct) / 100;
      return `<InvoiceLine>
      <ID>${idx + 1}</ID>
      <InvoicedQuantity unitCode="ks">${fmt(line.quantity)}</InvoicedQuantity>
      <LineExtensionAmount>${fmt(lineSubtotal)}</LineExtensionAmount>
      <LineExtensionAmountTaxInclusive>${fmt(lineSubtotal + lineVat)}</LineExtensionAmountTaxInclusive>
      <LineExtensionTaxAmount>${fmt(lineVat)}</LineExtensionTaxAmount>
      <UnitPrice>${fmt(line.unitPriceWithoutVat)}</UnitPrice>
      <UnitPriceTaxInclusive>${fmt(line.unitPriceWithoutVat * (1 + line.vatRatePct / 100))}</UnitPriceTaxInclusive>
      <ClassifiedTaxCategory>
        <Percent>${fmt(line.vatRatePct)}</Percent>
        <VATCalculationMethod>0</VATCalculationMethod>
      </ClassifiedTaxCategory>
      <Item>
        <Description>${escapeXml(line.description)}</Description>
      </Item>
    </InvoiceLine>`;
    }).join('\n    ')}
  </InvoiceLines>
  <TaxTotal>
    ${[...vatBreakdown.entries()].map(([rate, { base, vat }]) => `<TaxSubTotal>
      <TaxableAmount>${fmt(base)}</TaxableAmount>
      <TaxAmount>${fmt(vat)}</TaxAmount>
      <TaxInclusiveAmount>${fmt(base + vat)}</TaxInclusiveAmount>
      <AlreadyClaimedTaxableAmount>0.00</AlreadyClaimedTaxableAmount>
      <AlreadyClaimedTaxAmount>0.00</AlreadyClaimedTaxAmount>
      <AlreadyClaimedTaxInclusiveAmount>0.00</AlreadyClaimedTaxInclusiveAmount>
      <DifferenceTaxableAmount>${fmt(base)}</DifferenceTaxableAmount>
      <DifferenceTaxAmount>${fmt(vat)}</DifferenceTaxAmount>
      <DifferenceTaxInclusiveAmount>${fmt(base + vat)}</DifferenceTaxInclusiveAmount>
      <TaxCategory>
        <Percent>${fmt(rate)}</Percent>
      </TaxCategory>
    </TaxSubTotal>`).join('\n    ')}
    <TaxAmount>${fmt(d.vatAmount)}</TaxAmount>
  </TaxTotal>
  <LegalMonetaryTotal>
    <TaxExclusiveAmount>${fmt(d.subtotal)}</TaxExclusiveAmount>
    <TaxInclusiveAmount>${fmt(d.total)}</TaxInclusiveAmount>
    <AlreadyClaimedTaxExclusiveAmount>0.00</AlreadyClaimedTaxExclusiveAmount>
    <AlreadyClaimedTaxInclusiveAmount>0.00</AlreadyClaimedTaxInclusiveAmount>
    <DifferenceTaxExclusiveAmount>${fmt(d.subtotal)}</DifferenceTaxExclusiveAmount>
    <DifferenceTaxInclusiveAmount>${fmt(d.total)}</DifferenceTaxInclusiveAmount>
    <PayableRoundingAmount>0.00</PayableRoundingAmount>
    <PaidDepositsAmount>0.00</PaidDepositsAmount>
    <PayableAmount>${fmt(d.total)}</PayableAmount>
  </LegalMonetaryTotal>
  <PaymentMeans>
    <Payment>
      <PaidAmount>${fmt(d.total)}</PaidAmount>
      <PaymentMeansCode>${paymentMeansCode(d.paymentMeans)}</PaymentMeansCode>
      <Details>
        ${d.supplier.bankAccount ? `<PaymentDueDate>${d.dueDate}</PaymentDueDate>
        <ID>${escapeXml(d.supplier.bankAccount)}</ID>` : ''}
        ${d.supplier.iban ? `<IBAN>${escapeXml(d.supplier.iban)}</IBAN>` : ''}
        ${d.supplier.bic ? `<BIC>${escapeXml(d.supplier.bic)}</BIC>` : ''}
        ${d.variableSymbol ? `<VariableSymbol>${escapeXml(d.variableSymbol)}</VariableSymbol>` : ''}
      </Details>
    </Payment>
  </PaymentMeans>
  <SupplementsList />
</Invoice>
`;

  // UTF-8 BOM pro Money S3 kompatibilitu
  return '﻿' + xml;
}
