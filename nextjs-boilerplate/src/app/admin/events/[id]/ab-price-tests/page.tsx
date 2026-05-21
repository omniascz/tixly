'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FlaskConical, TrendingUp, TrendingDown} from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedPost, TypedFetchError } from '@/lib/typed-fetch';

interface TicketType { id: string; name: string; base_price: number; }
interface Test {
  id: string; ticket_type_id: string; ticket_type_name: string; event_title: string;
  name: string;
  variant_a_price: number; variant_b_price: number; variant_b_pct: number;
  status: string;
  variant_a_visitors: number; variant_b_visitors: number;
  variant_a_conversions: number; variant_b_conversions: number;
  conversionA: number; conversionB: number; lift: number;
  hasSignificance: boolean;
  winner_variant: string | null;
}

function fmtKc(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} Kč`;
}

export default function ABPriceTestsPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const [tests, setTests] = useState<Test[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ticketTypeId, setTicketTypeId] = useState('');
  const [name, setName] = useState('');
  const [variantAKc, setVariantAKc] = useState('');
  const [variantBKc, setVariantBKc] = useState('');
  const [splitPct, setSplitPct] = useState('50');

  useEffect(() => { void load(); }, [eventId]);

  async function load(): Promise<void> {
    try {
      const [t, tt] = await Promise.all([
        typedGet<{ tests: Test[] }>('/api/admin/ab-price-tests'),
        typedGet<{ ticketTypes: TicketType[] }>(`/api/admin/events/${eventId}/ticket-types`).catch(() => ({ ticketTypes: [] })),
      ]);
      // Filter na current event
      setTests((t.tests ?? []).filter((x) => tt.ticketTypes?.some((y) => y.id === x.ticket_type_id)));
      setTicketTypes(tt.ticketTypes ?? []);
      if (!ticketTypeId && tt.ticketTypes?.length) {
        setTicketTypeId(tt.ticketTypes[0].id);
        setVariantAKc((tt.ticketTypes[0].base_price / 100).toString());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    }
  }

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await typedPost('/api/admin/ab-price-tests', {
        ticketTypeId, name,
        variantAPrice: Math.round(Number(variantAKc) * 100),
        variantBPrice: Math.round(Number(variantBKc) * 100),
        variantBPct: Number(splitPct),
      }, { throwOnError: true });
      setShowForm(false);
      setName(''); setVariantBKc(''); setSplitPct('50');
      await load();
    } catch (err) {
      if (err instanceof TypedFetchError) {
        setError((err.body as { error?: string })?.error ?? `HTTP ${err.status}`);
      } else {
        setError(err instanceof Error ? err.message : 'Chyba');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="A/B price tests"
        description="Split traffic mezi 2 cenami pro stejný ticket_type. Vyhrává varianta s lepší konverzí."
      />

      {error ? <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div> : null}

      <div className="flex justify-between">
        <p className="text-sm text-muted-foreground">{tests.length} testů</p>
        <Button onClick={() => setShowForm(!showForm)}>{showForm ? 'Zavřít' : '+ Nový test'}</Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader><CardTitle>Nový A/B test</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Ticket type</label>
              <select value={ticketTypeId} onChange={(e) => {
                setTicketTypeId(e.target.value);
                const tt = ticketTypes.find((x) => x.id === e.target.value);
                if (tt) setVariantAKc((tt.base_price / 100).toString());
              }}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                {ticketTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({fmtKc(t.base_price)})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Název hypotézy</label>
              <Input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="např. Cena 450 vs 550 — co konvertuje lépe" maxLength={200} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Varianta A (Kč)</label>
                <Input type="number" value={variantAKc} onChange={(e) => setVariantAKc(e.target.value)} />
                <p className="mt-1 text-xs text-muted-foreground">control</p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Varianta B (Kč)</label>
                <Input type="number" value={variantBKc} onChange={(e) => setVariantBKc(e.target.value)} />
                <p className="mt-1 text-xs text-muted-foreground">treatment</p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Split % do B</label>
                <Input type="number" min="1" max="99" value={splitPct} onChange={(e) => setSplitPct(e.target.value)} />
              </div>
            </div>
            <Button onClick={create} disabled={busy || !name || !variantAKc || !variantBKc}>
              <FlaskConical className="mr-1 h-4 w-4" /> {busy ? 'Vytvářím…' : 'Spustit test'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {tests.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <FlaskConical className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Žádné A/B testy. Začni testem hypotézy — jaká cena maximalizuje revenue?
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {tests.map((t) => (
            <Card key={t.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="text-base">{t.name}</span>
                  <span className={`rounded-full px-2 py-1 text-xs ${
                    t.status === 'active' ? 'bg-blue-100 text-blue-800' :
                    t.status === 'finished' ? 'bg-emerald-100 text-emerald-800' :
                    'bg-slate-200'
                  }`}>{t.status}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className={`rounded-md border p-3 ${t.winner_variant === 'a' ? 'border-emerald-500 bg-emerald-50' : ''}`}>
                    <p className="text-xs text-muted-foreground">Varianta A (control)</p>
                    <p className="text-xl font-bold">{fmtKc(t.variant_a_price)}</p>
                    <p className="mt-2 text-xs">
                      {t.variant_a_visitors} návštěvníků · {t.variant_a_conversions} koupilo
                    </p>
                    <p className="font-semibold">{t.conversionA.toFixed(2)} % konverze</p>
                  </div>
                  <div className={`rounded-md border p-3 ${t.winner_variant === 'b' ? 'border-emerald-500 bg-emerald-50' : ''}`}>
                    <p className="text-xs text-muted-foreground">Varianta B ({t.variant_b_pct} % split)</p>
                    <p className="text-xl font-bold">{fmtKc(t.variant_b_price)}</p>
                    <p className="mt-2 text-xs">
                      {t.variant_b_visitors} návštěvníků · {t.variant_b_conversions} koupilo
                    </p>
                    <p className="font-semibold">{t.conversionB.toFixed(2)} % konverze</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 text-sm">
                  {t.lift > 0 ? <TrendingUp className="h-4 w-4 text-emerald-700" /> :
                   t.lift < 0 ? <TrendingDown className="h-4 w-4 text-rose-700" /> : null}
                  <span>Lift: <strong>{t.lift > 0 ? '+' : ''}{t.lift.toFixed(1)} %</strong></span>
                  {!t.hasSignificance ? (
                    <span className="text-xs text-amber-700">⚠️ Málo dat pro statistickou významnost</span>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
