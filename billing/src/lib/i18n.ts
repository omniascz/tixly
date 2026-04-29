/**
 * Invoice i18n — Multi-language labels for payout invoices.
 *
 * Ported from @acc/documents i18n.ts.
 * Supports: Czech (cs), Slovak (sk), English (en), German (de).
 */

export type InvoiceLocale = 'cs' | 'sk' | 'en' | 'de';

export interface InvoiceLabels {
  invoice: string;
  creditNote: string;

  invoiceNumber: string;
  issueDate: string;
  taxDate: string;
  dueDate: string;
  variableSymbol: string;

  supplier: string;
  customer: string;
  ico: string;
  dic: string;
  bankAccount: string;
  iban: string;

  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  vatRate: string;
  subtotal: string;
  vatAmount: string;
  total: string;

  subtotalLabel: string;
  vatLabel: string;
  totalLabel: string;

  notes: string;
  paymentMethod: string;
  bankTransfer: string;
  vatExempt: string;
  vatNotRegistered: string;

  period: string;
  platformFees: string;
  payoutInvoice: string;
}

export const INVOICE_LABELS: Record<InvoiceLocale, InvoiceLabels> = {
  cs: {
    invoice: 'FAKTURA',
    creditNote: 'DOBROPIS',
    invoiceNumber: 'Číslo faktury',
    issueDate: 'Datum vystavení',
    taxDate: 'Datum zdanitelného plnění',
    dueDate: 'Datum splatnosti',
    variableSymbol: 'Variabilní symbol',
    supplier: 'DODAVATEL',
    customer: 'ODBĚRATEL',
    ico: 'IČO',
    dic: 'DIČ',
    bankAccount: 'Číslo účtu',
    iban: 'IBAN',
    description: 'Popis',
    quantity: 'Množství',
    unit: 'Jedn.',
    unitPrice: 'Cena/j.',
    vatRate: 'DPH %',
    subtotal: 'Základ',
    vatAmount: 'DPH',
    total: 'Celkem',
    subtotalLabel: 'Základ daně',
    vatLabel: 'DPH celkem',
    totalLabel: 'CELKEM K ÚHRADĚ',
    notes: 'Poznámky',
    paymentMethod: 'Způsob úhrady',
    bankTransfer: 'Bankovním převodem',
    vatExempt: 'Osvobozeno od DPH',
    vatNotRegistered: 'Nejsem plátce DPH',
    period: 'Období',
    platformFees: 'Poplatky platformy',
    payoutInvoice: 'Faktura za poplatky platformy',
  },
  sk: {
    invoice: 'FAKTÚRA',
    creditNote: 'DOBROPIS',
    invoiceNumber: 'Číslo faktúry',
    issueDate: 'Dátum vystavenia',
    taxDate: 'Dátum zdaniteľného plnenia',
    dueDate: 'Dátum splatnosti',
    variableSymbol: 'Variabilný symbol',
    supplier: 'DODÁVATEĽ',
    customer: 'ODBERATEĽ',
    ico: 'IČO',
    dic: 'DIČ',
    bankAccount: 'Číslo účtu',
    iban: 'IBAN',
    description: 'Popis',
    quantity: 'Množstvo',
    unit: 'Jedn.',
    unitPrice: 'Cena/j.',
    vatRate: 'DPH %',
    subtotal: 'Základ',
    vatAmount: 'DPH',
    total: 'Spolu',
    subtotalLabel: 'Základ dane',
    vatLabel: 'DPH spolu',
    totalLabel: 'SPOLU K ÚHRADE',
    notes: 'Poznámky',
    paymentMethod: 'Spôsob úhrady',
    bankTransfer: 'Bankovým prevodom',
    vatExempt: 'Oslobodené od DPH',
    vatNotRegistered: 'Nie som platiteľom DPH',
    period: 'Obdobie',
    platformFees: 'Poplatky platformy',
    payoutInvoice: 'Faktúra za poplatky platformy',
  },
  en: {
    invoice: 'INVOICE',
    creditNote: 'CREDIT NOTE',
    invoiceNumber: 'Invoice Number',
    issueDate: 'Issue Date',
    taxDate: 'Tax Date',
    dueDate: 'Due Date',
    variableSymbol: 'Variable Symbol',
    supplier: 'SUPPLIER',
    customer: 'CUSTOMER',
    ico: 'Company ID',
    dic: 'VAT ID',
    bankAccount: 'Bank Account',
    iban: 'IBAN',
    description: 'Description',
    quantity: 'Qty',
    unit: 'Unit',
    unitPrice: 'Unit Price',
    vatRate: 'VAT %',
    subtotal: 'Subtotal',
    vatAmount: 'VAT',
    total: 'Total',
    subtotalLabel: 'Tax Base',
    vatLabel: 'Total VAT',
    totalLabel: 'TOTAL DUE',
    notes: 'Notes',
    paymentMethod: 'Payment Method',
    bankTransfer: 'Bank Transfer',
    vatExempt: 'VAT Exempt',
    vatNotRegistered: 'Not VAT registered',
    period: 'Period',
    platformFees: 'Platform fees',
    payoutInvoice: 'Platform fee invoice',
  },
  de: {
    invoice: 'RECHNUNG',
    creditNote: 'GUTSCHRIFT',
    invoiceNumber: 'Rechnungsnummer',
    issueDate: 'Ausstellungsdatum',
    taxDate: 'Leistungsdatum',
    dueDate: 'Fälligkeitsdatum',
    variableSymbol: 'Verwendungszweck',
    supplier: 'LIEFERANT',
    customer: 'AUFTRAGGEBER',
    ico: 'Steuer-Nr.',
    dic: 'USt-IdNr.',
    bankAccount: 'Bankverbindung',
    iban: 'IBAN',
    description: 'Beschreibung',
    quantity: 'Menge',
    unit: 'Einh.',
    unitPrice: 'Einzelpreis',
    vatRate: 'MwSt. %',
    subtotal: 'Nettobetrag',
    vatAmount: 'MwSt.',
    total: 'Gesamtbetrag',
    subtotalLabel: 'Steuerbasis',
    vatLabel: 'MwSt. gesamt',
    totalLabel: 'GESAMTBETRAG',
    notes: 'Anmerkungen',
    paymentMethod: 'Zahlungsart',
    bankTransfer: 'Überweisung',
    vatExempt: 'MwSt.-befreit',
    vatNotRegistered: 'Nicht MwSt.-pflichtig',
    period: 'Zeitraum',
    platformFees: 'Plattformgebühren',
    payoutInvoice: 'Rechnung für Plattformgebühren',
  },
};

