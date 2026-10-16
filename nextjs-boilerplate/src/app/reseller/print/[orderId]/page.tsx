'use client'

/**
 * Tisk vstupenek u prodejce.
 *
 * Kolo 3: data čte z GET /api/reseller/orders/[orderId]/tickets s tokenem prodejce
 * (localStorage 'resellerToken', stejně jako /reseller/sell). API vydá vstupenky jen
 * objednávky TOHOTO prodejce. Dřív serverová stránka dotazovala DB bez kontextu a ověřovala
 * jen, že objednávku prodal NĚJAKÝ prodejce.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useRouter } from 'next/navigation'
import QRCode from 'qrcode'

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
  /** Podepsaný statický token TXP2 (vstupenka + akce) — obsah QR kódu. */
  printToken: string
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'error' }
  | { kind: 'ok'; tickets: TicketRow[] }

export default function ResellerPrintPage(_props: { params: Promise<{ orderId: string }> }) {
  const params = useParams<{ orderId: string }>();
  const { orderId } = params
  const router = useRouter()
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    const token = localStorage.getItem('resellerToken')
    if (!token) {
      router.replace('/reseller/login')
      return
    }
    let cancelled = false
    fetch(`/api/reseller/orders/${orderId}/tickets`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (cancelled) return
        if (res.status === 401) {
          localStorage.removeItem('resellerToken')
          router.replace('/reseller/login')
          return
        }
        if (res.status === 404) return setState({ kind: 'not_found' })
        if (!res.ok) return setState({ kind: 'error' })
        const j = (await res.json()) as { tickets: TicketRow[] }
        setState(j.tickets.length === 0 ? { kind: 'not_found' } : { kind: 'ok', tickets: j.tickets })
      })
      .catch(() => { if (!cancelled) setState({ kind: 'error' }) })
    return () => { cancelled = true }
  }, [orderId, router])

  useEffect(() => {
    if (state.kind !== 'ok') return
    document.title = `Vstupenky — ${state.tickets[0].event_title}`
    const t = setTimeout(() => window.print(), 300)
    return () => clearTimeout(t)
  }, [state])

  if (state.kind === 'loading') return <p style={{ padding: '1rem', fontFamily: 'sans-serif' }}>Načítám vstupenky…</p>
  if (state.kind === 'not_found') return <p style={{ padding: '1rem', fontFamily: 'sans-serif' }}>Objednávka nenalezena (nebo ji neprodala tato prodejna).</p>
  if (state.kind === 'error') return <p style={{ padding: '1rem', fontFamily: 'sans-serif' }}>Vstupenky se nepodařilo načíst. Zkuste to znovu.</p>

  const tickets = state.tickets

  return (
    <>
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
                <QrCode value={t.printToken} size={90} />
                <div className="qr-id">{t.id.slice(0, 8)}</div>
              </div>
            </div>
          ))}
        </div>

    </>
  )
}

/**
 * Skutečný QR kód (knihovna `qrcode`, jako SMS vstupenka). Kolo 4: dřív se kreslila
 * pseudo-matice z textu `TXP:<id>`, kterou žádná čtečka nepřečetla.
 */
function QrCode({ value, size }: { value: string; size: number }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    QRCode.toDataURL(value, { errorCorrectionLevel: 'M', margin: 0, width: size * 4 })
      .then((url) => { if (alive) setSrc(url) })
      .catch(() => { if (alive) setSrc(null) })
    return () => { alive = false }
  }, [value, size])
  if (!src) return <div style={{ width: size, height: size }} />
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} width={size} height={size} alt="QR kód vstupenky" />
}
