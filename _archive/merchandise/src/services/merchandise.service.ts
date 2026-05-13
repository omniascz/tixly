import { ServiceDeps } from '../lib/service-container';
import { MerchandiseError } from '../lib/merchandise-errors';
import {
  FulfillmentType,
  ProductPublic,
  ProductOrganizer,
  ProductVariantPublic,
  ProductRow,
  VariantRow,
  OrderItemRow,
  ReserveItemInput,
  CreateProductInput,
  UpdateProductInput,
  InventoryReport,
  OrderItemStatus,
} from '../types/merchandise';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toVariantPublic(v: VariantRow, basePrice: number, currency: string): ProductVariantPublic {
  const price = basePrice + v.price_modifier;
  const remaining =
    v.total_qty === null ? null : v.total_qty - v.sold_count - v.reserved_count;
  const isAvailable = remaining === null ? true : remaining > 0;
  const isLowStock =
    remaining !== null && remaining <= v.low_threshold && remaining > 0;
  return {
    id: v.id,
    sku: v.sku,
    name: v.name,
    price,
    currency,
    remainingQty: remaining,
    isLowStock,
    isAvailable,
    attributes: v.attributes as Record<string, string>,
  };
}

function toProductPublic(p: ProductRow, variants: VariantRow[]): ProductPublic {
  const activeVariants = variants
    .filter((v) => v.is_active)
    .filter((v) => {
      if (v.total_qty === null) return true;
      return v.sold_count + v.reserved_count < v.total_qty;
    })
    .map((v) => toVariantPublic(v, p.base_price, p.currency));

  return {
    id: p.id,
    eventId: p.event_id,
    name: p.name,
    description: p.description,
    basePrice: p.base_price,
    currency: p.currency,
    fulfillment: p.fulfillment,
    imageUrls: p.image_urls,
    variants: activeVariants,
  };
}

