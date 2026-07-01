/**
 * CO₂ štítek dopravy na akci.
 *
 * Cestování diváků je 70–90 % emisí akce. Ukážeme u checkoutu odhad úspory,
 * když divák přijede vlakem místo autem — a nabídneme vlakový bundle.
 *
 * Emisní faktory (g CO₂ / os-km), EU průměr (zdroj: EEA / DEFRA řádové hodnoty):
 *   auto (1 os.)  ~ 170   (průměrné osobní auto, 1 cestující)
 *   auto (sdílené)~ 55    (4 cestující)
 *   vlak          ~ 35    (EU mix, elektrifikace)
 *   autobus       ~ 27
 */

export const EMISSION_G_PER_KM = {
  car_solo: 170,
  car_shared: 55,
  train: 35,
  bus: 27,
} as const;

export const DEFAULT_AVG_TRIP_KM = 40;

export interface Co2Label {
  avgTripKm: number;
  roundTripKm: number;
  carSoloKg: number;
  trainKg: number;
  savingKg: number;
  savingPct: number;
  message: string;
}

function kg(grams: number): number {
  return Math.round((grams / 1000) * 10) / 10;
}

/** Spočítá CO₂ štítek pro danou průměrnou jednosměrnou vzdálenost. */
export function computeCo2Label(avgTripKm?: number | null): Co2Label {
  const oneWay = avgTripKm && avgTripKm > 0 ? avgTripKm : DEFAULT_AVG_TRIP_KM;
  const roundTrip = oneWay * 2;
  const carSoloG = roundTrip * EMISSION_G_PER_KM.car_solo;
  const trainG = roundTrip * EMISSION_G_PER_KM.train;
  const savingG = Math.max(0, carSoloG - trainG);
  const savingPct = carSoloG > 0 ? Math.round((savingG / carSoloG) * 100) : 0;
  return {
    avgTripKm: oneWay,
    roundTripKm: roundTrip,
    carSoloKg: kg(carSoloG),
    trainKg: kg(trainG),
    savingKg: kg(savingG),
    savingPct,
    message: `Doprava bývá 70–90 % emisí akce. Vlakem místo autem ušetříš ~${kg(savingG)} kg CO₂ (−${savingPct} %) na cestu tam a zpět.`,
  };
}
