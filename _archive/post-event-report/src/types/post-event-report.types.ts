export interface PostEventReport {
  id: string;
  event_id: string;
  event_name: string;
  event_date: Date;
  generated_at: Date;
  status: 'generating' | 'ready' | 'failed';

  // Prodeje
  sales: {
    total_tickets_sold: number;
    total_tickets_capacity: number;
    sellthrough_pct: number;
    total_revenue: number;
    total_fees_collected: number;
    avg_ticket_price: number;
    tickets_by_type: Array<{ name: string; sold: number; revenue: number }>;
    tickets_by_zone: Array<{ zone: string; sold: number; capacity: number | null }>;
    sales_by_day: Array<{ date: string; tickets: number; revenue: number }>;
    first_sale_at: Date | null;
    last_sale_at: Date | null;
  };

  // Návštěvnost
  attendance: {
    total_checked_in: number;
    no_show_count: number;
    no_show_pct: number;
    peak_entry_time: string | null;
    avg_entry_time: string | null;
    will_call_pickups: number;
    guest_list_total: number;
    guest_list_checked_in: number;
  };

  // Finance
  finance: {
    gross_revenue: number;
    platform_fees: number;
    organizer_payout: number;
    resale_volume: number;
    resale_commission: number;
    refunds_total: number;
    promo_discounts_total: number;
    installments_pending: number;
  };

  // Marketing
  marketing: {
    referral_sales_count: number;
    referral_revenue: number;
    promo_codes_used: number;
    top_promo_codes: Array<{ code: string; uses: number; discount_total: number }>;
    affiliate_sales: number;
    affiliate_revenue: number;
  };

  // Resale
  resale: {
    total_listings: number;
    total_sold: number;
    avg_resale_price: number;
    max_resale_price: number;
    resale_sellthrough_pct: number;
  };
}

export interface PostEventReportSummary {
  event_id: string;
  event_name: string;
  event_date: Date;
  sellthrough_pct: number;
  gross_revenue: number;
  total_checked_in: number;
  status: 'generating' | 'ready' | 'failed';
  generated_at: Date | null;
}
