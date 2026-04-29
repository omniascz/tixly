// social-channel-adapters.ts — Social commerce channel adapters
// TikTok Shop, Google Things to Do, Instagram Shopping.
// Each implements the ChannelAdapter interface from channel-distribution.service.ts,
// mapping Tixly inventory to the platform-specific API format.
//
// Design: real API clients are injected so adapters are fully testable.
// All prices in halíře internally; converted to platform currency in adapter.

import type { ChannelAdapter } from './channel-distribution.service';

// ---------------------------------------------------------------------------
// HTTP client interface (injected)
// ---------------------------------------------------------------------------

export interface HttpClient {
  post<T>(url: string, body: unknown, headers: Record<string, string>): Promise<T>;
  put<T>(url: string, body: unknown, headers: Record<string, string>): Promise<T>;
  get<T>(url: string, headers: Record<string, string>): Promise<T>;
}

// ---------------------------------------------------------------------------
// TikTok Shop adapter
// ---------------------------------------------------------------------------
// API: TikTok Shop Open Platform — Product API
// Docs reference: shop.tiktok.com/open/api/product
// Auth: app_key + access_token per shop

export interface TikTokShopConfig {
  appKey: string;
  appSecret: string;
  shopId: string;
  accessToken: string;
  apiBase?: string;
}

interface TikTokProductResponse {
  data: { product_id: string };
  code: number;
  message: string;
}

interface TikTokOrdersResponse {
  data: {
    order_list: Array<{ item_list: Array<{ quantity: number }> }>;
    total_count: number;
  };
}

