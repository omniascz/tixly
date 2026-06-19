'use client'

import { FormEvent, useEffect, useState } from 'react'
import { PageHeader } from '@/components/admin/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

interface Partner {
  id: string
  name: string
  contact_email: string
  contact_phone: string | null
  city: string | null
  commission_pct: number
  status: 'pending' | 'active' | 'suspended'
  notes: string | null
  last_login_at: string | null
  created_at: string
  total_sales: string
  total_commission: string
}

function czk(halire: number): string {
  return (halire / 100).toLocaleString('cs-CZ') + ' Kč'
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  active: 'bg-green-100 text-green-800',
  suspended: 'bg-red-100 text-red-800',
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Čeká',
  active: 'Aktivní',
  suspended: 'Pozastaveno',
}

export default function ResellersPage() {
  const [partners, setPartners] = useState<Partner[]>([])
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)

  const [name, setName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [city, setCity] = useState('')
  const [commissionPct, setCommissionPct] = useState('5')
  const [password, setPassword] = useState('')

  useEffect(() => { void load() }, [])

  async function load() {
    try {
      const res = await fetch('/api/admin/resellers')
      if (!res.ok) { setError('Nepodařilo se načíst partnery'); return }
      const data = await res.json() as { partners: Partner[] }
      setPartners(data.partners ?? [])
    } catch { setError('Chyba sítě') }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setFeedback(null)
    try {
      const res = await fetch('/api/admin/resellers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, contactEmail,
          contactPhone: contactPhone || undefined,
          city: city || undefined,
          commissionPct: Number(commissionPct),
          password,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        setError(d.error ?? 'Chyba vytvoření')
        return
      }
      setFeedback('Partner byl přidán')
      setShowForm(false)
      setName(''); setContactEmail(''); setContactPhone(''); setCity(''); setCommissionPct('5'); setPassword('')
      void load()
    } catch { setError('Chyba sítě') }
    finally { setBusy(false) }
  }

  async function patchStatus(id: string, status: string) {
    setFeedback(null)
    const res = await fetch('/api/admin/resellers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    if (res.ok) {
      setFeedback('Status aktualizován')
      void load()
    }
  }

  async function settle(id: string) {
    setFeedback(null)
    const res = await fetch(`/api/admin/resellers/${id}/settle`, { method: 'POST' })
    if (res.ok) {
      const data = await res.json() as { settled: number; totalAmount: number }
      setFeedback(`Vyplaceno ${data.settled} prodejů, ${czk(data.totalAmount)}`)
      void load()
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Partnerská síť"
        description="Správa prodejních partnerů — hotel, turistické centrum, trafika."
      />

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}
      {feedback ? (
        <p className="text-sm text-green-700 font-medium">{feedback}</p>
      ) : null}

      <div className="flex justify-end">
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Zrušit' : 'Přidat partnera'}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nový partner</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Název *</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required disabled={busy} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Email *</label>
                <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} required disabled={busy} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Telefon</label>
                <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} disabled={busy} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Město</label>
                <Input value={city} onChange={(e) => setCity(e.target.value)} disabled={busy} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Provize %</label>
                <Input type="number" min={0} max={50} value={commissionPct} onChange={(e) => setCommissionPct(e.target.value)} disabled={busy} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Heslo *</label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={busy} />
              </div>
              <div className="md:col-span-2 flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)} disabled={busy}>Zrušit</Button>
                <Button type="submit" disabled={busy}>{busy ? 'Ukládám...' : 'Vytvořit'}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Název</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Město</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Provize %</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Prodeje</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Nevyplaceno</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Akce</th>
                </tr>
              </thead>
              <tbody>
                {partners.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      Žádní partneři. Klikněte na &quot;Přidat partnera&quot;.
                    </td>
                  </tr>
                ) : (
                  partners.map((p) => (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-medium">{p.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{p.city ?? '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{p.contact_email}</td>
                      <td className="px-4 py-3 text-right">{p.commission_pct} %</td>
                      <td className="px-4 py-3 text-center">
                        <Badge className={STATUS_BADGE[p.status] ?? ''}>{STATUS_LABEL[p.status] ?? p.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">{Number(p.total_sales)}</td>
                      <td className="px-4 py-3 text-right">
                        {czk(Number(p.total_commission))}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2 flex-wrap">
                          {p.status !== 'active' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => patchStatus(p.id, 'active')}
                            >
                              Aktivovat
                            </Button>
                          )}
                          {p.status === 'active' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => patchStatus(p.id, 'suspended')}
                            >
                              Pozastavit
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => settle(p.id)}
                          >
                            Vyplatit provizi
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
