'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface EventResult {
  id: string
  title: string
  date_start: string
  venue: string
  ticket_type_id: string
  ticket_type_name: string
  price_halire: number
  remaining_qty: number
  promoter_name: string
}

interface SaleResult {
  orderId: string
  tickets: { id: string; qrPayload: string; seatLabel: string | null }[]
  commissionEarned: number
}

function czk(halire: number): string {
  return (halire / 100).toLocaleString('cs-CZ') + ' Kč'
}

export default function ResellerSellPage() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<EventResult[]>([])
  const [selected, setSelected] = useState<EventResult | null>(null)
  const [buyerName, setBuyerName] = useState('')
  const [buyerEmail, setBuyerEmail] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saleResult, setSaleResult] = useState<SaleResult | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('resellerToken')
    if (!t) { router.replace('/reseller/login'); return }
    setToken(t)
  }, [router])

  function handleQueryChange(v: string) {
    setQuery(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (v.trim().length < 2) { setResults([]); return }
    debounceRef.current = setTimeout(() => void search(v), 350)
  }

  async function search(q: string) {
    if (!token) return
    try {
      const res = await fetch(`/api/reseller/events?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const data = await res.json() as { events: EventResult[] }
      setResults(data.events ?? [])
    } catch { /* silent */ }
  }

  async function handleSale(e: FormEvent) {
    e.preventDefault()
    if (!selected || !token) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/reseller/sale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          eventId: selected.id,
          ticketTypeId: selected.ticket_type_id,
          buyerName,
          buyerEmail,
          quantity,
        }),
      })
      const data = await res.json() as { orderId?: string; tickets?: SaleResult['tickets']; commissionEarned?: number; error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Prodej selhal')
        return
      }
      setSaleResult({ orderId: data.orderId!, tickets: data.tickets!, commissionEarned: data.commissionEarned! })
    } catch {
      setError('Chyba sítě')
    } finally {
      setBusy(false)
    }
  }

  if (saleResult) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-green-700">Prodej úspěšný!</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Objednávka: <span className="font-mono text-xs">{saleResult.orderId}</span>
            </p>
            <p className="text-sm">
              Vstupenek: <strong>{saleResult.tickets.length}</strong> &nbsp;·&nbsp;
              Vaše provize: <strong className="text-green-700">{czk(saleResult.commissionEarned)}</strong>
            </p>
            <div className="flex gap-3 pt-2">
              <Button asChild>
                <Link href={`/reseller/print/${saleResult.orderId}`} target="_blank">
                  Vytisknout vstupenky
                </Link>
              </Button>
              <Button variant="outline" onClick={() => {
                setSaleResult(null)
                setSelected(null)
                setQuery('')
                setBuyerName('')
                setBuyerEmail('')
                setQuantity(1)
              }}>
                Nový prodej
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b px-6 py-4 flex items-center gap-4">
        <Link href="/reseller/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          &larr; Dashboard
        </Link>
        <h1 className="text-lg font-semibold">Prodat vstupenku</h1>
      </header>

      <main className="max-w-xl mx-auto px-4 py-8 space-y-6">
        {!selected ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Krok 1 — Vyhledejte akci</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                placeholder="Název akce..."
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
              />
              {results.length > 0 && (
                <div className="divide-y border rounded-md overflow-hidden">
                  {results.map((ev) => (
                    <button
                      key={ev.ticket_type_id}
                      type="button"
                      onClick={() => { setSelected(ev); setResults([]) }}
                      className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors"
                    >
                      <p className="font-medium text-sm">{ev.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(ev.date_start).toLocaleDateString('cs-CZ')} · {ev.venue}
                      </p>
                      <p className="text-xs mt-0.5">
                        {ev.ticket_type_name} · {czk(ev.price_halire)} · zbývá {ev.remaining_qty} ks
                      </p>
                    </button>
                  ))}
                </div>
              )}
              {query.length >= 2 && results.length === 0 && (
                <p className="text-sm text-muted-foreground">Žádné výsledky</p>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Krok 2 — Dokončení prodeje</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 rounded-md bg-slate-50 border p-3 text-sm">
                <p className="font-medium">{selected.title}</p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  {new Date(selected.date_start).toLocaleDateString('cs-CZ')} · {selected.venue}
                </p>
                <p className="text-xs mt-0.5">{selected.ticket_type_name} · {czk(selected.price_halire)} / ks</p>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="mt-1 text-xs text-brand-600 hover:underline"
                >
                  Změnit akci
                </button>
              </div>

              <form onSubmit={handleSale} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="buyerName">Jméno kupujícího</label>
                  <Input
                    id="buyerName"
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                    required
                    disabled={busy}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="buyerEmail">Email kupujícího</label>
                  <Input
                    id="buyerEmail"
                    type="email"
                    value={buyerEmail}
                    onChange={(e) => setBuyerEmail(e.target.value)}
                    required
                    disabled={busy}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="qty">Počet vstupenek</label>
                  <Input
                    id="qty"
                    type="number"
                    min={1}
                    max={10}
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    required
                    disabled={busy}
                  />
                </div>
                <p className="text-sm font-medium">
                  Celkem: {czk(selected.price_halire * quantity)}
                </p>
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? 'Zpracovávám...' : 'Potvrdit prodej (cash)'}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