export function createTikTokShopAdapter(
  config: TikTokShopConfig,
  http: HttpClient,
): ChannelAdapter {
  const base = config.apiBase ?? 'https://open-api.tiktokglobalshop.com';
  const headers = () => ({
    'x-tts-access-token': config.accessToken,
    'Content-Type': 'application/json',
  });

  return {
    async pushAvailability(externalEventId, availableQty, priceHalire, meta) {
      const priceKc = priceHalire !== null ? (priceHalire / 100).toFixed(2) : '0.00';
      const body = {
        product_name: meta.eventName ?? 'Tixly Ticket',
        description: meta.eventDescription ?? '',
        category_id: '601299', // Entertainment > Events
        skus: [
          {
            stock_info_list: [{ warehouse_id: config.shopId, available_stock: availableQty }],
            seller_sku: meta.ticketTypeId ?? externalEventId ?? 'default',
            original_price: priceKc,
            sale_price: priceKc,
          },
        ],
        external_product_id: meta.eventId as string,
      };

      if (externalEventId) {
        // Update existing product
        await http.put<TikTokProductResponse>(
          `${base}/api/products/${externalEventId}`,
          body,
          headers(),
        );
        return { externalEventId };
      }

      const resp = await http.post<TikTokProductResponse>(
        `${base}/api/products`,
        body,
        headers(),
      );
      return { externalEventId: resp.data.product_id };
    },

    async pullSoldQty(externalEventId) {
      const resp = await http.get<TikTokOrdersResponse>(
        `${base}/api/orders?product_id=${externalEventId}&status=COMPLETED`,
        headers(),
      );
      return resp.data.order_list.reduce(
        (sum, order) => sum + order.item_list.reduce((s, item) => s + item.quantity, 0),
        0,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Google Things to Do adapter
// ---------------------------------------------------------------------------
// API: Google Things to Do (GTTD) — Feeds via Google Merchant Center
// Docs reference: developers.google.com/things-to-do
// Auth: OAuth2 service account

export interface GoogleThingsToDoConfig {
  merchantId: string;
  serviceAccountToken: string;
  apiBase?: string;
}

interface GttdProductResponse {
  name: string;
  offerId: string;
}

interface GttdReportResponse {
  rows: Array<{ metrics: { clicks: number; conversions: number } }>;
}

export function createGoogleThingsToDoAdapter(
  config: GoogleThingsToDoConfig,
  http: HttpClient,
): ChannelAdapter {
  const base =
    config.apiBase ?? `https://shoppingcontent.googleapis.com/content/v2.1/${config.merchantId}`;
  const headers = () => ({
    Authorization: `Bearer ${config.serviceAccountToken}`,
    'Content-Type': 'application/json',
  });

  return {
    async pushAvailability(externalEventId, availableQty, priceHalire, meta) {
      const priceKc = priceHalire !== null ? (priceHalire / 100).toFixed(2) : '0.00';
      const offerId = externalEventId ?? `tixly-${meta.eventId}`;

      const body = {
        offerId,
        title: meta.eventName ?? 'Tixly Ticket',
        description: meta.eventDescription ?? '',
        link: meta.eventUrl ?? 'https://tixly.cz',
        imageLink: meta.eventImageUrl ?? '',
        contentLanguage: 'cs',
        targetCountry: 'CZ',
        channel: 'online',
        availability: availableQty > 0 ? 'in stock' : 'out of stock',
        condition: 'new',
        price: { value: priceKc, currency: 'CZK' },
        productTypes: ['Entertainment > Events > Tickets'],
        // GTTD extension
        additionalProductTypes: ['things_to_do'],
        customLabel0: meta.eventId as string,
        customLabel1: meta.eventDate as string,
        customLabel2: meta.venue as string,
      };

      await http.post<GttdProductResponse>(
        `${base}/products`,
        { products: [body] },
        headers(),
      );

      return { externalEventId: offerId };
    },

    async pullSoldQty(externalEventId) {
      // GTTD doesn't have direct order API — use Merchant Center conversion reports
      // In production this would use Google Ads API conversions
      const resp = await http.post<GttdReportResponse>(
        `${base}/reports/search`,
        {
          query: `SELECT metrics.conversions FROM MerchantPerformanceView WHERE segments.offer_id = '${externalEventId}'`,
        },
        headers(),
      );
      const row = resp.rows?.[0];
      return Math.round(row?.metrics?.conversions ?? 0);
    },
  };
}

// ---------------------------------------------------------------------------
// Instagram Shopping / Facebook Shops adapter
// ---------------------------------------------------------------------------
// API: Facebook Commerce Platform — Catalog API
// Docs reference: developers.facebook.com/docs/commerce-platform
// Auth: access_token (page/catalog level)

export interface InstagramShoppingConfig {
  catalogId: string;
  accessToken: string;
  apiVersion?: string;
  apiBase?: string;
}

interface FbProductResponse {
  id: string;
}

interface FbOrdersResponse {
  data: Array<{ channel: string; buyer_details: object; selected_item: { quantity: number } }>;
  paging?: { cursors: { after: string } };
}

export function createInstagramShoppingAdapter(
  config: InstagramShoppingConfig,
  http: HttpClient,
): ChannelAdapter {
  const version = config.apiVersion ?? 'v19.0';
  const base = config.apiBase ?? `https://graph.facebook.com/${version}`;
  const headers = () => ({
    'Content-Type': 'application/json',
  });

  function withToken(url: string): string {
    return `${url}${url.includes('?') ? '&' : '?'}access_token=${config.accessToken}`;
  }

  return {
    async pushAvailability(externalEventId, availableQty, priceHalire, meta) {
      const priceKc = priceHalire !== null ? (priceHalire / 100).toFixed(2) : '0.00';
      const body = {
        retailer_id: externalEventId ?? `tixly-${meta.eventId}`,
        name: meta.eventName ?? 'Tixly Ticket',
        description: meta.eventDescription ?? '',
        url: meta.eventUrl ?? 'https://tixly.cz',
        image_url: meta.eventImageUrl ?? '',
        price: `${priceKc} CZK`,
        currency: 'CZK',
        availability: availableQty > 0 ? 'in stock' : 'out of stock',
        condition: 'new',
        category: 'Tickets and Experiences',
        custom_data: {
          event_id: meta.eventId,
          event_date: meta.eventDate,
          venue: meta.venue,
        },
      };

      const retailerId = externalEventId ?? `tixly-${meta.eventId}`;

      if (externalEventId) {
        await http.post<FbProductResponse>(
          withToken(`${base}/${externalEventId}`),
          body,
          headers(),
        );
        return { externalEventId };
      }

      const resp = await http.post<FbProductResponse>(
        withToken(`${base}/${config.catalogId}/products`),
        body,
        headers(),
      );
      return { externalEventId: resp.id };
    },

    async pullSoldQty(externalEventId) {
      // Facebook Commerce orders API
      const resp = await http.get<FbOrdersResponse>(
        withToken(`${base}/${config.catalogId}/orders?retailer_product_id=${externalEventId}&state=FB_PROCESSING,CREATED,IN_PROGRESS,COMPLETED`),
        headers(),
      );
      return resp.data.reduce((sum, order) => sum + (order.selected_item?.quantity ?? 1), 0);
    },
  };
}

// ---------------------------------------------------------------------------
// Channel adapter registry
// ---------------------------------------------------------------------------

export type SocialChannelId = 'tiktok_shop' | 'google_things_to_do' | 'instagram_shopping';

export const SOCIAL_CHANNEL_IDS: SocialChannelId[] = [
  'tiktok_shop',
  'google_things_to_do',
  'instagram_shopping',
];

export function isSocialChannel(channelId: string): channelId is SocialChannelId {
  return SOCIAL_CHANNEL_IDS.includes(channelId as SocialChannelId);
}
