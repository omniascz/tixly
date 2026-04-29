// Anti-fraud heuristiky pro affiliate tracking.
//
// Cíl: zabránit zneužití affiliate programu — sebenákupy, click farming, bot kliky.
// Žádná z kontrol neběží v kritické cestě redirectu; používá se při recordConversion.

export interface FraudCheckInput {
  /** IP adresa kupujícího (při konverzi). */
  buyerIp: string | null;
  /** IP adresa, ze které se affiliate zaregistroval. */
  affiliateSignupIp: string | null;
  /** Čas posledního kliknutí na affiliate link před konverzí. */
  lastClickAt: Date | null;
  /** Čas platby / konverze. */
  conversionAt: Date;
  /** Počet různých affiliatů, které tato buyerIp "konvertovala" za posledních X hodin. */
  distinctAffiliatesFromIpRecent: number;
}

export interface FraudCheckResult {
  /** True = konverzi zamítni (nepřipisuj komisi). */
  rejected: boolean;
  /** True = konverzi přijmi, ale označ k manuálnímu review. */
  flagged: boolean;
  /** Lidsky čitelné důvody. */
  reasons: string[];
}

/** Minimální čas mezi kliknutím a koupí — pod tímto limitem je to skoro jistě script. */
export const MIN_CLICK_TO_CONVERSION_MS = 5000;

/** Kolik různých affiliate kódů z jedné IP za krátkou dobu flagne fraud. */
export const IP_AFFILIATE_FANOUT_THRESHOLD = 3;

export function evaluateFraud(input: FraudCheckInput): FraudCheckResult {
  const reasons: string[] = [];
  let rejected = false;
  let flagged = false;

  // 1) Self-purchase — kupující má stejnou IP jako affiliate při signupu.
  if (
    input.buyerIp &&
    input.affiliateSignupIp &&
    input.buyerIp === input.affiliateSignupIp
  ) {
    rejected = true;
    reasons.push('self_purchase_same_ip');
  }

  // 2) Click-to-conversion pod hranicí → scripted.
  if (input.lastClickAt) {
    const delta = input.conversionAt.getTime() - input.lastClickAt.getTime();
    if (delta >= 0 && delta < MIN_CLICK_TO_CONVERSION_MS) {
      rejected = true;
      reasons.push('click_to_conversion_too_fast');
    }
  }

  // 3) Stejná IP konvertuje moc různých affiliatů → click farm.
  if (input.distinctAffiliatesFromIpRecent >= IP_AFFILIATE_FANOUT_THRESHOLD) {
    flagged = true;
    reasons.push('ip_affiliate_fanout');
  }

  return { rejected, flagged, reasons };
}
