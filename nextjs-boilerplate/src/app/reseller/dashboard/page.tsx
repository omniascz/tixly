'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface Stats {
  totalSales: number
  totalRevenueHalire: number
  totalCommissionHalire: number
  pendingCommissionHalire: number
  salesLast30d: number
}

interface SaleRow {
  created_at: string
  total_amount: number
  commission_amount_halire: number
  settled_at: string | null
  event_title: string
  qty: string
}

function czk(halire: number): string {
  return (halire / 100).toLocaleString('cs-CZ') + ' Kč'
}

export default function ResellerDashboardPage() {
  const router = useRouter()
  const [stats, setStats] = useState<Stats | null>(null)
  const [sales, setSales] = useState<SaleRow[]>([])
  const [partnerName, setPartnerName] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('resellerToken')
    const name = localStorage.getItem('resellerPartnerName')
    if (!token) {
      router.replace('/reseller/login')
      return
    }
    setPartnerName(name ?? '')
    void load(token)
  }, [router])

  async function load(token: string) {
    try {
      const res = await fetch('/api/reseller/dashboard', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) {
        localStorage.removeItem('resellerToken')
        router.replace('/reseller/login')
        return
      }
      const data = await res.json() as { stats: Stats; recentSales: SaleRow[] }
      setStats(data.stats)
      setSales(data.recentSales)
    } catch {
      setError('Chyba načítání dat')
    }
  }

  function logout() {
    localStorage.removeItem('resellerToken')
    localStorage.removeItem('resellerPartnerName')
    router.push('/reseller/login')
  }

  if (!stats) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">{error ?? 'Načítám...'}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-500 text-white font-bold">
            T
          </div>
          <div>
            <p className="text-sm font-semibold">Tixly · Partnerský portál</p>
            <p className="text-xs text-muted-foreground">{partnerName}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={logout}>
          Odhlásit
        </Button>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Přehled</h1>
          <Button asChild>
            <Link href="/reseller/sell">Prodat vstupenku</Link>
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Celkem prodejů</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{stats.totalSales}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Tržby celkem</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{czk(stats.totalRevenueHalire)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Provize celkem</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{czk(stats.totalCommissionHalire)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Nevyplacená provize</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-amber-600">{czk(stats.pendingCommissionHalire)}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Posledních 20 prodejů</CardTitle>
          </CardHeader>
          <CardContent>
            {sales.length === 0 ? (
              <p className="text-sm text-muted-foreground">Zatím žádné prodeje</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="pb-2 text-left font-medium">Datum</th>
                      <th className="pb-2 text-left font-medium">Akce</th>
                      <th className="pb-2 text-right font-medium">Počet</th>
                      <th className="pb-2 text-right font-medium">Cena</th>
                      <th className="pb-2 text-right font-medium">Provize</th>
                      <th className="pb-2 text-center font-medium">Stav</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map((s, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2 pr-4 whitespace-nowrap">
                          {new Date(s.created_at).toLocaleDateString('cs-CZ')}
                        </td>
                        <td className="py-2 pr-4">{s.event_title}</td>
                        <td className="py-2 pr-4 text-right">{s.qty}</td>
                        <td className="py-2 pr-4 text-right">{czk(s.total_amount)}</td>
                        <td className="py-2 pr-4 text-right">{czk(s.commission_amount_halire)}</td>
                        <td className="py-2 text-center">
                          {s.settled_at ? (
                            <Badge className="bg-green-100 text-green-800">Vyplaceno</Badge>
                          ) : (
                            <Badge className="bg-amber-100 text-amber-800">Čeká</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