function toProductOrganizer(p: ProductRow, variants: VariantRow[]): ProductOrganizer {
  const pub = toProductPublic(p, variants);
  // For organizer view include ALL active variants (even sold out)
  const allActiveVariants = variants
    .filter((v) => v.is_active)
    .map((v) => toVariantPublic(v, p.base_price, p.currency));

  return {
    ...pub,
    variants: allActiveVariants,
    organizerId: p.organizer_id,
    status: p.status,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

// ─── Public: getProductsForEvent ─────────────────────────────────────────────

export async function getProductsForEvent(
  eventId: string,
  fulfillmentFilter: FulfillmentType | undefined,
  deps: ServiceDeps,
): Promise<ProductPublic[]> {
  const { db } = deps;

  let sql = `
    SELECT * FROM merchandise.products
    WHERE event_id = $1 AND status = 'active'
  `;
  const params: unknown[] = [eventId];

  if (fulfillmentFilter) {
    sql += ` AND fulfillment = $2`;
    params.push(fulfillmentFilter);
  }

  const products = await db.query<ProductRow>(sql, params);

  if (products.length === 0) return [];

  const productIds = products.map((p) => p.id);
  const placeholders = productIds.map((_, i) => `$${i + 1}`).join(', ');
  const variants = await db.query<VariantRow>(
    `SELECT * FROM merchandise.product_variants WHERE product_id IN (${placeholders}) AND is_active = true`,
    productIds,
  );

  const variantsByProduct = new Map<string, VariantRow[]>();
  for (const v of variants) {
    const arr = variantsByProduct.get(v.product_id) ?? [];
    arr.push(v);
    variantsByProduct.set(v.product_id, arr);
  }

  return products.map((p) => toProductPublic(p, variantsByProduct.get(p.id) ?? []));
}

// ─── Public: reserveMerchandise ───────────────────────────────────────────────

export async function reserveMerchandise(
  orderId: string,
  items: ReserveItemInput[],
  idempotencyKey: string,
  deps: ServiceDeps,
): Promise<OrderItemRow[]> {
  const { db, kafka } = deps;

  // Idempotency check (outside transaction — fast path)
  const existing = await db.query<OrderItemRow>(
    `SELECT * FROM merchandise.order_items WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  if (existing.length > 0) {
    throw new MerchandiseError('DUPLICATE_ORDER', `Order with idempotency key ${idempotencyKey} already exists`);
  }

  const createdItems = await db.transaction(async (tx) => {
    const result: OrderItemRow[] = [];

    for (const item of items) {
      // Lock variant row for update
      const variantRows = await tx.query<VariantRow>(
        `SELECT pv.*, p.base_price, p.fulfillment, p.currency
         FROM merchandise.product_variants pv
         JOIN merchandise.products p ON p.id = pv.product_id
         WHERE pv.id = $1 AND pv.is_active = true
         FOR UPDATE`,
        [item.variantId],
      );

      if (variantRows.length === 0) {
        throw new MerchandiseError('VARIANT_NOT_FOUND', `Variant ${item.variantId} not found`);
      }

      const variant = variantRows[0] as VariantRow & {
        base_price: number;
        fulfillment: FulfillmentType;
        currency: string;
      };

      // Check availability
      if (variant.total_qty !== null) {
        const available = variant.total_qty - variant.sold_count - variant.reserved_count;
        if (available <= 0) {
          throw new MerchandiseError('VARIANT_SOLD_OUT', `Variant ${item.variantId} is sold out`);
        }
        if (item.quantity > available) {
          throw new MerchandiseError(
            'INSUFFICIENT_STOCK',
            `Only ${available} units available for variant ${item.variantId}`,
          );
        }
      }

      // Shipping address validation
      if (variant.fulfillment === 'shipping' && !item.shippingAddress) {
        throw new MerchandiseError(
          'SHIPPING_REQUIRED',
          `Shipping address required for variant ${item.variantId}`,
        );
      }

      // Reserve stock
      await tx.execute(
        `UPDATE merchandise.product_variants
         SET reserved_count = reserved_count + $1
         WHERE id = $2`,
        [item.quantity, item.variantId],
      );

      const unitPrice = variant.base_price + variant.price_modifier;
      const totalPrice = unitPrice * item.quantity;

      // Insert order item
      const orderItemRows = await tx.query<OrderItemRow>(
        `INSERT INTO merchandise.order_items
           (order_id, product_id, variant_id, quantity, unit_price, total_price,
            fulfillment, status, shipping_address, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9)
         RETURNING *`,
        [
          orderId,
          variant.product_id,
          item.variantId,
          item.quantity,
          unitPrice,
          totalPrice,
          variant.fulfillment,
          item.shippingAddress ? JSON.stringify(item.shippingAddress) : null,
          idempotencyKey,
        ],
      );

      result.push(orderItemRows[0]);
    }

    return result;
  });

  // Kafka: merchandise.reserved
  await kafka.send('merchandise.reserved', {
    eventType: 'merchandise.reserved',
    orderId,
    items: createdItems.map((oi) => ({
      variantId: oi.variant_id,
      productId: oi.product_id,
      quantity: oi.quantity,
      fulfillment: oi.fulfillment,
    })),
    timestamp: new Date().toISOString(),
  });

  // Kafka: merchandise.inventory.low — check after reservation
  for (const item of items) {
    const variantRows = await db.query<VariantRow>(
      `SELECT * FROM merchandise.product_variants WHERE id = $1`,
      [item.variantId],
    );
    if (variantRows.length > 0) {
      const v = variantRows[0];
      if (v.total_qty !== null) {
        const available = v.total_qty - v.sold_count - v.reserved_count;
        if (available <= v.low_threshold) {
          await kafka.send('merchandise.inventory.low', {
            eventType: 'merchandise.inventory.low',
            variantId: v.id,
            productId: v.product_id,
            available,
            lowThreshold: v.low_threshold,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  }

  return createdItems;
}

// ─── Public: cancelMerchandiseItem ───────────────────────────────────────────

export async function cancelMerchandiseItem(
  orderId: string,
  orderItemId: string,
  userId: string,
  deps: ServiceDeps,
): Promise<void> {
  const { db } = deps;

  const rows = await db.query<OrderItemRow>(
    `SELECT * FROM merchandise.order_items WHERE id = $1`,
    [orderItemId],
  );

  if (rows.length === 0) {
    throw new MerchandiseError('ORDER_ITEM_NOT_FOUND', `Order item ${orderItemId} not found`);
  }

  const item = rows[0];

  // Anti-enumeration: if order doesn't match, return 404
  if (item.order_id !== orderId) {
    throw new MerchandiseError('ORDER_ITEM_NOT_FOUND', `Order item ${orderItemId} not found`);
  }

  if (item.status !== 'pending') {
    throw new MerchandiseError(
      'CANCEL_NOT_ALLOWED',
      `Cannot cancel item with status '${item.status}'. Only pending items can be cancelled.`,
    );
  }

  await db.transaction(async (tx) => {
    // Decrement reserved count
    await tx.execute(
      `UPDATE merchandise.product_variants
       SET reserved_count = reserved_count - $1
       WHERE id = $2`,
      [item.quantity, item.variant_id],
    );

    // Set status to cancelled
    await tx.execute(
      `UPDATE merchandise.order_items SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [orderItemId],
    );
  });
}

