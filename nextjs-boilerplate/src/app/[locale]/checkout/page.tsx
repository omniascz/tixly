'use client';
import { FormEvent, Suspense, useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MetaPixel } from '@/components/tracking/MetaPixel';
import { PixelManager } from '@/components/tracking/PixelManager';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { fbqTrack } from '@/lib/tracking/fbq';

function CheckoutForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const eventId = searchParams.get('eventId');
  const ticketTypeId = searchParams.get('ticketTypeId');

  const [name, setName] = useState(
    () => searchParams.get('buyerName') ?? '',
  );
  const [email, setEmail] = useState(
    () => searchParams.get('buyerEmail') ?? '',
  );
  // Quantity přichází z SeatPickeru po hold (?quantity=N). Bez tohohle initu
  // by buyer vybral 2 sedadla, ale form by poslal qty=1 a server by vrátil
  // SEAT_COUNT_MISMATCH.
  const [quantity, setQuantity] = useState(
    () => searchParams.get('quantity') ?? '1',
  );
  const [lotteryEntryId, setLotteryEntryId] = useState<string | null>(
    () => searchParams.get('lotteryEntryId') ?? null,
  );
  const [lotteryDeadline, setLotteryDeadline] = useState<string | null>(null);
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
    | 'multisport'
    | 'twisto'
    | 'skippay'
    | 'b2b_credit'
  >('gopay');
  const [b2bAccountCode, setB2bAccountCode] = useState('');
  const [b2bVerify, setB2bVerify] = useState<{ companyName: string; balanceHalire: number } | null>(null);
  const [b2bVerifyError, setB2bVerifyError] = useState<string | null>(null);
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
  const [carbonOffset, setCarbonOffset] = useState<{ amountHalire: number; label: string } | null>(null);
  const [carbonOffsetOptIn, setCarbonOffsetOptIn] = useState(false);
  const [unitPriceHalire, setUnitPriceHalire] = useState<number | null>(null);
  const [metaPixelId, setMetaPixelId] = useState<string | null>(null);
  const [currency, setCurrency] = useState('CZK');

  interface FoyerMenuItem {
    id: string;
    name: string;
    description: string | null;
    priceHalire: number;
    category: string;
    availableCount: number | null;
  }
  interface ProgramInfo {
    id: string;
    title: string | null;
    coverImageUrl: string | null;
    programPriceHalire: number;
  }
  const [foyerMenu, setFoyerMenu] = useState<FoyerMenuItem[]>([]);
  const [foyerItems, setFoyerItems] = useState<Record<string, number>>({});
  const [programInfo, setProgramInfo] = useState<ProgramInfo | null>(null);
  const [addProgram, setAddProgram] = useState(false);

  // EVENTIM.Travel — hotelové balíčky k eventu
  interface TravelPackage {
    id: string;
    hotelName: string;
    hotelCity: string | null;
    hotelStars: number | null;
    hotelCoverImageUrl: string | null;
    roomName: string;
    roomBreakfastIncluded: boolean;
    checkinDate: string;
    checkoutDate: string;
    nights: number;
    availableCount: number | null;
    pricePerNightHalire: number;
    totalPriceHalire: number;
  }
  const [travelPackages, setTravelPackages] = useState<TravelPackage[]>([]);
  const [selectedTravelPackageId, setSelectedTravelPackageId] = useState<string | null>(null);
  const [travelGuests, setTravelGuests] = useState(1);
  const [travelNotes, setTravelNotes] = useState('');

  // Parking bundle (mig 402)
  interface ParkingOffer {
    id: string; name: string; description: string | null;
    address: string | null; distance_meters: number | null;
    vehicle_types: string[]; height_limit_cm: number | null;
    price_halire: number; capacity: number; reserved_count: number;
    access_instructions: string | null;
  }
  const [parkingOffers, setParkingOffers] = useState<ParkingOffer[]>([]);
  const [selectedParkingOfferId, setSelectedParkingOfferId] = useState<string | null>(null);

  // Event-level gates (P1.5+P1.8 fixes) — VF presale + OTP SMS.
  const [eventFlags, setEventFlags] = useState<{
    requiresOtp: boolean;
    verifiedFanEnabled: boolean;
  }>({ requiresOtp: false, verifiedFanEnabled: false });

  // OTP state
  const [otpPhone, setOtpPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpSending, setOtpSending] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  // Verified Fan presale code
  const [presaleCode, setPresaleCode] = useState('');

  useEffect(() => {
    const lotteryToken = searchParams.get('lotteryToken');
    if (!lotteryToken) return;
    void (async () => {
      try {
        const res = await fetch(`/api/lottery/entry/${encodeURIComponent(lotteryToken)}`);
        if (!res.ok) return;
        const d = (await res.json()) as {
          entry?: { id: string; status: string; paymentDeadline: string | null };
        };
        if (d.entry) {
          if (!lotteryEntryId) setLotteryEntryId(d.entry.id);
          if (d.entry.paymentDeadline) setLotteryDeadline(d.entry.paymentDeadline);
        }
      } catch {
      }
    })();
  }, []);

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

  // Carbon offset — načteme platformové nastavení jednou při mountu
  useEffect(() => {
    const loc = typeof window !== 'undefined' ? (localStorage.getItem('locale') ?? 'cs') : 'cs';
    fetch(`/api/carbon-offset-settings?locale=${loc}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { active?: boolean; amountHalire?: number; label?: string } | null) => {
        if (d?.active && d.amountHalire && d.label) {
          setCarbonOffset({ amountHalire: d.amountHalire, label: d.label });
        }
      })
      .catch(() => undefined);
  }, []);

  // EVENTIM.Travel — načteme dostupné balíčky pro event
  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/events/${eventId}/travel-packages`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { packages?: TravelPackage[] } | null) => setTravelPackages(d?.packages ?? []))
      .catch(() => setTravelPackages([]));
  }, [eventId]);

  // Parking bundle — načteme dostupné parkovací nabídky
  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/events/${eventId}/parking-offers`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { offers?: ParkingOffer[] } | null) => setParkingOffers(d?.offers ?? []))
      .catch(() => setParkingOffers([]));
  }, [eventId]);

  // Pro live preview pojistného načteme cenu ticket typu (base price)
  // a eventFlags (OTP/VF requirements).
  useEffect(() => {
    if (!eventId || !ticketTypeId) return;
    fetch(`/api/events/${eventId}/ticket-types`)
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (d: {
          ticketTypes?: Array<{ id: string; basePrice: number }>;
          eventFlags?: { requiresOtp: boolean; verifiedFanEnabled: boolean };
          metaPixelId?: string | null;
          currency?: string;
        } | null) => {
          const tt = d?.ticketTypes?.find((t) => t.id === ticketTypeId);
          if (tt) setUnitPriceHalire(tt.basePrice);
          if (d?.eventFlags) setEventFlags(d.eventFlags);
          if (d?.metaPixelId) setMetaPixelId(d.metaPixelId);
          if (d?.currency) setCurrency(d.currency);
        },
      )
      .catch(() => {});
  }, [eventId, ticketTypeId]);

  async function requestOtp(): Promise<void> {
    setOtpSending(true);
    setOtpError(null);
    try {
      const r = await fetch('/api/buyer/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: otpPhone, eventId }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP_${r.status}`);
      }
      setOtpSent(true);
    } catch (e) {
      setOtpError((e as Error).message);
    } finally {
      setOtpSending(false);
    }
  }

  async function verifyOtp(): Promise<void> {
    setOtpSending(true);
    setOtpError(null);
    try {
      const r = await fetch('/api/buyer/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: otpPhone, code: otpCode, eventId }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP_${r.status}`);
      }
      const body = (await r.json()) as { otpToken: string };
      setOtpToken(body.otpToken);
    } catch (e) {
      setOtpError((e as Error).message);
    } finally {
      setOtpSending(false);
    }
  }

  async function verifyB2bCode(): Promise<void> {
    const code = b2bAccountCode.trim().toUpperCase();
    if (code.length < 4) return;
    setB2bVerifyError(null);
    setB2bVerify(null);
    try {
      const r = await fetch('/api/b2b/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountCode: code, email: email || undefined }),
      });
      const d = (await r.json()) as { valid: boolean; companyName?: string; balanceHalire?: number; error?: string };
      if (d.valid && d.companyName !== undefined && d.balanceHalire !== undefined) {
        setB2bVerify({ companyName: d.companyName, balanceHalire: d.balanceHalire });
      } else {
        setB2bVerifyError(d.error === 'EMAIL_NOT_AUTHORIZED' ? 'Váš email není oprávněn k tomuto účtu.' : 'Neplatný kód firemního účtu.');
      }
    } catch {
      setB2bVerifyError('Nepodařilo se ověřit kód.');
    }
  }

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/events/${eventId}/foyer-menu`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { items?: FoyerMenuItem[] } | null) => {
        setFoyerMenu(d?.items ?? []);
      })
      .catch(() => {});
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/programs/${eventId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { locked?: boolean; program?: ProgramInfo | null } | null) => {
        if (d?.program && d.locked && (d.program.programPriceHalire ?? 0) > 0) {
          setProgramInfo(d.program);
        }
      })
      .catch(() => {});
  }, [eventId]);

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
      const resolvedLotteryEntryId = lotteryEntryId ?? searchParams.get('lotteryEntryId');
      const queueToken = searchParams.get('queueToken');
      const seatHoldToken = searchParams.get('seatHoldToken');
      const seatIdsCsv = searchParams.get('seatIds');
      const ref =
        searchParams.get('ref') ??
        (typeof window !== 'undefined' ? localStorage.getItem('tixly.ref') : null);
      if (resolvedLotteryEntryId) body.lotteryEntryId = resolvedLotteryEntryId;
      if (queueToken) body.queueToken = queueToken;
      if (seatHoldToken) body.seatHoldToken = seatHoldToken;
      if (seatIdsCsv) body.seatIds = seatIdsCsv.split(',');
      if (ref) body.affiliateCode = ref;
      if (insurance && insuranceOptIn) body.insuranceOptIn = true;
      if (carbonOffset && carbonOffsetOptIn) body.carbonOffsetOptIn = true;
      if (selectedParkingOfferId) body.parkingOfferId = selectedParkingOfferId;
      const foyerItemsArr = Object.entries(foyerItems)
        .filter(([, q]) => q > 0)
        .map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
      if (foyerItemsArr.length > 0) body.foyerItems = foyerItemsArr;
      if (addProgram && programInfo) body.addProgram = true;
      // EVENTIM.Travel — přidáme hotel balíček pokud byl vybrán
      if (selectedTravelPackageId) {
        body.travelPackageId = selectedTravelPackageId;
        if (travelGuests > 1) body.travelGuests = travelGuests;
        if (travelNotes.trim()) body.travelNotes = travelNotes.trim();
      }
      // Group bookings — friend přišel přes /cs/group/[token] share link
      // (checkoutUrl returned z /api/group-invitations/[token]). Token se
      // propaguje sem přes ?groupInvitation= a backend linkne order na
      // orders.group_invitations.
      const groupInvitation = searchParams.get('groupInvitation');
      if (groupInvitation) body.groupInvitationToken = groupInvitation;
      // Timed entry slot — pokud event.timed_entry_enabled, buyer vybral slot na event stránce
      const entrySlotId = searchParams.get('entrySlotId');
      if (entrySlotId) body.entrySlotId = entrySlotId;
      // OTP (P1.8) — pokud event vyžaduje requires_otp_validation, posíláme
      // ověřený token získaný přes /api/buyer/otp/verify. Backend (checkout
      // route.ts ~243) odmítne pokud chybí nebo expired.
      if (eventFlags.requiresOtp && otpToken) body.otpToken = otpToken;
      // Verified Fan presale code (P1.5) — admin bulk-approve vygeneruje
      // PSL-xxxx code, fan ho zadá tady aby projel gate v checkout/route.ts.
      if (eventFlags.verifiedFanEnabled && presaleCode.trim())
        body.presaleCode = presaleCode.trim().toUpperCase();
      if (paymentMethod === 'b2b_credit' && b2bAccountCode.trim()) {
        body.b2bAccountCode = b2bAccountCode.trim().toUpperCase();
      }
      // QR attribution: cookie qr_ref nastavená v /api/qr/[slug] redirect
      // (90 days TTL). Server validuje že kampaň patří k tomuto eventu.
      const qrRefMatch =
        typeof document !== 'undefined'
          ? document.cookie.match(/(?:^|;\s*)qr_ref=([0-9a-f-]{36})/i)
          : null;
      if (qrRefMatch) body.qrRef = qrRefMatch[1];
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
      // AddPaymentInfo — těsně před odchodem na platební bránu.
      const qtyNum = parseInt(quantity, 10) || 1;
      fbqTrack('AddPaymentInfo', {
        content_ids: [eventId],
        content_type: 'product',
        num_items: qtyNum,
        ...(unitPriceHalire ? { value: (unitPriceHalire * qtyNum) / 100, currency } : {}),
      });
      router.push(data.gatewayUrl);
    } catch {
      setError('Síťová chyba');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <MetaPixel
        pixelId={metaPixelId}
        event="InitiateCheckout"
        eventData={{
          content_ids: [eventId],
          content_type: 'product',
          num_items: parseInt(quantity, 10) || 1,
          ...(unitPriceHalire
            ? { value: (unitPriceHalire * (parseInt(quantity, 10) || 1)) / 100, currency }
            : {}),
        }}
      />
      {eventId ? (
        <PixelManager
          eventId={eventId}
          pageEvent="InitiateCheckout"
          eventData={{
            items: parseInt(quantity, 10) || 1,
            ...(unitPriceHalire
              ? { value: (unitPriceHalire * (parseInt(quantity, 10) || 1)) / 100, currency }
              : {}),
          }}
        />
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Dokončení objednávky</CardTitle>
          <CardDescription>
            Vyplň kontakt a klikni na „Pokračovat na platbu".
          </CardDescription>
        </CardHeader>
        <CardContent>
          {searchParams.get('entrySlotId') ? (
            <TimedSlotInfo eventId={eventId ?? ''} slotId={searchParams.get('entrySlotId') ?? ''} />
          ) : null}
          {lotteryEntryId ? (
            <div className="mb-4 rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
              <p className="font-semibold">Uplatňujete výherní los</p>
              {lotteryDeadline ? (
                <p className="mt-0.5 text-xs">
                  Platnost do:{' '}
                  {new Date(lotteryDeadline).toLocaleString('cs-CZ', {
                    day: 'numeric',
                    month: 'long',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              ) : null}
            </div>
          ) : null}
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

            {/* Verified Fan presale code (P1.5) — viditelné jen pro VF events */}
            {eventFlags.verifiedFanEnabled ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                <label className="block text-xs font-medium text-amber-900">
                  Verified Fan presale kód *
                  <input
                    type="text"
                    required
                    value={presaleCode}
                    onChange={(e) =>
                      setPresaleCode(e.target.value.toUpperCase())
                    }
                    placeholder="PSL-XXXX-XXXX"
                    className="mt-1 block w-full rounded-md border border-amber-300 px-3 py-2 font-mono text-sm"
                  />
                </label>
                <p className="mt-1 text-xs text-amber-800">
                  Tato akce je v presale módu. Kód jsi obdržel(a) emailem po
                  schválení Verified Fan žádosti.
                </p>
              </div>
            ) : null}

            {/* OTP SMS verification (P1.8) — viditelné jen pro events s requires_otp_validation */}
            {eventFlags.requiresOtp ? (
              <div className="rounded-md border border-sky-300 bg-sky-50 p-3 space-y-2">
                <p className="text-xs font-medium text-sky-900">
                  📱 Ověření telefonu SMS (anti-bot)
                </p>
                {!otpToken ? (
                  <>
                    <label className="block text-xs font-medium text-slate-700">
                      Telefon (formát +420...)
                      <div className="mt-1 flex gap-2">
                        <input
                          type="tel"
                          value={otpPhone}
                          onChange={(e) => setOtpPhone(e.target.value)}
                          placeholder="+420777123456"
                          disabled={otpSent}
                          className="flex-1 rounded-md border px-3 py-2 text-sm"
                        />
                        <button
                          type="button"
                          onClick={requestOtp}
                          disabled={otpSending || otpSent || !otpPhone}
                          className="rounded-md bg-sky-600 px-3 py-2 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                        >
                          {otpSent ? '✓ Posláno' : 'Pošli kód'}
                        </button>
                      </div>
                    </label>
                    {otpSent ? (
                      <label className="block text-xs font-medium text-slate-700">
                        6-místný kód
                        <div className="mt-1 flex gap-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="\d{6}"
                            maxLength={6}
                            value={otpCode}
                            onChange={(e) =>
                              setOtpCode(e.target.value.replace(/\D/g, ''))
                            }
                            placeholder="123456"
                            className="w-32 rounded-md border px-3 py-2 font-mono text-sm tracking-widest"
                          />
                          <button
                            type="button"
                            onClick={verifyOtp}
                            disabled={otpSending || otpCode.length !== 6}
                            className="rounded-md bg-sky-600 px-3 py-2 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                          >
                            Ověř
                          </button>
                        </div>
                      </label>
                    ) : null}
                    {otpError ? (
                      <p className="text-xs text-rose-600">{otpError}</p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-xs text-emerald-700">
                    ✓ Telefon ověřen ({otpPhone})
                  </p>
                )}
              </div>
            ) : null}

            {foyerMenu.length > 0 ? (
              <fieldset className="border-0 p-0">
                <legend className="mb-2 block text-sm font-semibold">
                  🍹 Foyer bar — objednejte si nápoje na přestávku
                </legend>
                <div className="space-y-2">
                  {foyerMenu.map((item) => {
                    const categoryEmoji: Record<string, string> = {
                      napoje: '🥤',
                      jidlo: '🍽️',
                      dezerty: '🍰',
                      ostatni: '🛍️',
                    };
                    const emoji = categoryEmoji[item.category] ?? '🛍️';
                    const qty = foyerItems[item.id] ?? 0;
                    return (
                      <div
                        key={item.id}
                        className="flex items-start justify-between gap-3 rounded-md border p-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">
                            {emoji} {item.name}
                          </div>
                          {item.description ? (
                            <div className="text-xs text-muted-foreground">
                              {item.description}
                            </div>
                          ) : null}
                          <div className="text-xs font-medium text-emerald-700">
                            {(item.priceHalire / 100).toLocaleString('cs-CZ')} Kč / ks
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={qty === 0}
                            aria-label={`Snížit počet ${item.name}`}
                            onClick={() =>
                              setFoyerItems((s) => ({
                                ...s,
                                [item.id]: Math.max(0, qty - 1),
                              }))
                            }
                          >
                            <span aria-hidden>−</span>
                          </Button>
                          <span className="w-6 text-center text-sm">{qty}</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={
                              item.availableCount !== null
                                ? qty >= item.availableCount
                                : qty >= 10
                            }
                            aria-label={`Zvýšit počet ${item.name}`}
                            onClick={() =>
                              setFoyerItems((s) => ({
                                ...s,
                                [item.id]: qty + 1,
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
                {(() => {
                  const foyerTotal = foyerMenu.reduce(
                    (sum, item) => sum + (foyerItems[item.id] ?? 0) * item.priceHalire,
                    0,
                  );
                  return foyerTotal > 0 ? (
                    <p className="mt-1 text-right text-xs font-medium text-emerald-700">
                      Foyer celkem: {(foyerTotal / 100).toLocaleString('cs-CZ')} Kč
                    </p>
                  ) : null;
                })()}
              </fieldset>
            ) : null}

            {programInfo ? (
              <div className="rounded-md border border-violet-200 bg-violet-50 p-3">
                <label className="flex cursor-pointer items-start gap-3 text-sm font-medium text-violet-900">
                  <input
                    type="checkbox"
                    checked={addProgram}
                    onChange={(e) => setAddProgram(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="flex-1">
                    <span className="block">
                      📖 Digitální program
                      {programInfo.title ? ` — ${programInfo.title}` : ''}
                      {' '}
                      <span className="font-semibold">
                        (+{(programInfo.programPriceHalire / 100).toLocaleString('cs-CZ')} Kč)
                      </span>
                    </span>
                    {programInfo.coverImageUrl ? (
                      <img
                        src={programInfo.coverImageUrl}
                        alt="Cover programu"
                        className="mt-2 h-16 w-auto rounded object-cover"
                      />
                    ) : null}
                    <span className="mt-1 block text-xs font-normal text-violet-800">
                      Obsazení, režijní poznámka a galerka — přístup přes QR/odkaz v potvrzovacím emailu.
                    </span>
                  </span>
                </label>
              </div>
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
                  className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm ${paymentMethod === 'wero' ? 'border-[#6D28D9] bg-violet-50' : ''}`}
                >
                  <input
                    type="radio"
                    name="payment"
                    value="wero"
                    checked={paymentMethod === 'wero'}
                    onChange={() => setPaymentMethod('wero')}
                  />
                  <span className="text-sm font-medium">
                    <span className="mr-1 inline-block rounded bg-violet-700 px-1.5 py-0.5 text-[10px] font-bold text-white">W</span>
                    Wero <span className="text-xs text-muted-foreground">— A2A Instant</span>
                  </span>
                </label>
              </div>

              {/* Wero phone hint — zobrazí se jen při výběru Wero */}
              {paymentMethod === 'wero' && (
                <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs text-violet-800">
                  <p className="font-semibold">⚡ Wero — okamžitá platba z účtu</p>
                  <p className="mt-1 text-violet-600">
                    Po kliknutí na &quot;Zaplatit&quot; zadáš telefonní číslo nebo naskenuj QR kód
                    ve své banking appce (Air Bank, ČSOB, KB, Raiffeisen…).
                    Peníze dorazí do 10 sekund přes SEPA Instant.
                  </p>
                </div>
              )}

              {/* BNPL — Buy Now Pay Later (CZ: Twisto / Skip Pay) */}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm ${paymentMethod === 'twisto' ? 'border-primary bg-primary/5' : ''}`}
                >
                  <input
                    type="radio"
                    name="payment"
                    value="twisto"
                    checked={paymentMethod === 'twisto'}
                    onChange={() => setPaymentMethod('twisto')}
                  />
                  <span className="font-medium">
                    Twisto <span className="text-xs text-muted-foreground">— 3 splátky</span>
                  </span>
                </label>
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm ${paymentMethod === 'skippay' ? 'border-primary bg-primary/5' : ''}`}
                >
                  <input
                    type="radio"
                    name="payment"
                    value="skippay"
                    checked={paymentMethod === 'skippay'}
                    onChange={() => setPaymentMethod('skippay')}
                  />
                  <span className="font-medium">
                    Skip Pay <span className="text-xs text-muted-foreground">— 4 splátky (ČSOB)</span>
                  </span>
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

              {/* B2B firemní kredit */}
              <div className="mt-2">
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm ${paymentMethod === 'b2b_credit' ? 'border-primary bg-primary/5' : ''}`}
                >
                  <input
                    type="radio"
                    name="payment"
                    value="b2b_credit"
                    checked={paymentMethod === 'b2b_credit'}
                    onChange={() => {
                      setPaymentMethod('b2b_credit');
                      setB2bVerify(null);
                      setB2bVerifyError(null);
                    }}
                  />
                  <span className="font-medium">
                    Firemní kredit <span className="text-xs text-muted-foreground">— B2B účet</span>
                  </span>
                </label>
              </div>

              {paymentMethod === 'b2b_credit' ? (
                <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 p-3 space-y-2">
                  <label className="block text-xs font-medium text-blue-900">
                    Kód firemního účtu
                    <Input
                      className="mt-1 uppercase font-mono"
                      value={b2bAccountCode}
                      onChange={(e) => {
                        setB2bAccountCode(e.target.value.toUpperCase());
                        setB2bVerify(null);
                        setB2bVerifyError(null);
                      }}
                      onBlur={() => { void verifyB2bCode(); }}
                      placeholder="XXXXXXXX"
                      minLength={4}
                      maxLength={20}
                      spellCheck={false}
                    />
                  </label>
                  {b2bVerify ? (
                    <p className="text-xs text-emerald-700">
                      {b2bVerify.companyName} — kredit: {(b2bVerify.balanceHalire / 100).toLocaleString('cs-CZ')} Kč
                    </p>
                  ) : null}
                  {b2bVerifyError ? (
                    <p className="text-xs text-rose-600">{b2bVerifyError}</p>
                  ) : null}
                </div>
              ) : null}

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
                  <label
                    className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs ${paymentMethod === 'multisport' ? 'border-primary bg-primary/5' : 'bg-background'}`}
                  >
                    <input
                      type="radio"
                      name="payment"
                      value="multisport"
                      checked={paymentMethod === 'multisport'}
                      onChange={() => setPaymentMethod('multisport')}
                    />
                    <span className="font-medium">Multisport</span>
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
            {travelPackages.length > 0 ? (
              <div className="rounded-md border border-amber-300 bg-amber-50">
                <div className="flex items-center gap-2 border-b border-amber-200 px-3 py-2">
                  <span className="text-base">🏨</span>
                  <span className="text-sm font-semibold text-amber-900">Ubytování — EVENTIM.Travel (volitelné)</span>
                </div>
                <div className="space-y-2 p-3">
                  {travelPackages.map((pkg) => {
                    const selected = selectedTravelPackageId === pkg.id;
                    const totalForGuests = pkg.pricePerNightHalire * pkg.nights * travelGuests;
                    return (
                      <div
                        key={pkg.id}
                        className={`rounded-md border-2 p-3 cursor-pointer transition-colors ${selected ? 'border-amber-500 bg-amber-100' : 'border-transparent bg-white hover:border-amber-300'}`}
                        onClick={() => setSelectedTravelPackageId(selected ? null : pkg.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedTravelPackageId(selected ? null : pkg.id); }}}
                        aria-pressed={selected}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm">
                              {pkg.hotelName}{pkg.hotelStars ? ` ${'★'.repeat(pkg.hotelStars)}` : ''}
                              {pkg.hotelCity ? ` · ${pkg.hotelCity}` : ''}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {pkg.roomName}{pkg.roomBreakfastIncluded ? ' · snídaně ✓' : ''}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              📅 {pkg.checkinDate} → {pkg.checkoutDate} ({pkg.nights} nocí)
                            </p>
                            {pkg.availableCount !== null && pkg.availableCount <= 5 ? (
                              <p className="text-xs font-medium text-rose-600">Zbývá jen {pkg.availableCount} míst!</p>
                            ) : null}
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">{((pkg.pricePerNightHalire) / 100).toLocaleString('cs-CZ')} Kč/noc</p>
                            <p className="font-semibold text-amber-700 text-sm">{((totalForGuests) / 100).toLocaleString('cs-CZ')} Kč</p>
                          </div>
                        </div>
                        {selected ? (
                          <div className="mt-2 flex items-center gap-3">
                            <label className="text-xs font-medium">Hosté:</label>
                            <div className="flex items-center gap-1">
                              <Button type="button" variant="outline" size="sm" disabled={travelGuests <= 1} onClick={(e) => { e.stopPropagation(); setTravelGuests((g) => Math.max(1, g - 1)); }}>−</Button>
                              <span className="w-8 text-center text-sm">{travelGuests}</span>
                              <Button type="button" variant="outline" size="sm" disabled={travelGuests >= 4} onClick={(e) => { e.stopPropagation(); setTravelGuests((g) => Math.min(4, g + 1)); }}>+</Button>
                            </div>
                            <input
                              className="flex-1 rounded-md border px-2 py-1 text-xs"
                              placeholder="Poznámka k ubytování (volitelné)"
                              value={travelNotes}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setTravelNotes(e.target.value)}
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {parkingOffers.length > 0 ? (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
                <p className="mb-2 text-sm font-semibold text-blue-900">🅿️ Parkování u akce</p>
                <div className="space-y-2">
                  {parkingOffers.map((offer) => {
                    const selected = selectedParkingOfferId === offer.id;
                    const spotsLeft = offer.capacity - offer.reserved_count;
                    const full = spotsLeft <= 0;
                    return (
                      <div
                        key={offer.id}
                        onClick={() => { if (!full) setSelectedParkingOfferId(selected ? null : offer.id); }}
                        className={`cursor-pointer rounded-md border p-2 transition-colors ${
                          selected ? 'border-blue-500 bg-blue-100' : 'border-transparent bg-white hover:border-blue-300'
                        } ${full ? 'cursor-not-allowed opacity-50' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-medium">{offer.name}</p>
                            {offer.address ? <p className="text-xs text-muted-foreground">{offer.address}</p> : null}
                            {offer.distance_meters ? (
                              <p className="text-xs text-muted-foreground">{(offer.distance_meters / 1000).toFixed(1)} km od místa</p>
                            ) : null}
                            {spotsLeft <= 5 && !full ? (
                              <p className="text-xs font-medium text-rose-600">Zbývá jen {spotsLeft} míst!</p>
                            ) : null}
                            {full ? <p className="text-xs font-medium text-rose-600">Vyprodáno</p> : null}
                          </div>
                          <p className="shrink-0 text-sm font-semibold text-blue-700">
                            {(offer.price_halire / 100).toLocaleString('cs-CZ')} Kč
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
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
            {carbonOffset ? (
              <div className="rounded-md border border-green-200 bg-green-50 p-3">
                <label className="flex cursor-pointer items-start gap-2 text-sm font-medium text-green-900">
                  <input
                    type="checkbox"
                    checked={carbonOffsetOptIn}
                    onChange={(e) => setCarbonOffsetOptIn(e.target.checked)}
                    className="mt-0.5"
                    data-testid="carbon-offset-opt-in"
                  />
                  <span>
                    <span className="block">🌱 {carbonOffset.label}</span>
                    <span className="mt-0.5 block text-xs font-normal text-green-800">
                      Dobrovolný příplatek jde celý na výsadbu stromů a ochranu lesů přes partnera Mossy Earth.
                      Nezahrnujeme do naší marže.
                    </span>
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
            {(() => {
              const qty = Math.max(1, parseInt(quantity, 10) || 1);
              const ticketTotal = (unitPriceHalire ?? 0) * qty;
              const foyerTotal = foyerMenu.reduce(
                (sum, item) => sum + (foyerItems[item.id] ?? 0) * item.priceHalire,
                0,
              );
              const programTotal = addProgram && programInfo ? programInfo.programPriceHalire : 0;
              const selectedTravel = travelPackages.find((p) => p.id === selectedTravelPackageId);
              const travelTotal = selectedTravel ? selectedTravel.pricePerNightHalire * selectedTravel.nights * travelGuests : 0;
              const carbonTotal = carbonOffset && carbonOffsetOptIn ? carbonOffset.amountHalire : 0;
              const selectedParking = parkingOffers.find((p) => p.id === selectedParkingOfferId);
              const parkingTotal = selectedParking ? selectedParking.price_halire : 0;
              const grandTotal = ticketTotal + foyerTotal + programTotal + travelTotal + carbonTotal + parkingTotal;
              if (grandTotal <= 0 || unitPriceHalire === null) return null;
              return (
                <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                  <div className="flex justify-between">
                    <span>Vstupenky ({qty} ks)</span>
                    <span>{(ticketTotal / 100).toLocaleString('cs-CZ')} Kč</span>
                  </div>
                  {foyerTotal > 0 ? (
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Foyer bar</span>
                      <span>{(foyerTotal / 100).toLocaleString('cs-CZ')} Kč</span>
                    </div>
                  ) : null}
                  {programTotal > 0 ? (
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Digitální program</span>
                      <span>{(programTotal / 100).toLocaleString('cs-CZ')} Kč</span>
                    </div>
                  ) : null}
                  {travelTotal > 0 && selectedTravel ? (
                    <div className="flex justify-between text-xs font-medium text-amber-700">
                      <span>🏨 {selectedTravel.hotelName} ({selectedTravel.nights} nocí × {travelGuests > 1 ? `${travelGuests} hosté` : '1 host'})</span>
                      <span>{(travelTotal / 100).toLocaleString('cs-CZ')} Kč</span>
                    </div>
                  ) : null}
                  {carbonTotal > 0 ? (
                    <div className="flex justify-between text-xs font-medium text-green-700">
                      <span>🌱 CO₂ offset</span>
                      <span>+{(carbonTotal / 100).toLocaleString('cs-CZ')} Kč</span>
                    </div>
                  ) : null}
                  {parkingTotal > 0 && selectedParking ? (
                    <div className="flex justify-between text-xs font-medium text-blue-700">
                      <span>🅿️ {selectedParking.name}</span>
                      <span>+{(parkingTotal / 100).toLocaleString('cs-CZ')} Kč</span>
                    </div>
                  ) : null}
                  <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
                    <span>Celkem (bez poplatků)</span>
                    <span>{(grandTotal / 100).toLocaleString('cs-CZ')} Kč</span>
                  </div>
                </div>
              );
            })()}
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

function TimedSlotInfo({ eventId, slotId }: { eventId: string; slotId: string }) {
  const [info, setInfo] = useState<{ start: string; end: string; remaining: number } | null>(null);

  const load = useCallback(async () => {
    if (!eventId || !slotId) return;
    try {
      const r = await fetch(`/api/events/${eventId}/entry-slots?date=${new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' })}`);
      const d = (await r.json()) as { days?: Array<{ slots: Array<{ id: string; start: string; end: string; remaining: number }> }> };
      const allSlots = (d.days ?? []).flatMap((day) => day.slots);
      const found = allSlots.find((s) => s.id === slotId);
      if (found) setInfo(found);
    } catch { /* ignore */ }
  }, [eventId, slotId]);

  useEffect(() => { void load(); }, [load]);

  if (!info) return null;

  const fmt = (iso: string) => new Date(iso).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Prague' });
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Prague' });

  return (
    <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
      <p className="font-semibold text-emerald-900">Časový vstup</p>
      <p className="mt-0.5 text-emerald-800">
        {fmtDate(info.start)} · {fmt(info.start)} – {fmt(info.end)}
      </p>
      <p className="mt-0.5 text-xs text-emerald-700">Zbývá {info.remaining} míst v tomto termínu</p>
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
