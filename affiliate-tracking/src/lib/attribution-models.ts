// Multi-touch attribution models pro affiliate tracking.
//
// Každý model přiděluje podíly (shares) konverze mezi touchpointy tak, aby suma = 1.
// Použití: při konverzi načti všechny touchpointy uživatele v cookie window,
// spusť attributeCommission a pro každého affiliata s share > 0 vytvoř commission row.

export type AttributionModel =
  | 'last_click'
  | 'first_click'
  | 'linear'
  | 'time_decay'
  | 'position_based';

export interface TouchPoint {
  affiliateId: string;
  affiliateCode: string;
  clickedAt: Date;
}

export interface AttributionResult {
  /** Per-affiliate share 0-1, sums to 1 (pokud touchPoints není prázdné). */
  shares: Record<string, number>;
}

/** Half-life v milisekundách — po 7 dnech má klik poloviční váhu. */
const TIME_DECAY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Přidělí podíly konverze mezi touchpointy podle zvoleného modelu.
 *
 * Důležité:
 * - Pokud více touchpointů patří stejnému affiliatovi, jejich podíly se sečtou.
 * - Výsledkové shares vždy sumují k 1.0 (± floating point epsilon), nebo k 0 pokud není žádný touchpoint.
 * - touchPoints se interně seřadí podle clickedAt vzestupně (nemutuje vstup).
 */
export function attributeCommission(
  touchPoints: TouchPoint[],
  orderTime: Date,
  model: AttributionModel,
): AttributionResult {
  if (touchPoints.length === 0) return { shares: {} };

  const sorted = [...touchPoints].sort(
    (a, b) => a.clickedAt.getTime() - b.clickedAt.getTime(),
  );
  const n = sorted.length;

  // weights[i] = váha i-tého touchpointu před normalizací
  const weights = new Array<number>(n).fill(0);

  switch (model) {
    case 'last_click':
      weights[n - 1] = 1;
      break;

    case 'first_click':
      weights[0] = 1;
      break;

    case 'linear':
      for (let i = 0; i < n; i++) weights[i] = 1 / n;
      break;

    case 'time_decay': {
      // Exponenciální útlum podle vzdálenosti od orderTime.
      // weight = 0.5 ^ (age / half_life)
      for (let i = 0; i < n; i++) {
        const age = orderTime.getTime() - sorted[i].clickedAt.getTime();
        const normalizedAge = Math.max(0, age);
        weights[i] = Math.pow(0.5, normalizedAge / TIME_DECAY_HALF_LIFE_MS);
      }
      break;
    }

    case 'position_based': {
      // first 40 %, last 40 %, middle dohromady 20 %.
      if (n === 1) {
        weights[0] = 1;
      } else if (n === 2) {
        // Bez mezer — rozděl 50/50 mezi first a last.
        weights[0] = 0.5;
        weights[n - 1] = 0.5;
      } else {
        weights[0] = 0.4;
        weights[n - 1] = 0.4;
        const middleShare = 0.2 / (n - 2);
        for (let i = 1; i < n - 1; i++) weights[i] = middleShare;
      }
      break;
    }

    default: {
      const exhaustive: never = model;
      throw new Error(`Neznámý attribution model: ${String(exhaustive)}`);
    }
  }

  // Normalizuj na sumu 1 (kvůli time_decay, kde suma != 1).
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    // Fallback — všechny klíče v minulosti a útlum je 0. Degraduj na last_click.
    weights[n - 1] = 1;
  }
  const norm = weights.reduce((a, b) => a + b, 0);

  const shares: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const aff = sorted[i].affiliateId;
    shares[aff] = (shares[aff] ?? 0) + weights[i] / norm;
  }

  return { shares };
}

/**
 * Rozdělí celkovou komisi (v haléřích) mezi affiliaty podle shares tak,
 * aby součet přidělených částek byl přesně totalCommission (žádné zaokrouhlovací ztráty).
 * Největší zbytek (largest remainder method) dostane první affiliate v pořadí.
 */
export function splitCommissionByShares(
  totalCommission: number,
  shares: Record<string, number>,
): Record<string, number> {
  const keys = Object.keys(shares);
  if (keys.length === 0) return {};

  const raw: Record<string, number> = {};
  let assigned = 0;
  for (const k of keys) {
    const amt = Math.floor(totalCommission * shares[k]);
    raw[k] = amt;
    assigned += amt;
  }
  // Zbytek přiděl prvnímu klíči (deterministicky — iterace keys podle vložení).
  const remainder = totalCommission - assigned;
  if (remainder > 0 && keys.length > 0) {
    raw[keys[0]] += remainder;
  }
  return raw;
}