// ─── Organizer: createProduct ────────────────────────────────────────────────

export async function createProduct(
  eventId: string,
  organizerId: string,
  input: CreateProductInput,
  deps: ServiceDeps,
): Promise<ProductOrganizer> {
  const { db } = deps;

  return db.transaction(async (tx) => {
    const productRows = await tx.query<ProductRow>(
      `INSERT INTO merchandise.products
         (event_id, organizer_id, name, description, base_price, currency,
          fulfillment, image_urls, metadata, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
       RETURNING *`,
      [
        eventId,
        organizerId,
        input.name,
        input.description ?? null,
        input.basePrice,
        input.currency ?? 'CZK',
        input.fulfillment,
        JSON.stringify(input.imageUrls ?? []),
        JSON.stringify(input.metadata ?? {}),
      ],
    );

    const product = productRows[0];

    const variants: VariantRow[] = [];
    for (const v of input.variants) {
      const variantRows = await tx.query<VariantRow>(
        `INSERT INTO merchandise.product_variants
           (product_id, sku, name, price_modifier, total_qty, low_threshold, attributes, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)
         RETURNING *`,
        [
          product.id,
          v.sku,
          v.name,
          v.priceModifier ?? 0,
          v.totalQty ?? null,
          v.lowThreshold ?? 3,
          JSON.stringify(v.attributes ?? {}),
        ],
      );
      variants.push(variantRows[0]);
    }

    return toProductOrganizer(product, variants);
  });
}

// ─── Organizer: updateProduct ────────────────────────────────────────────────

