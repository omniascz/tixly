// =============================================================================
// Sustainability reporting — Feature #67
//
// Odhad CO₂ emisí akce (doprava návštěvníků, energie venue),
// waste-reduction doporučení. ESG diferenciátor pro B2B klienty.
//
// SCHEMA: sustainability.* (migration 127)
// =============================================================================

export interface SustainabilityMetrics {
  id: string;
  eventId: string;
  attendeeCount: number;
  venueEnergyKwh: number;
  co2TransportTonnes: number;      // doprava na akci
  co2VenueEnergyTonnes: number;    // energie venue
  co2TotalTonnes: number;
  carbonOffsetRecommendations: string[];
  wasteReductionTips: string[];
  digitalSignageEnabled: boolean;
  treeEquivalent: number;          // kolik stromů by potřebovalo na offset
  calculatedAt: string;
}

export interface CalculateSustainabilityInput {
  eventId: string;
  attendeeCount: number;
  venueEnergyKwh: number;
  averageDistanceKm?: number;      // průměrná vzdálenost návštěvníků
  venueType?: 'outdoor' | 'indoor_heated' | 'indoor_climate';
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

interface MetricsRow {
  id: string;
  event_id: string;
  attendee_count: number;
  venue_energy_kwh: number;
  co2_transport_tonnes: number;
  co2_venue_energy_tonnes: number;
  co2_total_tonnes: number;
  carbon_offset_recommendations: string[];
  waste_reduction_tips: string[];
  digital_signage_enabled: boolean;
  tree_equivalent: number;
  calculated_at: string;
}

function mapMetrics(row: MetricsRow): SustainabilityMetrics {
  return {
    id: row.id,
    eventId: row.event_id,
    attendeeCount: row.attendee_count,
    venueEnergyKwh: row.venue_energy_kwh,
    co2TransportTonnes: row.co2_transport_tonnes,
    co2VenueEnergyTonnes: row.co2_venue_energy_tonnes,
    co2TotalTonnes: row.co2_total_tonnes,
    carbonOffsetRecommendations: row.carbon_offset_recommendations,
    wasteReductionTips: row.waste_reduction_tips,
    digitalSignageEnabled: row.digital_signage_enabled,
    treeEquivalent: row.tree_equivalent,
    calculatedAt: row.calculated_at,
  };
}

/**
 * Calculate CO₂ emissions pro event.
 * Transport: avg distance × attendees × 0.21 kg CO₂/km (auto průměr)
 * Energy: venue_kwh × 0.4 kg CO₂/kWh (CZ grid mix)
 */
export async function calculateSustainability(
  input: CalculateSustainabilityInput,
  db: DbAdapter,
): Promise<SustainabilityMetrics> {
  const avgDistanceKm = input.averageDistanceKm ?? 25;  // default CZ průměr
  const venueType = input.venueType ?? 'indoor_climate';

  // Transport CO₂: return journey
  const co2TransportKg = input.attendeeCount * avgDistanceKm * 2 * 0.21;
  const co2TransportTonnes = co2TransportKg / 1000;

  // Energy CO₂: CZ grid average
  const co2VenueEnergyKg = input.venueEnergyKwh * 0.4;
  const co2VenueEnergyTonnes = co2VenueEnergyKg / 1000;

  const co2TotalTonnes = co2TransportTonnes + co2VenueEnergyTonnes;

  // Recommendations
  const carbonOffsetRecommendations = [
    `Offset ${co2TotalTonnes.toFixed(1)} tun CO₂ skrze carbon credit program (https://atmosfair.de/)`,
    'Partnerství s Plocha - 1 vstupenka = 1 strom vysazený',
    'Nabídnout vlakový balíček místo auta pro vandalitiny akce',
  ];

  const wasteReductionTips = [
    'Použít vratné kelímky/tácky (Zieh-Punkt model)',
    'Zákaz jednoúčelového plastu - bambusové brčka, papírové tašky',
    'Composting bio-odpadu na místě (partnership s lokální školou)',
    'Digitální merchandise místo tisknutého (program ke stažení)',
  ];

  // Trees needed: ~1 tuna CO₂ = 1 strom za ~50 let
  const treeEquivalent = Math.ceil(co2TotalTonnes);

  const rows = await db.query<MetricsRow>(
    `INSERT INTO sustainability.event_metrics
       (event_id, attendee_count, venue_energy_kwh, co2_transport_tonnes,
        co2_venue_energy_tonnes, co2_total_tonnes, carbon_offset_recommendations,
        waste_reduction_tips, tree_equivalent)
     VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8::text[], $9)
     RETURNING *`,
    [
      input.eventId,
      input.attendeeCount,
      input.venueEnergyKwh,
      co2TransportTonnes,
      co2VenueEnergyTonnes,
      co2TotalTonnes,
      JSON.stringify(carbonOffsetRecommendations),
      JSON.stringify(wasteReductionTips),
      treeEquivalent,
    ],
  );
  if (!rows[0]) throw new Error('INTERNAL_ERROR: metrics insert failed');
  return mapMetrics(rows[0]);
}

/**
 * Vrátí sustainability metriky pro event.
 */
export async function getSustainabilityMetrics(
  eventId: string,
  db: DbAdapter,
): Promise<SustainabilityMetrics | null> {
  const rows = await db.query<MetricsRow>(
    `SELECT * FROM sustainability.event_metrics WHERE event_id = $1`,
    [eventId],
  );
  return rows[0] ? mapMetrics(rows[0]) : null;
}

/**
 * Enablenu digital signage (paperless event).
 */
export async function enableDigitalSignage(
  eventId: string,
  db: DbAdapter,
): Promise<SustainabilityMetrics> {
  const rows = await db.query<MetricsRow>(
    `UPDATE sustainability.event_metrics
     SET digital_signage_enabled = true
     WHERE event_id = $1
     RETURNING *`,
    [eventId],
  );
  if (!rows[0]) throw new Error('NOT_FOUND: Metrics not found');
  return mapMetrics(rows[0]);
}
