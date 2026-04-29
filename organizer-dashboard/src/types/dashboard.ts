// =============================================================================
// Organizer CRM Dashboard — Type Definitions
// Platforma: Tixly | Datum: 2026-04-03
// =============================================================================

// ---------------------------------------------------------------------------
// Sdílené enumy
// ---------------------------------------------------------------------------

export type PricingPhase = "early_bird" | "regular" | "late" | "door";

export type EventStatus = "draft" | "published" | "cancelled" | "completed";

export type ResaleListingStatus = "active" | "sold" | "cancelled" | "expired";

// ---------------------------------------------------------------------------
// SalesOverview — souhrnné metriky prodejů organizátora / akce
// ---------------------------------------------------------------------------

export interface SalesOverview {
  /** Celkové tržby v CZK (paid orders) */
  totalRevenue: number;
  /** Celkový počet prodaných vstupenek */
  totalTicketsSold: number;
  /** Celkový počet uhrazených objednávek */
  totalOrders: number;
  /** Průměrná hodnota objednávky v CZK */
  avgOrderValue: number;
  /** Míra refundací (0–1, např. 0.03 = 3 %) */
  refundRate: number;
  /** Objem resale transakcí v CZK (prodané resale listings) */
  resaleVolume: number;
  /** Počet vstupenek prodaných přes resale */
  resaleTicketCount: number;
  // ---- pro trend šipky ----
  /** Předchozí perioda — tržby (porovnání trendu) */
  previousRevenue?: number;
  /** Předchozí perioda — vstupenky */
  previousTicketsSold?: number;
}

// ---------------------------------------------------------------------------
// SalesByPeriod — prodeje agregované dle granularity pro timeline graf
// ---------------------------------------------------------------------------

export type TimelineGranularity = "hour" | "day" | "week";

export interface SalesByPeriod {
  /** Začátek časového okna (truncated dle granularity) */
  timestamp: Date;
  /** Počet prodaných vstupenek v daném okně */
  count: number;
  /** Tržby v CZK v daném okně */
  revenue: number;
  /** Prodejní fáze platná pro toto okno */
  phase: PricingPhase;
}

// ---------------------------------------------------------------------------
// ZoneCapacity — stav kapacity per zóna / sekce
// ---------------------------------------------------------------------------

export interface ZoneCapacity {
  /** Označení zóny (A, B, VIP, Pit, Standing, …) */
  zone: string;
  /** Označení sekce (nepovinné, pro seated events) */
  section: string | null;
  /** Celkový počet míst / vstupenek v zóně */
  totalSeats: number;
  /** Počet prodaných míst */
  soldSeats: number;
  /** Počet dočasně uzamčených míst (probíhající checkout) */
  lockedSeats: number;
  /** Počet volných míst (totalSeats - soldSeats - lockedSeats) */
  availableSeats: number;
  /** Procento obsazenosti 0–100 (zaokrouhleno na 1 des. místo) */
  fillPercent: number;
}

// ---------------------------------------------------------------------------
// DemographicData — GDPR-compliant agregovaná demografika (žádné PII)
// ---------------------------------------------------------------------------

export interface CityDemographic {
  city: string;
  count: number;
}

export interface AgeDemographic {
  /** Věková skupina, např. "18–24", "25–34", "35–44", "45+" */
  ageGroup: string;
  count: number;
}

export interface DemographicData {
  /** Top 10 měst dle počtu zákazníků */
  topCities: CityDemographic[];
  /** Věkové skupiny (dostupné pouze pokud uživatelé mají DOB) */
  ageGroups: AgeDemographic[];
  /** Počet zákazníků, kteří koupili vstupenky na 2+ akcí organizátora */
  returningCustomers: number;
  /** Celkový počet unikátních zákazníků */
  totalUniqueCustomers: number;
}

// ---------------------------------------------------------------------------
// HeatmapCell — buňka heatmapy prodejů (hodina × den týdne)
// ---------------------------------------------------------------------------

export interface HeatmapCell {
  /** Den týdne: 0 = neděle, 1 = pondělí, … 6 = sobota (EXTRACT(DOW)) */
  dayOfWeek: number;
  /** Hodina dne: 0–23 */
  hour: number;
  /** Absolutní počet prodejů v tomto slotu */
  salesCount: number;
  /** Normalizovaná intenzita 0.0–1.0 (salesCount / MAX(salesCount)) */
  intensity: number;
}

// ---------------------------------------------------------------------------
// ResaleStat — statistiky resale marketplace pro event
// ---------------------------------------------------------------------------

export interface ResaleStat {
  /** Celkový počet listingů (všechny stavy) */
  totalListings: number;
  /** Počet aktivních (neprodaných, nezrušených) listingů */
  activeListings: number;
  /** Počet prodaných listingů */
  soldListings: number;
  /** Průměrná sleva oproti originální ceně (0–1, např. 0.15 = 15 %) */
  avgDiscount: number;
  /** Celkové tržby z resale prodejů (ask_price × sold) */
  resaleRevenue: number;
  /** Provize platformy celkem (resaleRevenue × commissionRate) */
  platformCommission: number;
}

// ---------------------------------------------------------------------------
// ResaleSettings — nastavení resale per event
// ---------------------------------------------------------------------------

export interface ResaleSettings {
  eventId: string;
  /** Zda je resale povoleno */
  resaleAllowed: boolean;
  /**
   * Provize platformy v procentech (0–5).
   * Uloženo jako desetinné číslo, zobrazováno jako procenta.
   */
  resaleCommissionRate: number;
  /** Počet aktuálně aktivních listingů (read-only, pro validaci) */
  activeListingsCount: number;
}

// ---------------------------------------------------------------------------
// OrganizerEvent — event rozšířený o prodejní statistiky
// ---------------------------------------------------------------------------

export interface OrganizerEvent {
  // ---- základní data z catalog.events ----
  id: string;
  organizerId: string;
  venueId: string;
  title: string;
  description: string | null;
  category: string | null;
  dateStart: Date;
  dateEnd: Date | null;
  status: EventStatus;
  saleStartAt: Date | null;
  saleEndAt: Date | null;
  resaleAllowed: boolean;
  createdAt: Date;
  updatedAt: Date;

  // ---- prodejní statistiky (JOIN přes orders) ----
  /** Celkové tržby za tuto akci */
  totalRevenue: number;
  /** Počet prodaných vstupenek */
  ticketsSold: number;
  /** Celková kapacita (součet všech ticket_types.total_qty) */
  totalCapacity: number;
  /** Procento prodeje kapacity (0–100) */
  soldPercent: number;
  /** Tržby z resale */
  resaleRevenue: number;
}

// ---------------------------------------------------------------------------
// API Response wrappers
// ---------------------------------------------------------------------------

export interface ApiSuccessResponse<T> {
  data: T;
  /** ISO timestamp vygenerování odpovědi */
  generatedAt: string;
  /** Zda data pocházejí z Redis cache */
  cached: boolean;
}

export interface ApiErrorResponse {
  error: string;
  code: string;
  statusCode: number;
}

// ---------------------------------------------------------------------------
// Query params helper typy
// ---------------------------------------------------------------------------

export interface SalesTimelineParams {
  organizerId: string;
  eventId: string;
  granularity: TimelineGranularity;
  from: string; // ISO 8601
  to: string;   // ISO 8601
}

export interface DashboardFilterParams {
  organizerId: string;
  eventId?: string;
}