export async function updateProduct(
  productId: string,
  organizerId: string,
  input: UpdateProductInput,
  deps: ServiceDeps,
): Promise<ProductOrganizer> {
  const { db } = deps;

  return db.transaction(async (tx) => {
    // Verify ownership
    const existing = await tx.query<ProductRow>(
      `SELECT * FROM merchandise.products WHERE id = $1 FOR UPDATE`,
      [productId],
    );

    if (existing.length === 0 || existing[0].organizer_id !== organizerId) {
      throw new MerchandiseError('UNAUTHORIZED', `Product not found`);
    }

    const product = existing[0];

    // Build SET clause dynamically
    const setClauses: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (input.name !== undefined) {
      setClauses.push(`name = $${paramIdx++}`);
      params.push(input.name);
    }
    if (input.description !== undefined) {
      setClauses.push(`description = $${paramIdx++}`);
      params.push(input.description);
    }
    if (input.basePrice !== undefined) {
      setClauses.push(`base_price = $${paramIdx++}`);
      params.push(input.basePrice);
    }
    if (input.imageUrls !== undefined) {
      setClauses.push(`image_urls = $${paramIdx++}`);
      params.push(JSON.stringify(input.imageUrls));
    }
    if (input.status !== undefined) {
      setClauses.push(`status = $${paramIdx++}`);
      params.push(input.status);
    }
    if (input.metadata !== undefined) {
      setClauses.push(`metadata = $${paramIdx++}`);
      params.push(JSON.stringify(input.metadata));
    }

    params.push(productId);

    const updatedProductRows = await tx.query<ProductRow>(
      `UPDATE merchandise.products SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      params,
    );

    const updatedProduct = updatedProductRows[0];

    // Handle variants diff
    let finalVariants: VariantRow[] = [];

    if (input.variants !== undefined) {
      // Get existing variants
      const existingVariants = await tx.query<VariantRow>(
        `SELECT * FROM merchandise.product_variants WHERE product_id = $1`,
        [productId],
      );

      const incomingIds = new Set(
        input.variants.filter((v) => v.id !== undefined).map((v) => v.id as string),
      );

      // Deactivate variants not in the incoming list
      for (const ev of existingVariants) {
        if (!incomingIds.has(ev.id)) {
          await tx.execute(
            `UPDATE merchandise.product_variants SET is_active = false WHERE id = $1`,
            [ev.id],
          );
        }
      }

      // Upsert variants
      for (const v of input.variants) {
        if (v.id) {
          // Update existing
          const rows = await tx.query<VariantRow>(
            `UPDATE merchandise.product_variants
             SET sku = $1, name = $2, price_modifier = $3, total_qty = $4,
                 low_threshold = $5, attributes = $6, is_active = true
             WHERE id = $7 AND product_id = $8
             RETURNING *`,
            [
              v.sku,
              v.name,
              v.priceModifier ?? 0,
              v.totalQty ?? null,
              v.lowThreshold ?? 3,
              JSON.stringify(v.attributes ?? {}),
              v.id,
              productId,
            ],
          );
          if (rows.length > 0) finalVariants.push(rows[0]);
        } else {
          // Insert new
          const rows = await tx.query<VariantRow>(
            `INSERT INTO merchandise.product_variants
               (product_id, sku, name, price_modifier, total_qty, low_threshold, attributes, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, true)
             RETURNING *`,
            [
              productId,
              v.sku,
              v.name,
              v.priceModifier ?? 0,
              v.totalQty ?? null,
              v.lowThreshold ?? 3,
              JSON.stringify(v.attributes ?? {}),
            ],
          );
          finalVariants.push(rows[0]);
        }
      }
    } else {
      // No variant changes — fetch all active
      finalVariants = await tx.query<VariantRow>(
        `SELECT * FROM merchandise.product_variants WHERE product_id = $1 AND is_active = true`,
        [productId],
      );
    }

    return toProductOrganizer(updatedProduct ?? product, finalVariants);
  });
}

// ─── Organizer: archiveProduct ───────────────────────────────────────────────

export async function archiveProduct(
  productId: string,
  organizerId: string,
  deps: ServiceDeps,
): Promise<void> {
  const { db } = deps;

  const rows = await db.query<ProductRow>(
    `SELECT * FROM merchandise.products WHERE id = $1`,
    [productId],
  );

  if (rows.length === 0 || rows[0].organizer_id !== organizerId) {
    throw new MerchandiseError('UNAUTHORIZED', `Product not found`);
  }

  await db.execute(
    `UPDATE merchandise.products SET status = 'archived', updated_at = NOW() WHERE id = $1`,
    [productId],
  );
}

// ─── Organizer: getProductsForOrganizer ──────────────────────────────────────

export async function getProductsForOrganizer(
  eventId: string,
  organizerId: string,
  deps: ServiceDeps,
): Promise<ProductOrganizer[]> {
  const { db } = deps;

  const products = await db.query<ProductRow>(
    `SELECT * FROM merchandise.products WHERE event_id = $1 AND organizer_id = $2 ORDER BY created_at DESC`,
    [eventId, organizerId],
  );

  if (products.length === 0) return [];

  const productIds = products.map((p) => p.id);
  const placeholders = productIds.map((_, i) => `$${i + 1}`).join(', ');
  const variants = await db.query<VariantRow>(
    `SELECT * FROM merchandise.product_variants WHERE product_id IN (${placeholders})`,
    productIds,
  );

  const variantsByProduct = new Map<string, VariantRow[]>();
  for (const v of variants) {
    const arr = variantsByProduct.get(v.product_id) ?? [];
    arr.push(v);
    variantsByProduct.set(v.product_id, arr);
  }

  return products.map((p) => toProductOrganizer(p, variantsByProduct.get(p.id) ?? []));
}

// ─── Organizer: getInventory ──────────────────────────────────────────────────

export async function getInventory(
  productId: string,
  organizerId: string,
  deps: ServiceDeps,
): Promise<InventoryReport> {
  const { db } = deps;

  const products = await db.query<ProductRow>(
    `SELECT * FROM merchandise.products WHERE id = $1`,
    [productId],
  );

  if (products.length === 0 || products[0].organizer_id !== organizerId) {
    throw new MerchandiseError('UNAUTHORIZED', `Product not found`);
  }

  const variants = await db.query<VariantRow>(
    `SELECT * FROM merchandise.product_variants WHERE product_id = $1 ORDER BY created_at`,
    [productId],
  );

  return {
    productId,
    variants: variants.map((v) => {
      const available = v.total_qty === null ? null : v.total_qty - v.sold_count - v.reserved_count;
      const isLowStock = available !== null && available <= v.low_threshold;
      return {
        variantId: v.id,
        sku: v.sku,
        name: v.name,
        totalQty: v.total_qty,
        soldCount: v.sold_count,
        reservedCount: v.reserved_count,
        available,
        isLowStock,
      };
    }),
  };
}

// ─── Kafka consumer handlers ──────────────────────────────────────────────────

export async function handleOrderPaid(
  orderId: string,
  deps: ServiceDeps,
): Promise<void> {
  const { db, kafka } = deps;

  const items = await db.query<OrderItemRow>(
    `SELECT * FROM merchandise.order_items WHERE order_id = $1 AND status = 'pending'`,
    [orderId],
  );

  if (items.length === 0) return;

  await db.transaction(async (tx) => {
    for (const item of items) {
      // Move reserved → sold
      await tx.execute(
        `UPDATE merchandise.product_variants
         SET reserved_count = reserved_count - $1,
             sold_count = sold_count + $1
         WHERE id = $2`,
        [item.quantity, item.variant_id],
      );

      await tx.execute(
        `UPDATE merchandise.order_items SET status = 'paid', updated_at = NOW() WHERE id = $1`,
        [item.id],
      );
    }
  });

  await kafka.send('merchandise.paid', {
    eventType: 'merchandise.paid',
    orderId,
    items: items.map((i) => ({
      orderItemId: i.id,
      variantId: i.variant_id,
      productId: i.product_id,
      quantity: i.quantity,
      fulfillment: i.fulfillment,
      shippingAddress: i.shipping_address,
    })),
    timestamp: new Date().toISOString(),
  });
}

export async function handleOrderRefunded(
  orderId: string,
  deps: ServiceDeps,
): Promise<void> {
  const { db, kafka } = deps;

  const items = await db.query<OrderItemRow>(
    `SELECT * FROM merchandise.order_items WHERE order_id = $1 AND status = 'paid'`,
    [orderId],
  );

  if (items.length === 0) return;

  await db.transaction(async (tx) => {
    for (const item of items) {
      // Revert sold_count
      await tx.execute(
        `UPDATE merchandise.product_variants
         SET sold_count = sold_count - $1
         WHERE id = $2`,
        [item.quantity, item.variant_id],
      );

      await tx.execute(
        `UPDATE merchandise.order_items SET status = 'refunded', updated_at = NOW() WHERE id = $1`,
        [item.id],
      );
    }
  });

  await kafka.send('merchandise.refunded', {
    eventType: 'merchandise.refunded',
    orderId,
    items: items.map((i) => ({
      orderItemId: i.id,
      variantId: i.variant_id,
      productId: i.product_id,
      quantity: i.quantity,
    })),
    timestamp: new Date().toISOString(),
  });
}

// Re-export status type for use in routes
export type { OrderItemStatus };