export function getLabels(locale: InvoiceLocale): InvoiceLabels {
  return INVOICE_LABELS[locale];
}

/**
 * Format ISO date string (YYYY-MM-DD) by locale.
 * cs/sk: "15.1.2024", de: "15.01.2024", en: "01/15/2024"
 */
export function formatDate(dateStr: string, locale: InvoiceLocale): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;

  const [year, month, day] = parts;

  switch (locale) {
    case 'cs':
    case 'sk':
      return `${parseInt(day!, 10)}.${parseInt(month!, 10)}.${year}`;
    case 'de':
      return `${day}.${month}.${year}`;
    case 'en':
      return `${month}/${day}/${year}`;
    default:
      return dateStr;
  }
}

/**
 * Format haléře as Czech-style amount string.
 * 1234567 → "12 345,67 Kč"
 */
export function formatAmountHalire(halire: number, currency: string = 'CZK'): string {
  const czk = (halire / 100).toFixed(2);
  const [intPart, decPart] = czk.split('.');

  // Add thousands separator (non-breaking space)
  const formatted = (intPart ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  const result = `${formatted},${decPart ?? '00'}`;

  if (currency === 'CZK') return `${result}\u00A0Kč`;
  if (currency === 'EUR') return `${result}\u00A0€`;
  return `${result}\u00A0${currency}`;
}
