'use client';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';

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
    | 'gopay'
    | 'wero'
    | 'przelewy24'
    | 'bank_transfer'
    | 'pluxee'
    | 'benefit_plus'
    | 'gallery_beta'
    | 'edenred'
    | 'sodexo'
  >('gopay');
  const [showBenefitCards, setShowBenefitCards] = useState(false);
  const [isGift, setIsGift] = useState(false);
  const [giftEmail, setGiftEmail] = useState('');
  const [giftName, setGiftName] = useState('');
  const [giftMessage, setGiftMessage] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [useSubscription, setUseSubscription] = useState(false);
  const [availableSub, setAvailableSub] = useState<{
    planName: string;
    remaining: number;
  } | null>(null);

  interface PublicAddon {
    id: string;
    name: string;
    description: string | null;
    category: string;
    priceHalire: number;
    maxQuantity: number;
    stockAvailable: number | null;
  }
  interface InsuranceInfo {
    enabled: true;
    pct: number;
    currency: string;
  }
  const [addons, setAddons] = useState<PublicAddon[]>([]);
  const [addonQty, setAddonQty] = useState<Record<string, number>>({});
  const [insurance, setInsurance] = useState<InsuranceInfo | null>(null);
  const [insuranceOptIn, setInsuranceOptIn] = useState(false);
  const [unitPriceHalire, setUnitPriceHalire] = useState<number | null>(null);

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/events/${eventId}/addons`)
      .then((r) => r.json())
      .then((d: { addons: PublicAddon[]; insurance: InsuranceInfo | null }) => {
        setAddons(d.addons ?? []);
        setInsurance(d.insurance);
      })
      .catch(() => setAddons([]));
  }, [eventId]);

  // Pro live preview pojistného načteme cenu ticket typu (base price).
  useEffect(() => {
    if (!eventId || !ticketTypeId) return;
    fetch(`/api/events/${eventId}/ticket-types`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { ticketTypes?: Array<{ id: string; basePrice: number }> } | null) => {
        const tt = d?.ticketTypes?.find((t) => t.id === ticketTypeId);
        if (tt) setUnitPriceHalire(tt.basePrice);
      })
      .catch(() => {});
  }, [eventId, ticketTypeId]);

  // Po načtení zkusit zjistit, zda má buyer aktivní subscription u promotéra
  // tohoto eventu (vrátí availableSub pro UI checkbox „použít permanentku").
  useEffect(() => {
    if (!eventId) return;
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    if (!token) return;
    fetch(`/api/buyer/subscriptions`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { mySubscriptions?: Array<{ planName: string; consumptionsRemaining: number; promoterId: string; status: string }> } | null) => {
        if (!data?.mySubscriptions) return;
        // Najdi první aktivní s remaining > 0
        // Promoter id eventu nemáme, takže ukážeme tlačítko a server pak validuje
        const active = data.mySubscriptions.find(
          (s) => s.status === 'active' && s.consumptionsRemaining > 0,
        );
        if (active) {
          setAvailableSub({
            planName: active.planName,
            remaining: active.consumptionsRemaining,
          });
        }
      })
      .catch(() => {});
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
      if (useSubscription) {
        body.useSubscription = true;
      } else if (promoCode.trim()) {
        body.promoCode = promoCode.trim().toUpperCase();
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
      if (insurance && insuranceOptIn) body.insuranceOptIn = true;
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
            {availableSub ? (
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={useSubscription}
                  onChange={(e) => {
                    setUseSubscription(e.target.checked);
                    if (e.target.checked) setPromoCode('');
                  }}
                  className="mt-0.5"
                />
                <span>
                  <strong>Použít permanentku „{availableSub.planName}"</strong>
                  <span className="block text-xs text-emerald-700">
                    Zbývá {availableSub.remaining} lístků. Pokud zaškrtnu, tato objednávka
                    se spotřebuje z permanentky a cena bude 0 Kč.
                  </span>
                </span>
              </label>
            ) : null}
            <div className={useSubscription ? 'opacity-50' : ''}>
              <label htmlFor="checkout-promo" className="mb-1 block text-xs font-medium">
                Slevový kód <span className="text-muted-foreground">(volitelné)</span>
              </label>
              <Input
                id="checkout-promo"
                type="text"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
                placeholder="např. CELETNA20"
                autoCapitalize="characters"
                spellCheck={false}
                className="uppercase"
                disabled={useSubscription}
              />
            </div>
            {addons.length > 0 ? (
              <fieldset className="border-0 p-0">
                <legend className="mb-2 block text-xs font-medium">
                  Doplňky (volitelné)
                </legend>
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
                            aria-label={`Snížit počet doplňku ${a.name}`}
                            onClick={() =>
                              setAddonQty((s) => ({
                                ...s,
                                [a.id]: Math.max(0, qty - 1),
                              }))
                            }
                          >
                            <span aria-hidden>−</span>
                          </Button>
                          <span
                            className="w-6 text-center text-sm"
                            aria-label={`Počet doplňku ${a.name}: ${qty}`}
                          >
                            {qty}
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={qty >= a.maxQuantity}
                            aria-label={`Zvýšit počet doplňku ${a.name}`}
                            onClick={() =>
                              setAddonQty((s) => ({
                                ...s,
                                [a.id]: Math.min(a.maxQuantity, qty + 1),
                              }))
                            }
                          >
                            <span aria-hidden>+</span>
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}

            <fieldset className="border-0 p-0">
              <legend className="mb-1 block text-xs font-medium">
                Platební metoda
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm ${paymentMethod === 'gopay' ? 'border-primary bg-primary/5' : ''}`}
                >
                  <input
                    type="radio"
                    name="payment"
                    value="gopay"
                    checked={paymentMethod === 'gopay'}
                    onChange={() => setPaymentMethod('gopay')}
                  />
                  <span className="text-sm font-medium">💳 Karta</span>
                </label>
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm ${paymentMethod === 'bank_transfer' ? 'border-primary bg-primary/5' : ''}`}
                >
                  <input
                    type="radio"
                    name="payment"
                    value="bank_transfer"
                    checked={paymentMethod === 'bank_transfer'}
                    onChange={() => setPaymentMethod('bank_transfer')}
                  />
                  <span className="text-sm font-medium">🏦 Převodem</span>
                </label>
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm ${paymentMethod === 'wero' ? 'border-primary bg-primary/5' : ''}`}
                >
                  <input
                    type="radio"
                    name="payment"
                    value="wero"
                    checked={paymentMethod === 'wero'}
                    onChange={() => setPaymentMethod('wero')}
                  />
                  <span className="text-sm font-medium">⚡ Wero</span>
                </label>
              </div>

              {/* Benefit karty (B2B) — toggle */}
              <button
                type="button"
                onClick={() => setShowBenefitCards((v) => !v)}
                className="mt-2 text-xs text-primary hover:underline"
              >
                {showBenefitCards ? '−' : '+'} Benefit karty (Pluxee, Sodexo, Benefit+, Edenred, Gallery Beta)
              </button>

              {showBenefitCards ? (
                <div className="mt-2 grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-2 sm:grid-cols-3">
                  <label
                    className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs ${paymentMethod === 'pluxee' ? 'border-primary bg-primary/5' : 'bg-background'}`}
                  >
                    <input
                      type="radio"
                      name="payment"
                      value="pluxee"
                      checked={paymentMethod === 'pluxee'}
                      onChange={() => setPaymentMethod('pluxee')}
                    />
                    <span className="font-medium">Pluxee</span>
                  </label>
                  <label
                    className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs ${paymentMethod === 'sodexo' ? 'border-primary bg-primary/5' : 'bg-background'}`}
                  >
                    <input
                      type="radio"
                      name="payment"
                      value="sodexo"
                      checked={paymentMethod === 'sodexo'}
                      onChange={() => setPaymentMethod('sodexo')}
                    />
                    <span className="font-medium">Sodexo</span>
                  </label>
                  <label
                    className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs ${paymentMethod === 'benefit_plus' ? 'border-primary bg-primary/5' : 'bg-background'}`}
                  >
                    <input
                      type="radio"
                      name="payment"
                      value="benefit_plus"
                      checked={paymentMethod === 'benefit_plus'}
                      onChange={() => setPaymentMethod('benefit_plus')}
                    />
                    <span className="font-medium">Benefit Plus</span>
                  </label>
                  <label
                    className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs ${paymentMethod === 'edenred' ? 'border-primary bg-primary/5' : 'bg-background'}`}
                  >
                    <input
                      type="radio"
                      name="payment"
                      value="edenred"
                      checked={paymentMethod === 'edenred'}
                      onChange={() => setPaymentMethod('edenred')}
                    />
                    <span className="font-medium">Edenred</span>
                  </label>
                  <label
                    className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs ${paymentMethod === 'gallery_beta' ? 'border-primary bg-primary/5' : 'bg-background'}`}
                  >
                    <input
                      type="radio"
                      name="payment"
                      value="gallery_beta"
                      checked={paymentMethod === 'gallery_beta'}
                      onChange={() => setPaymentMethod('gallery_beta')}
                    />
                    <span className="font-medium">Gallery Beta</span>
                  </label>
                </div>
              ) : null}
            </fieldset>
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
            {insurance ? (() => {
              const qty = Math.max(1, parseInt(quantity, 10) || 1);
              const subtotal = (unitPriceHalire ?? 0) * qty;
              const premium = Math.floor((subtotal * insurance.pct) / 100);
              const ccy = insurance.currency === 'EUR' ? '€' : 'Kč';
              const premiumStr = `${(premium / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} ${ccy}`;
              return (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                  <label className="flex cursor-pointer items-start gap-2 text-sm font-medium text-amber-900">
                    <input
                      type="checkbox"
                      checked={insuranceOptIn}
                      onChange={(e) => setInsuranceOptIn(e.target.checked)}
                      className="mt-0.5"
                      data-testid="insurance-opt-in"
                    />
                    <span>
                      <span className="block">🛡️ Pojištění zrušení{premium > 0 ? ` (+${premiumStr})` : ''}</span>
                      <span className="mt-0.5 block text-xs font-normal text-amber-800">
                        Když ti zabrání nemoc, úraz nebo úmrtí v rodině jít na akci, vrátíme ti
                        plnou cenu vstupenky včetně poplatků. Pojistné {insurance.pct} % z ceny.
                      </span>
                    </span>
                  </label>
                </div>
              );
            })() : null}
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
                  <div>
                    <label
                      htmlFor="gift-email"
                      className="mb-1 block text-xs font-medium"
                    >
                      E-mail příjemce
                    </label>
                    <Input
                      id="gift-email"
                      type="email"
                      autoComplete="email"
                      value={giftEmail}
                      onChange={(e) => setGiftEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="gift-name"
                      className="mb-1 block text-xs font-medium"
                    >
                      Jméno příjemce (volitelné)
                    </label>
                    <Input
                      id="gift-name"
                      autoComplete="name"
                      value={giftName}
                      onChange={(e) => setGiftName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="gift-message"
                      className="mb-1 block text-xs font-medium"
                    >
                      Vzkaz (volitelný, zobrazí se v claim emailu)
                    </label>
                    <textarea
                      id="gift-message"
                      value={giftMessage}
                      onChange={(e) => setGiftMessage(e.target.value)}
                      rows={2}
                      maxLength={500}
                      className="w-full rounded-md border bg-background px-3 py-2 text-xs"
                    />
                  </div>
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
