// Typy sdílené mezi widget-loader.ts a stránkou uvnitř iframe.

export interface WidgetConfig {
  eventId: string;
  /** Výška v px, kterou widget zabírá — posíláme přes postMessage */
  height: number;
}

export interface WidgetEvent {
  name: string;
  date: string;          // ISO 8601
  venueName: string;
  city: string;
  currency: string;      // ISO 4217
  locale: string;        // BCP 47
  ticketTypes: WidgetTicketType[];
  /** Přímý odkaz na stránku akce na tixly.cz */
  checkoutUrl: string;
}

export interface WidgetTicketType {
  id: string;
  name: string;
  price: number;         // INTEGER haléře
  available: number;     // počet dostupných
  maxPerOrder: number;
  phase: 'early_bird' | 'regular' | 'late' | 'door' | 'sold_out';
}

// ---------------------------------------------------------------------------
// postMessage protokol (widget → hostující stránka)
// ---------------------------------------------------------------------------

export type WidgetMessage =
  | { type: 'TIXLY_RESIZE'; height: number }
  | { type: 'TIXLY_CHECKOUT_STARTED'; eventId: string }
  | { type: 'TIXLY_ORDER_COMPLETE'; orderId: string }
  | { type: 'TIXLY_READY' };
