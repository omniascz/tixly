import { db } from '@/lib/db/rls-pool'
import { notFound } from 'next/navigation'

interface TicketRow {
  id: string
  event_title: string
  date_start: string
  venue_name: string
  ticket_type_name: string
  seat_label: string | null
  buyer_name: string | null
  buyer_email: string
  serial: string
}

async function getOrderTickets(orderId: string): Promise<TicketRow[]> {
  const r = await db().query<TicketRow>(
    `SELECT t.id,
            e.title AS event_title,
            e.date_start,
            v.name AS venue_name,
            tt.name AS ticket_type_name,
            CASE WHEN es.id IS NOT NULL
              THEN es.sector || ' ' || es.row || es.seat_number::text
              ELSE NULL
            END AS seat_label,
            u.name AS buyer_name,
            u.email AS buyer_email,
            UPPER(SUBSTRING(t.id::text, 1, 8)) AS serial
     FROM tickets.tickets t
     JOIN orders.orders o ON o.id = t.order_id
     JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
     JOIN catalog.events e ON e.id = tt.event_id
     JOIN catalog.venues v ON v.id = e.venue_id
     JOIN auth.users u ON u.id = o.user_id
     LEFT JOIN catalog.event_seats es ON es.id = t.event_seat_id
     WHERE t.order_id = $1
     ORDER BY t.id`,
    [orderId],
  )
  return r.rows
}

async function verifyResellerOrder(orderId: string): Promise<boolean> {
  const r = await db().query<{ id: string }>(
    `SELECT rs.id FROM orders.reseller_sales rs WHERE rs.order_id = $1 LIMIT 1`,
    [orderId],
  )
  return r.rows.length > 0
}

export default async function ResellerPrintPage({ params }: { params: { orderId: string } }) {
  const { orderId } = params
  const [isReseller, tickets] = await Promise.all([
    verifyResellerOrder(orderId),
    getOrderTickets(orderId),
  ])

  if (!isReseller || tickets.length === 0) notFound()

  const first = tickets[0]

  return (
    <html lang="cs">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Vstupenky — {first.event_title}</title>
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: sans-serif; background: #fff; }

          .no-print { display: block; padding: 1rem; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; }
          .no-print button { padding: 0.5rem 1.25rem; background: #1e40af; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }

          .tickets { padding: 1rem; }

          .ticket {
            width: 148mm;
            min-height: 105mm;
            border: 2px solid #1e293b;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 1rem;
            page-break-inside: avoid;
            display: flex;
            gap: 16px;
          }

          .ticket-info { flex: 1; }
          .ticket-title { font-size: 16px; font-weight: 700; color: #1e293b; margin-bottom: 4px; }
          .ticket-date { font-size: 13px; color: #475569; margin-bottom: 2px; }
          .ticket-venue { font-size: 12px; color: #64748b; margin-bottom: 8px; }
          .ticket-type { display: inline-block; background: #1e40af; color: #fff; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px; margin-bottom: 8px; }
          .ticket-seat { font-size: 12px; color: #475569; margin-bottom: 4px; }
          .ticket-buyer { font-size: 11px; color: #94a3b8; }
          .ticket-serial { font-size: 10px; font-family: monospace; color: #94a3b8; margin-top: 8px; }

          .ticket-qr {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-width: 90px;
          }
          .ticket-qr svg { width: 90px; height: 90px; }
          .ticket-qr .qr-id { font-size: 8px; font-family: monospace; color: #64748b; margin-top: 4px; text-align: center; word-break: break-all; }

          @media print {
            .no-print { display: none !important; }
            body { background: #fff; }
            .tickets { padding: 0; }
            .ticket { margin-bottom: 0; page-break-after: always; }
            .ticket:last-child { page-break-after: avoid; }
          }
        `}</style>
      </head>
      <body>
        <div className="no-print">
          <button onClick={() => window.print()}>Vytisknout vstupenky</button>
        </div>

        <div className="tickets">
          {tickets.map((t) => (
            <div key={t.id} className="ticket">
              <div className="ticket-info">
                <div className="ticket-title">{t.event_title}</div>
                <div className="ticket-date">
                  {new Date(t.date_start).toLocaleString('cs-CZ', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </div>
                <div className="ticket-venue">{t.venue_name}</div>
                <span className="ticket-type">{t.ticket_type_name}</span>
                {t.seat_label ? (
                  <div className="ticket-seat">Sedadlo: {t.seat_label}</div>
                ) : null}
                <div className="ticket-buyer">
                  {t.buyer_name ?? t.buyer_email}
                </div>
                <div className="ticket-serial">#{t.serial}</div>
              </div>
              <div className="ticket-qr">
                <QrCode value={`TXP:${t.id}`} size={90} />
                <div className="qr-id">{t.id.slice(0, 8)}</div>
              </div>
            </div>
          ))}
        </div>

        <script dangerouslySetInnerHTML={{ __html: 'window.onload = function(){ window.print(); }' }} />
      </body>
    </html>
  )
}

function QrCode({ value, size }: { value: string; size: number }) {
  const cells = buildQrMatrix(value)
  const n = cells.length
  const cellSize = size / n

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} xmlns="http://www.w3.org/2000/svg">
      <rect width={size} height={size} fill="white" />
      {cells.flatMap((row, r) =>
        row.map((dark, c) =>
          dark ? (
            <rect
              key={`${r}-${c}`}
              x={c * cellSize}
              y={r * cellSize}
              width={cellSize}
              height={cellSize}
              fill="black"
            />
          ) : null,
        ),
      )}
    </svg>
  )
}

function buildQrMatrix(text: string): boolean[][] {
  const size = 21
  const grid: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false) as boolean[])

  function drawFinder(row: number, col: number) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const tr = row + r
        const tc = col + c
        if (tr < 0 || tr >= size || tc < 0 || tc >= size) continue
        const onBorder = r === -1 || r === 7 || c === -1 || c === 7
        const onInner = r >= 1 && r <= 5 && c >= 1 && c <= 5
        const onCore = r >= 2 && r <= 4 && c >= 2 && c <= 4
        grid[tr][tc] = onBorder || onCore || (!onInner)
      }
    }
  }

  drawFinder(0, 0)
  drawFinder(0, size - 7)
  drawFinder(size - 7, 0)

  const bytes = Array.from(text).map((ch) => ch.charCodeAt(0))
  let bi = 0
  for (let r = size - 1; r >= 0; r -= 2) {
    for (let c = size - 1; c >= 0; c--) {
      if (r < 8 && c < 8) continue
      if (r < 8 && c >= size - 8) continue
      if (r >= size - 8 && c < 8) continue
      const byte = bytes[bi % bytes.length] ?? 0
      const bit = (byte >> (7 - (bi % 8))) & 1
      grid[r][c] = bit === 1
      bi++
    }
  }

  return grid
}
