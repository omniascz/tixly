/**
 * ISDOC 6.0.2 — český standard elektronické faktury. Kolo 7 (C-54): generuje se z jednotného modelu
 * TaxDocument (stejného jako PDF) a výstup se v testech validuje proti OFICIÁLNÍMU XSD
 * (src/lib/accounting/xsd/isdoc-invoice-6.0.2.xsd, zdroj https://isdoc.cz/6.0.2/xsd/, sha256 fb5de36f…).
 * Předchozí generátor XSD neprošel (UUID mimo vzor, chybné pořadí prvků adresy a plateb).
 *
 *   DocumentType 1  daňový doklad (faktura) — u neplátce VATApplicable=false
 *   DocumentType 2  opravný daňový doklad (dobropis) — záporné částky + OriginalDocumentReference
 */
import { NON_PAYER_NOTE, type TaxDocParty, type TaxDocument } from './tax-document';

const esc = (s: string | number | null | undefined): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Haléře → desetinné číslo se 2 místy (ISDOC očekává částky v jednotkách měny). */
const amt = (minor: number): string => (minor / 100).toFixed(2);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function party(p: TaxDocParty, vatPayer: boolean): string {
  const a = p.address;
  const street = a?.street ?? '';
  // ISDOC dělí ulici a číslo popisné; staré adresy jsou jedním řetězcem → číslo oddělíme, je-li na konci.
  const m = street.match(/^(.*?)[\s,]+(\d+[a-zA-Z]?(?:\/\d+[a-zA-Z]?)?)$/);
  const streetName = m ? m[1] : street;
  const building = m ? m[2] : '';
  const taxScheme = vatPayer && p.dic
    ? `<PartyTaxScheme><CompanyID>${esc(p.dic)}</CompanyID><TaxScheme>VAT</TaxScheme></PartyTaxScheme>`
    : '';
  const contact = p.email ? `<Contact><ElectronicMail>${esc(p.email)}</ElectronicMail></Contact>` : '';
  return `<Party>
      <PartyIdentification><ID>${esc(p.ico ?? '')}</ID></PartyIdentification>
      <PartyName><Name>${esc(p.name)}</Name></PartyName>
      <PostalAddress>
        <StreetName>${esc(streetName)}</StreetName>
        <BuildingNumber>${esc(building)}</BuildingNumber>
        <CityName>${esc(a?.city ?? '')}</CityName>
        <PostalZone>${esc(a?.zip ?? '')}</PostalZone>
        <Country><IdentificationCode>${esc(a?.country ?? 'CZ')}</IdentificationCode><Name></Name></Country>
      </PostalAddress>
      ${taxScheme}
      ${contact}
    </Party>`;
}

