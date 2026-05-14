import { notFound } from 'next/navigation';
import { Pool } from 'pg';
import { ThermalReceipt } from './ThermalReceipt';

interface OrderData {
  id: string;
  total_amount: number;
  currency: string;
  paid_at: string | null;
  payment_provider: string;
  buyer_email: string;
  buyer_name: string | null;
  event_title: string;
  event_date_start: string | null;
  venue_name: string | null;
  promoter_name: string;
  promoter_ico: string | null;
  promoter_dic: string | null;
}

interface Item {
  ticket_type_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

async function fetchOrder(orderId: string): Promise<{ order: OrderData; items: Item[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return null;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const o = await pool.query<OrderData>(
      `SELECT o.id, o.total_amount, o.currency, o.paid_at, o.payment_provider,
              u.email AS buyer_email, u.name AS buyer_name,
              e.title AS event_title, e.date_start AS event_date_start,
              v.name AS venue_name,
              p.name AS promoter_name, p.ico AS promoter_ico, p.dic AS promoter_dic
       FROM orders.orders o
       JOIN identity.users u ON u.id = o.user_id
       LEFT JOIN catalog.events e ON e.id = o.event_id
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       LEFT JOIN platform.promoters p ON p.id = e.promoter_id
       WHERE o.id = $1`,
      [orderId],
    );
    if (o.rows.length === 0) return null;

    const items = await pool.query<Item>(
      `SELECT tt.name AS ticket_type_name, oi.quantity, oi.unit_price, oi.total_price
       FROM orders.order_items oi
       JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
       WHERE oi.order_id = $1
       ORDER BY oi.created_at`,
      [orderId],
    );
    return { order: o.rows[0]!, items: items.rows };
  } finally {
    await pool.end();
  }
}

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const data = await fetchOrder(orderId);
  if (!data) notFound();
  return <ThermalReceipt order={data.order} items={data.items} />;
}
