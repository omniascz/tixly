'use client';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

function CheckoutForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const eventId = searchParams.get('eventId');
  const ticketTypeId = searchParams.get('ticketTypeId');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  // Quantity přichází z SeatPickeru po hold (?quantity=N). Bez tohohle initu
  // by buyer vybral 2 sedadla, ale form by poslal qty=1 a server by vrátil
  // SEAT_COUNT_MISMATCH.
  const [quantity, setQuantity] = useState(
    () => searchParams.get('quantity') ?? '1',
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ageGate, setAgeGate] = useState<{ minAge: number } | null>(null);
  const [birthDate, setBirthDate] = useState('');
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<
    'gopay' | 'wero' | 'przelewy24'
  >('gopay');
  const [isGift, setIsGift] = useState(false);
  const [giftEmail, setGiftEmail] = useState('');
  const [giftName, setGiftName] = useState('');
  const [giftMessage, setGiftMessage] = useState('');

  interface PublicAddon {
    id: string;
    name: string;
    description: string | null;
    category: string;
    priceHalire: number;
    maxQuantity: number;
    stockAvailable: number | null;
  }
  const [addons, setAddons] = useState<PublicAddon[]>([]);
  const [addonQty, setAddonQty] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/events/${eventId}/addons`)
      .then((r) => r.json())
      .then((d: { addons: PublicAddon[] }) => setAddons(d.addons ?? []))
      .catch(() => setAddons([]));
  }, [eventId]);

  if (!eventId || !ticketTypeId) {
    return (
      <p className="text-sm text-destructive">
        Chybí eventId nebo ticketTypeId. Vrať se prosím na seznam akcí.
      </p>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        eventId,
        ticketTypeId,
        buyerEmail: email,
        buyerName: name,
        quantity: parseInt(quantity, 10),
        paymentMethod,
      };
      if (ageGate || birthDate) {
        body.birthDate = birthDate;
        body.ageConfirmed = ageConfirmed;
      }
      const addonItems = Object.entries(addonQty)
        .filter(([, q]) => q > 0)
        .map(([addonId, quantity]) => ({ addonId, quantity }));
      if (addonItems.length > 0) {
        body.addons = addonItems;
      }
      if (isGift && giftEmail) {
        body.giftRecipientEmail = giftEmail;
        body.giftRecipientName = giftName || undefined;
        body.giftMessage = giftMessage || undefined;
      }
      // Pass-through z URL: lottery, queue, seat hold, affiliate
      const lotteryEntryId = searchParams.get('lotteryEntryId');
      const queueToken = searchParams.get('queueToken');
      const seatHoldToken = searchParams.get('seatHoldToken');
      const seatIdsCsv = searchParams.get('seatIds');
      const ref =
        searchParams.get('ref') ??
        (typeof window !== 'undefined' ? localStorage.getItem('tixly.ref') : null);
      if (lotteryEntryId) body.lotteryEntryId = lotteryEntryId;
      if (queueToken) body.queueToken = queueToken;
      if (seatHoldToken) body.seatHoldToken = seatHoldToken;
      if (seatIdsCsv) body.seatIds = seatIdsCsv.split(',');
      if (ref) body.affiliateCode = ref;
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === 'AGE_VERIFICATION_REQUIRED' && data.minAge) {
          setAgeGate({ minAge: data.minAge });
          setError(data.message ?? 'Tato akce vyžaduje ověření věku.');
          return;
        }
        if (data.error === 'AGE_BELOW_MINIMUM') {
          setError(data.message ?? 'Nesplňuješ věkový limit.');
          return;
        }
        setError(data.message ?? data.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      router.push(data.gatewayUrl);
    } catch {
      setError('Síťová chyba');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Dokončení objednávky</CardTitle>
          <CardDescription>
            Vyplň kontakt a klikni na „Pokračovat na platbu".
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label htmlFor="checkout-name" className="mb-1 block text-xs font-medium">
                Jméno a příjmení
              </label>
              <Input
                id="checkout-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="checkout-email" className="mb-1 block text-xs font-medium">
                E-mail
              </label>
              <Input
                id="checkout-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="checkout-quantity" className="mb-1 block text-xs font-medium">
                Počet kusů
              </label>
              <Input
                id="checkout-quantity"
                type="number"
                min={1}
                max={10}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </div>
            {addons.length > 0 ? (
              <div>
                <label className="mb-2 block text-xs font-medium">
                  Doplňky (volitelné)
                </label>
                <div className="space-y-2">
                  {addons.map((a) => {
                    const qty = addonQty[a.id] ?? 0;
                    return (
                      <div
                        key={a.id}
                        className="flex items-start justify-between gap-3 rounded-md border p-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{a.name}</div>
                          {a.description ? (
                            <div className="text-xs text-muted-foreground">
                              {a.description}
                            </div>
                          ) : null}
                          <div className="text-xs font-medium text-emerald-700">
                            {(a.priceHalire / 100).toLocaleString('cs-CZ')} Kč / ks
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={qty === 0}
                            onClick={() =>
                              setAddonQty((s) => ({
                                ...s,
                                [a.id]: Math.max(0, qty - 1),
                              }))
                            }
                          >
                            −
                          </Button>
                          <span className="w-6 text-center text-sm">{qty}</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={qty >= a.maxQuantity}
                            onClick={() =>
                              setAddonQty((s) => ({
                                ...s,
                                [a.id]: Math.min(a.maxQuantity, qty + 1),
                              }))
                            }
                          >
                            +
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div>
              <label className="mb-1 block text-xs font-medium">
                Platební metoda
              </label>
              <div className="flex gap-2">
                <label
                  className={`flex flex-1 cursor-pointer items-center gap-2 rounded-md border p-2 text-sm ${paymentMethod === 'gopay' ? 'border-primary bg-primary/5' : ''}`}
                >
                  <input
                    type="radio"
                    name="payment"
                    value="gopay"
                    checked={paymentMethod === 'gopay'}
                    onChange={() => setPaymentMethod('gopay')}
                  />
                  <span className="font-medium">GoPay</span>
                  <span className="text-xs text-muted-foreground">karta</span>
                </label>
                <label
                  className={`flex flex-1 cursor-pointer items-center gap-2 rounded-md border p-2 text-sm ${paymentMethod === 'wero' ? 'border-primary bg-primary/5' : ''}`}
                >
                  <input
                    type="radio"
                    name="payment"
                    value="wero"
                    checked={paymentMethod === 'wero'}
                    onChange={() => setPaymentMethod('wero')}
                  />
                  <span className="font-medium">Wero</span>
                  <span className="text-xs text-muted-foreground">SEPA Instant</span>
                </label>
                <label
                  className={`flex flex-1 cursor-pointer items-center gap-2 rounded-md border p-2 text-sm ${paymentMethod === 'przelewy24' ? 'border-primary bg-primary/5' : ''}`}
                >
                  <input
                    type="radio"
                    name="payment"
                    value="przelewy24"
                    checked={paymentMethod === 'przelewy24'}
                    onChange={() => setPaymentMethod('przelewy24')}
                  />
                  <span className="font-medium">Przelewy24</span>
                  <span className="text-xs text-muted-foreground">PL banky</span>
                </label>
              </div>
            </div>
            {ageGate ? (
              <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-900">
                  Tato akce je od {ageGate.minAge}+ let
                </p>
                <div>
                  <label htmlFor="checkout-birthdate" className="mb-1 block text-xs font-medium">
                    Datum narození
                  </label>
                  <Input
                    id="checkout-birthdate"
                    type="date"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                    required
                    max={new Date().toISOString().slice(0, 10)}
                  />
                </div>
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={ageConfirmed}
                    onChange={(e) => setAgeConfirmed(e.target.checked)}
                    required
                    className="mt-0.5"
                  />
                  <span>
                    Potvrzuji, že je mi {ageGate.minAge}+ let a uvedené datum narození je
                    pravdivé.
                  </span>
                </label>
              </div>
            ) : null}
            <div className="rounded-md border bg-muted/30 p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={isGift}
                  onChange={(e) => setIsGift(e.target.checked)}
                />
                🎁 Kupuji jako dárek
              </label>
              {isGift ? (
                <div className="mt-2 space-y-2">
                  <Input
                    type="email"
                    placeholder="E-mail příjemce"
                    value={giftEmail}
                    onChange={(e) => setGiftEmail(e.target.value)}
                    required
                  />
                  <Input
                    placeholder="Jméno příjemce (volitelné)"
                    value={giftName}
                    onChange={(e) => setGiftName(e.target.value)}
                  />
                  <textarea
                    placeholder="Vzkaz (volitelný, zobrazí se v claim emailu)"
                    value={giftMessage}
                    onChange={(e) => setGiftMessage(e.target.value)}
                    rows={2}
                    maxLength={500}
                    className="w-full rounded-md border bg-background px-3 py-2 text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Po zaplacení dostaneš ty potvrzení a příjemce magic link pro převzetí.
                  </p>
                </div>
              ) : null}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              disabled={loading || (ageGate !== null && !ageConfirmed) || (isGift && !giftEmail)}
              className="w-full"
            >
              {loading ? '...' : 'Pokračovat na platbu'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Načítám…</p>}>
      <CheckoutForm />
    </Suspense>
  );
}
