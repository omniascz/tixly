export type FulfillmentType = 'pickup_at_venue' | 'shipping' | 'digital';
export type ProductStatus = 'active' | 'paused' | 'archived';
export type OrderItemStatus = 'pending' | 'paid' | 'shipped' | 'delivered' | 'refunded' | 'cancelled';

export interface ProductVariantPublic {
  id: string;
  sku: string;
  name: string;
  price: number;          // base_price + price_modifier (haléře)
  currency: string;
  remainingQty: number | null;
  isLowStock: boolean;
  isAvailable: boolean;
  attributes: Record<string, string>;
}

export interface ProductPublic {
  id: string;
  eventId: string | null;
  name: string;
  description: string | null;
  basePrice: number;
  currency: string;
  fulfillment: FulfillmentType;
  imageUrls: string[];
  variants: ProductVariantPublic[];
}

export interface ProductOrganizer extends ProductPublic {
  organizerId: string;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ShippingAddress {
  name: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;   // ISO 3166-1 alpha-2, default 'CZ'
  phone?: string;
}

// Internal DB row types
export interface ProductRow {
  id: string;
  event_id: string | null;
  organizer_id: string;
  name: string;
  description: string | null;
  base_price: number;
  currency: string;
  fulfillment: FulfillmentType;
  image_urls: string[];
  metadata: Record<string, unknown>;
  status: ProductStatus;
  created_at: string;
  updated_at: string;
}

export interface VariantRow {
  id: string;
  product_id: string;
  sku: string;
  name: string;
  price_modifier: number;
  total_qty: number | null;
  sold_count: number;
  reserved_count: number;
  low_threshold: number;
  attributes: Record<string, string>;
  is_active: boolean;
  created_at: string;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  product_id: string;
  variant_id: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  fulfillment: FulfillmentType;
  status: OrderItemStatus;
  shipping_address: ShippingAddress | null;
  tracking_number: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

// Service input types
export interface ReserveItemInput {
  variantId: string;
  quantity: number;
  shippingAddress?: ShippingAddress;
}

export interface CreateProductInput {
  name: string;
  description?: string;
  basePrice: number;
  currency?: string;
  fulfillment: FulfillmentType;
  imageUrls?: string[];
  metadata?: Record<string, unknown>;
  variants: CreateVariantInput[];
}

export interface CreateVariantInput {
  sku: string;
  name: string;
  priceModifier?: number;
  totalQty?: number;
  lowThreshold?: number;
  attributes?: Record<string, string>;
}

export interface UpdateProductInput {
  name?: string;
  description?: string;
  basePrice?: number;
  imageUrls?: string[];
  status?: ProductStatus;
  metadata?: Record<string, unknown>;
  variants?: UpdateVariantInput[];
}

export interface UpdateVariantInput {
  id?: string;         // existing variant
  sku: string;
  name: string;
  priceModifier?: number;
  totalQty?: number;
  lowThreshold?: number;
  attributes?: Record<string, string>;
}

export interface InventoryVariant {
  variantId: string;
  sku: string;
  name: string;
  totalQty: number | null;
  soldCount: number;
  reservedCount: number;
  available: number | null;
  isLowStock: boolean;
}

export interface InventoryReport {
  productId: string;
  variants: InventoryVariant[];
}
