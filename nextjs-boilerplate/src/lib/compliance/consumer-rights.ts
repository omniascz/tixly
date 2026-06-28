/**
 * Consumer Rights Directive (EU 2019/2161 — Omnibus) + UK Consumer Rights Act 2015
 *
 * Key obligations for event ticketing:
 *
 * 1. Right of Withdrawal (CRD Art. 9 + 16(l)):
 *    Tickets for cultural events (concerts, theatre, sports) are EXEMPT from the
 *    14-day right of withdrawal. BUT the seller MUST inform the consumer BEFORE
 *    purchase that the right does not apply (Art. 16 last para.).
 *
 * 2. Pre-contractual information (CRD Art. 6):
 *    - Total price incl. all fees and taxes before payment
 *    - Trader identity (name, address, phone, email)
 *    - Complaint handling / dispute resolution
 *    - Delivery method (electronic tickets)
 *
 * 3. UK Consumer Rights Act 2015 (s.49 + s.62):
 *    - Services performed with reasonable care and skill
 *    - Contract terms must be fair and transparent
 *    - Unfair terms are not binding (s.62)
 *
 * 4. No hidden charges (CRD Art. 6(1)(e)):
 *    Price breakdown must be shown before checkout confirmation.
 *
 * 5. Personalised pricing disclosure (Omnibus Art. 2(1)(m)):
 *    If price is personalised (profiling), buyer must be informed.
 */

export interface WithdrawalRightsNotice {
  /** ISO 639-1 locale */
  locale: string;
  /** Short notice to show at checkout before payment */
  short: string;
  /** Full legal notice for order confirmation email */
  full: string;
  /** Whether the exemption applies (always true for event tickets) */
  exemptionApplies: boolean;
}

const NOTICES: Record<string, WithdrawalRightsNotice> = {
  cs: {
    locale: 'cs',
    exemptionApplies: true,
    short: 'Na vstupenky na kulturní a sportovní akce se nevztahuje právo na odstoupení od smlouvy do 14 dnů (§ 1837 písm. j) OZ).',
    full: `Právo na odstoupení od smlouvy: Spotřebitel bere na vědomí, že vstupenky na kulturní, sportovní a zábavní akce s pevným datem konání jsou ze zákona vyloučeny z práva na odstoupení od smlouvy uzavřené distančním způsobem (§ 1837 písm. j) zákona č. 89/2012 Sb., občanský zákoník). Zakoupené vstupenky nelze vrátit, ledaže je akce zrušena nebo přesunuta pořadatelem.`,
  },
  sk: {
    locale: 'sk',
    exemptionApplies: true,
    short: 'Na vstupenky na kultúrne a športové podujatia sa nevzťahuje právo na odstúpenie od zmluvy v lehote 14 dní (§ 7 ods. 6 ZOS).',
    full: `Právo na odstúpenie od zmluvy: Spotrebiteľ berie na vedomie, že vstupenky na kultúrne, športové a zábavné podujatia s pevným termínom konania sú zo zákona vylúčené z práva na odstúpenie od zmluvy uzavretej na diaľku (§ 7 ods. 6 písm. k) zákona č. 102/2014 Z. z.). Zakúpené vstupenky nemožno vrátiť, pokiaľ organizátor podujatie nezruší alebo nepreloží.`,
  },
  en: {
    locale: 'en',
    exemptionApplies: true,
    short: 'Event tickets are exempt from the 14-day right of withdrawal under EU Consumer Rights Directive Art. 16(l) and UK Consumer Rights Act 2015.',
    full: `Right of Withdrawal: By purchasing event tickets you acknowledge that tickets for cultural, sports, and entertainment events with a fixed date are exempt from the standard 14-day right of withdrawal under EU Consumer Rights Directive 2011/83/EU Article 16(l) (as amended by Directive 2019/2161) and UK Consumer Rights Act 2015 Schedule 3 para. 5. Tickets are non-refundable except where the event is cancelled or rescheduled by the organiser.`,
  },
  de: {
    locale: 'de',
    exemptionApplies: true,
    short: 'Für Veranstaltungstickets gilt kein 14-tägiges Widerrufsrecht (§ 312g Abs. 2 Nr. 9 BGB).',
    full: `Widerrufsrecht: Der Verbraucher nimmt zur Kenntnis, dass für Tickets zu Kultur-, Sport- und Unterhaltungsveranstaltungen mit festem Termin gemäß § 312g Abs. 2 Nr. 9 BGB kein Widerrufsrecht besteht. Erworbene Tickets können nicht zurückgegeben werden, es sei denn, die Veranstaltung wird vom Veranstalter abgesagt oder verlegt.`,
  },
  pl: {
    locale: 'pl',
    exemptionApplies: true,
    short: 'Bilety na imprezy kulturalne i sportowe nie podlegają 14-dniowemu prawu odstąpienia od umowy (art. 38 pkt 12 UPK).',
    full: `Prawo odstąpienia od umowy: Konsument przyjmuje do wiadomości, że bilety na imprezy kulturalne, sportowe i rozrywkowe z ustalonym terminem są wyłączone z 14-dniowego prawa odstąpienia od umowy zawartej na odległość (art. 38 pkt 12 ustawy z dnia 30 maja 2014 r. o prawach konsumenta). Zakupione bilety nie podlegają zwrotowi, chyba że impreza zostanie odwołana lub zmieniona przez organizatora.`,
  },
};

export function getWithdrawalRightsNotice(locale: string): WithdrawalRightsNotice {
  return NOTICES[locale] ?? NOTICES['en'];
}

/** Pre-contractual information required by CRD Art. 6 */
export interface PreContractualInfo {
  traderName: string;
  traderAddress: string;
  traderPhone?: string;
  traderEmail: string;
  /** ISO 3166-1 alpha-2 */
  traderCountry: string;
  complaintUrl: string;
  odrUrl: string;
  deliveryMethod: string;
}

export function getPlatformPreContractualInfo(locale: string): PreContractualInfo {
  return {
    traderName:    'Tixly s.r.o.',
    traderAddress: 'Praha, Czech Republic',
    traderEmail:   'support@tixly.cz',
    traderCountry: 'CZ',
    complaintUrl:  '/legal/complaints',
    odrUrl:        'https://ec.europa.eu/consumers/odr/',
    deliveryMethod: locale === 'cs' || locale === 'sk'
      ? 'Elektronické vstupenky — doručení na e-mail a ke stažení v aplikaci'
      : 'Electronic tickets — delivered by email and available in-app',
  };
}

/**
 * Builds the price breakdown object required by CRD Art. 6(1)(e).
 * All amounts in halíře (minor currency units).
 */
export interface PriceBreakdown {
  subtotal: number;        // face value of tickets
  serviceFee: number;      // platform service fee
  vatAmount: number;       // VAT on service fee
  vatRatePct: number;      // e.g. 21
  isReverseCharge: boolean;
  total: number;
  currency: string;
}

export function buildPriceBreakdown(args: {
  subtotal: number;
  serviceFeeRate: number;  // basis points
  vatRatePct: number;
  isReverseCharge: boolean;
  currency: string;
}): PriceBreakdown {
  const serviceFee = Math.round((args.subtotal * args.serviceFeeRate) / 10000);
  const vatAmount = args.isReverseCharge ? 0 : Math.round((serviceFee * args.vatRatePct) / 100);
  return {
    subtotal: args.subtotal,
    serviceFee,
    vatAmount,
    vatRatePct: args.vatRatePct,
    isReverseCharge: args.isReverseCharge,
    total: args.subtotal + serviceFee + vatAmount,
    currency: args.currency,
  };
}