export function buildIsdocXml(d: TaxDocument): string {
  if (!UUID_RE.test(d.id)) throw new Error('ISDOC vyžaduje UUID dokladu');
  const vatPayer = d.supplier.vatPayer;
  const docType = d.docType === 'credit_note' ? 2 : 1;
  const cur = d.currency;

  const lines = d.items
    .map((it, i) => {
      const vl = vatPayer ? d.vatLines.find((l) => l.vatRateCode === it.vatRateCode) : undefined;
      const base = vl ? vl.baseMinor : it.totalMinor;
      const tax = vl ? vl.vatMinor : 0;
      const pct = vatPayer ? (it.ratePct ?? 0) : 0;
      const qty = it.quantity || 1;
      return `<InvoiceLine>
      <ID>${i + 1}</ID>
      <InvoicedQuantity unitCode="ks">${qty}</InvoicedQuantity>
      <LineExtensionAmount>${amt(base)}</LineExtensionAmount>
      <LineExtensionAmountTaxInclusive>${amt(it.totalMinor)}</LineExtensionAmountTaxInclusive>
      <LineExtensionTaxAmount>${amt(tax)}</LineExtensionTaxAmount>
      <UnitPrice>${amt(Math.round(base / qty))}</UnitPrice>
      <UnitPriceTaxInclusive>${amt(Math.round(it.totalMinor / qty))}</UnitPriceTaxInclusive>
      <ClassifiedTaxCategory>
        <Percent>${pct}</Percent>
        <VATCalculationMethod>1</VATCalculationMethod>
        <VATApplicable>${vatPayer ? 'true' : 'false'}</VATApplicable>
      </ClassifiedTaxCategory>
      <Item><Description>${esc(it.description)}</Description></Item>
    </InvoiceLine>`;
    })
    .join('\n    ');

  const subTotals = (vatPayer ? d.vatLines : [{ ratePct: 0, baseMinor: d.totalMinor, vatMinor: 0, totalMinor: d.totalMinor }])
    .map(
      (l) => `<TaxSubTotal>
      <TaxableAmount>${amt(l.baseMinor)}</TaxableAmount>
      <TaxAmount>${amt(l.vatMinor)}</TaxAmount>
      <TaxInclusiveAmount>${amt(l.totalMinor)}</TaxInclusiveAmount>
      <AlreadyClaimedTaxableAmount>0.00</AlreadyClaimedTaxableAmount>
      <AlreadyClaimedTaxAmount>0.00</AlreadyClaimedTaxAmount>
      <AlreadyClaimedTaxInclusiveAmount>0.00</AlreadyClaimedTaxInclusiveAmount>
      <DifferenceTaxableAmount>${amt(l.baseMinor)}</DifferenceTaxableAmount>
      <DifferenceTaxAmount>${amt(l.vatMinor)}</DifferenceTaxAmount>
      <DifferenceTaxInclusiveAmount>${amt(l.totalMinor)}</DifferenceTaxInclusiveAmount>
      <TaxCategory><Percent>${l.ratePct}</Percent><VATApplicable>${vatPayer ? 'true' : 'false'}</VATApplicable></TaxCategory>
    </TaxSubTotal>`,
    )
    .join('\n    ');

  const base = vatPayer ? d.vatLines.reduce((a, l) => a + l.baseMinor, 0) : d.totalMinor;
  const tax = vatPayer ? d.vatLines.reduce((a, l) => a + l.vatMinor, 0) : 0;
  const note = vatPayer ? '' : `<Note>${esc(NON_PAYER_NOTE)}</Note>`;
  const original = d.correctedDocument
    ? `<OriginalDocumentReferences>
    <OriginalDocumentReference id="${esc(d.correctedDocument.id)}">
      <ID>${esc(d.correctedDocument.number)}</ID>
      <IssueDate>${esc(d.correctedDocument.issueDate)}</IssueDate>
      <UUID>${esc(d.correctedDocument.id.toUpperCase())}</UUID>
    </OriginalDocumentReference>
  </OriginalDocumentReferences>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.2">
  <DocumentType>${docType}</DocumentType>
  <ID>${esc(d.number)}</ID>
  <UUID>${esc(d.id.toUpperCase())}</UUID>
  <IssuingSystem>Tixly</IssuingSystem>
  <IssueDate>${esc(d.issueDate)}</IssueDate>
  <TaxPointDate>${esc(d.taxableSupplyDate)}</TaxPointDate>
  <VATApplicable>${vatPayer ? 'true' : 'false'}</VATApplicable>
  <ElectronicPossibilityAgreementReference></ElectronicPossibilityAgreementReference>
  ${note}
  <LocalCurrencyCode>${esc(cur)}</LocalCurrencyCode>
  <CurrRate>1</CurrRate>
  <RefCurrRate>1</RefCurrRate>
  <AccountingSupplierParty>
    ${party(d.supplier, vatPayer)}
  </AccountingSupplierParty>
  <AccountingCustomerParty>
    ${party(d.customer, !!d.customer.dic)}
  </AccountingCustomerParty>
  ${original}
  <InvoiceLines>
    ${lines}
  </InvoiceLines>
  <TaxTotal>
    ${subTotals}
    <TaxAmount>${amt(tax)}</TaxAmount>
  </TaxTotal>
  <LegalMonetaryTotal>
    <TaxExclusiveAmount>${amt(base)}</TaxExclusiveAmount>
    <TaxInclusiveAmount>${amt(d.totalMinor)}</TaxInclusiveAmount>
    <AlreadyClaimedTaxExclusiveAmount>0.00</AlreadyClaimedTaxExclusiveAmount>
    <AlreadyClaimedTaxInclusiveAmount>0.00</AlreadyClaimedTaxInclusiveAmount>
    <DifferenceTaxExclusiveAmount>${amt(base)}</DifferenceTaxExclusiveAmount>
    <DifferenceTaxInclusiveAmount>${amt(d.totalMinor)}</DifferenceTaxInclusiveAmount>
    <PaidDepositsAmount>0.00</PaidDepositsAmount>
    <PayableAmount>${amt(d.paid && d.docType === 'invoice' ? 0 : d.totalMinor)}</PayableAmount>
  </LegalMonetaryTotal>
</Invoice>
`;
}
