'use client';

import { useEffect } from 'react';

interface Order {
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

function fmt(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} Kč`;
}

export function ThermalReceipt({ order, items }: { order: Order; items: Item[] }) {
  useEffect(() => {
    // Auto-trigger tisk po načtení (POS workflow)
    const t = setTimeout(() => window.print(), 500);
    return () => clearTimeout(t);
  }, []);

  // VAT 10 % kulturní akce
  const net = Math.round(order.total_amount / 1.1);
  const vat = order.total_amount - net;

  return (
    <>
      <style jsx global>{`
        @page {
          size: 58mm auto;
          margin: 2mm;
        }
        @media print {
          html, body {
            margin: 0;
            padding: 0;
            background: white;
          }
          .no-print {
            display: none !important;
          }
        }
        .receipt {
          width: 54mm;
          font-family: 'Courier New', monospace;
          font-size: 9pt;
          color: black;
          background: white;
          padding: 2mm;
        }
        .receipt h1 {
          font-size: 12pt;
          text-align: center;
          margin: 0 0 4pt;
          font-weight: bold;
        }
        .receipt .center { text-align: center; }
        .receipt .right { text-align: right; }
        .receipt .small { font-size: 7pt; }
        .receipt hr {
          border: none;
          border-top: 1px dashed black;
          margin: 4pt 0;
        }
        .receipt table {
          width: 100%;
          border-collapse: collapse;
          font-size: 8pt;
        }
        .receipt td {
          vertical-align: top;
          padding: 1pt 0;
        }
      `}</style>

      <div className="receipt">
        <h1>{order.promoter_name}</h1>
        {order.promoter_ico ? (
          <div className="center small">IČO: {order.promoter_ico}</div>
        ) : null}
        {order.promoter_dic ? (
          <div className="center small">DIČ: {order.promoter_dic}</div>
        ) : null}

        <hr />

        <div className="center" style={{ fontWeight: 'bold' }}>
          {order.event_title}
        </div>
        {order.event_date_start ? (
          <div className="center small">
            {new Date(order.event_date_start).toLocaleString('cs-CZ', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </div>
        ) : null}
        {order.venue_name ? (
          <div className="center small">{order.venue_name}</div>
        ) : null}

        <hr />

        <table>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td>
                  {it.ticket_type_name}
                  <br />
                  <span className="small">
                    {it.quantity}× {fmt(it.unit_price)}
                  </span>
                </td>
                <td className="right">{fmt(it.total_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <hr />

        <table>
          <tbody>
            <tr>
              <td>Základ DPH</td>
              <td className="right">{fmt(net)}</td>
            </tr>
            <tr>
              <td>DPH 10 %</td>
              <td className="right">{fmt(vat)}</td>
            </tr>
            <tr style={{ fontWeight: 'bold', fontSize: '11pt' }}>
              <td>Celkem</td>
              <td className="right">{fmt(order.total_amount)}</td>
            </tr>
          </tbody>
        </table>

        <hr />

        <div className="small">
          Platba:{' '}
          {order.payment_provider === 'free'
            ? 'Hotovost (POS)'
            : order.payment_provider === 'partner_pos'
              ? 'Partner POS'
              : order.payment_provider}
        </div>
        {order.paid_at ? (
          <div className="small">
            {new Date(order.paid_at).toLocaleString('cs-CZ')}
          </div>
        ) : null}
        <div className="small">Č. objednávky: {order.id.slice(0, 8)}</div>
        <div className="small">Kupec: {order.buyer_name ?? order.buyer_email}</div>

        <hr />

        <div className="center small" style={{ marginTop: '6pt' }}>
          Děkujeme za nákup!
        </div>
        <div className="center small">tixly.cz</div>
      </div>

      <div className="no-print" style={{ padding: 16, textAlign: 'center' }}>
        <button
          type="button"
          onClick={() => window.print()}
          style={{
            background: 'black',
            color: 'white',
            border: 'none',
            padding: '12px 24px',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          🖨 Tisk
        </button>
        <p style={{ marginTop: 12, fontSize: 12, color: '#666' }}>
          Tisk se spustí automaticky. Pro thermal printer 58mm nastav v print
          dialogu „Custom size 58mm × auto" nebo „Receipt" preset.
        </p>
      </div>
    </>
  );
}
