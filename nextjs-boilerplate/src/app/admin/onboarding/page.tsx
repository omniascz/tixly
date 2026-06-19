'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

interface TicketTypeRow {
  name: string;
  priceKc: string;
  quantity: string;
  description: string;
}

interface WizardData {
  name: string;
  phone: string;
  website: string;
  description: string;
  logoUrl: string;
  pressEmail: string;

  venueName: string;
  capacity: string;
  venueType: 'seated' | 'standing' | 'mixed';
  address: string;
  venueId: string;

  productionTitle: string;
  author: string;
  director: string;
  genre: string;
  prodDescription: string;
  posterUrl: string;
  productionId: string;

  dateStart: string;
  durationMinutes: string;
  intermissionMinutes: string;
  eventId: string;

  ticketTypes: TicketTypeRow[];

  iban: string;
  bankName: string;

  teamEmails: string;
}

const DEFAULT_TICKET_TYPES: TicketTypeRow[] = [
  { name: 'Plné vstupné', priceKc: '400', quantity: '100', description: '' },
  { name: 'Snížené', priceKc: '200', quantity: '50', description: '' },
  { name: 'Student', priceKc: '150', quantity: '30', description: '' },
];

const STEPS = [
  { num: 1, label: 'Vaše divadlo', icon: '🎭', skippable: false },
  { num: 2, label: 'Váš sál', icon: '🏛️', skippable: false },
  { num: 3, label: 'První inscenace', icon: '🎬', skippable: false },
  { num: 4, label: 'První termín', icon: '📅', skippable: false },
  { num: 5, label: 'Ceny vstupenek', icon: '💰', skippable: false },
  { num: 6, label: 'Bankovní účet', icon: '🏦', skippable: true },
  { num: 7, label: 'Váš tým', icon: '👥', skippable: true },
];

const GENRES = [
  { value: 'drama', label: 'Drama' },
  { value: 'komedie', label: 'Komedie' },
  { value: 'muzikál', label: 'Muzikál' },
  { value: 'opera', label: 'Opera' },
  { value: 'pro_deti', label: 'Pro děti' },
  { value: 'balet', label: 'Balet' },
  { value: 'jiné', label: 'Jiné' },
];

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="mb-1 block text-sm font-medium text-foreground">
      {children}
      {required && <span className="ml-1 text-rose-500">*</span>}
    </label>
  );
}

function TipBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
      {children}
    </div>
  );
}

export default function OnboardingWizardPage() {
  const [step, setStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const confettiRef = useRef<HTMLDivElement>(null);

  const [data, setData] = useState<WizardData>({
    name: '',
    phone: '',
    website: '',
    description: '',
    logoUrl: '',
    pressEmail: '',
    venueName: '',
    capacity: '',
    venueType: 'seated',
    address: '',
    venueId: '',
    productionTitle: '',
    author: '',
    director: '',
    genre: '',
    prodDescription: '',
    posterUrl: '',
    productionId: '',
    dateStart: '',
    durationMinutes: '90',
    intermissionMinutes: '',
    eventId: '',
    ticketTypes: DEFAULT_TICKET_TYPES,
    iban: '',
    bankName: '',
    teamEmails: '',
  });

  useEffect(() => {
    void loadOnboarding();
    async function loadOnboarding() {
      try {
        const res = await authFetch('/api/admin/onboarding');
        if (!res.ok) { setInitialLoading(false); return; }
        const d = await res.json() as {
          current_step?: number;
          completed_steps?: number[];
          step_data?: Record<string, unknown>;
          onboarding_done?: boolean;
          name?: string;
          phone?: string;
          website?: string;
          description?: string;
          logo_url?: string;
          press_email?: string;
          iban?: string;
          bank_name?: string;
        };

        if (d.onboarding_done) { setDone(true); setInitialLoading(false); return; }

        const cs = d.completed_steps ?? [];
        setCompletedSteps(cs);
        const resumeStep = Math.min((d.current_step ?? 1), 7);
        setStep(resumeStep);

        const sd = (d.step_data ?? {}) as Record<string, Record<string, unknown>>;

        setData((prev) => ({
          ...prev,
          name: (d.name as string) || '',
          phone: (d.phone as string) || '',
          website: (d.website as string) || '',
          description: (d.description as string) || '',
          logoUrl: (d.logo_url as string) || '',
          pressEmail: (d.press_email as string) || '',
          iban: (d.iban as string) || '',
          bankName: (d.bank_name as string) || '',
          venueId: (sd.step2?.venueId as string) || '',
          venueName: (sd.step2?.venueName as string) || '',
          capacity: String(sd.step2?.capacity || ''),
          venueType: (sd.step2?.venueType as 'seated' | 'standing' | 'mixed') || 'seated',
          address: (sd.step2?.address as string) || '',
          productionId: (sd.step3?.productionId as string) || '',
          productionTitle: (sd.step3?.productionTitle as string) || '',
          author: (sd.step3?.author as string) || '',
          director: (sd.step3?.director as string) || '',
          genre: (sd.step3?.genre as string) || '',
          prodDescription: (sd.step3?.description as string) || '',
          posterUrl: (sd.step3?.posterUrl as string) || '',
          eventId: (sd.step4?.eventId as string) || '',
          dateStart: (sd.step4?.dateStart as string) || '',
          durationMinutes: String(sd.step4?.durationMinutes || '90'),
          intermissionMinutes: String(sd.step4?.intermissionMinutes || ''),
        }));
      } finally {
        setInitialLoading(false);
      }
    }
  }, []);

  const set = useCallback(<K extends keyof WizardData>(key: K, value: WizardData[K]) => {
    setData((prev) => ({ ...prev, [key]: value }));
  }, []);

  async function submitStep(stepNum: number, payload: Record<string, unknown>) {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/admin/onboarding/step/${stepNum}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const json = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        setError((json.error as string) || 'Chyba při ukládání');
        return null;
      }
      setCompletedSteps((prev) => Array.from(new Set([...prev, stepNum])));
      return json;
    } catch {
      setError('Síťová chyba');
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function handleNext() {
    setError(null);

    if (step === 1) {
      if (!data.name.trim() || !data.phone.trim()) {
        setError('Název divadla a telefon jsou povinné.');
        return;
      }
      const r = await submitStep(1, {
        name: data.name, phone: data.phone, website: data.website,
        description: data.description, logoUrl: data.logoUrl, pressEmail: data.pressEmail,
      });
      if (!r) return;
      setStep(2);
    } else if (step === 2) {
      if (!data.venueName.trim() || !data.capacity) {
        setError('Název sálu a kapacita jsou povinné.');
        return;
      }
      const r = await submitStep(2, {
        venueName: data.venueName, capacity: parseInt(data.capacity, 10),
        venueType: data.venueType, address: data.address,
      });
      if (!r) return;
      if (r.venueId) set('venueId', r.venueId as string);
      setStep(3);
    } else if (step === 3) {
      if (!data.productionTitle.trim() || !data.genre) {
        setError('Název hry a žánr jsou povinné.');
        return;
      }
      const r = await submitStep(3, {
        productionTitle: data.productionTitle, author: data.author,
        director: data.director, genre: data.genre,
        description: data.prodDescription, posterUrl: data.posterUrl,
      });
      if (!r) return;
      if (r.productionId) set('productionId', r.productionId as string);
      setStep(4);
    } else if (step === 4) {
      if (!data.dateStart) {
        setError('Datum a čas představení jsou povinné.');
        return;
      }
      const prodId = data.productionId;
      const venueId = data.venueId;
      if (!prodId || !venueId) {
        setError('Nejprve dokončete kroky 2 a 3.');
        return;
      }
      const r = await submitStep(4, {
        productionId: prodId, venueId,
        dateStart: data.dateStart,
        durationMinutes: data.durationMinutes ? parseInt(data.durationMinutes, 10) : 90,
        intermissionMinutes: data.intermissionMinutes ? parseInt(data.intermissionMinutes, 10) : undefined,
      });
      if (!r) return;
      if (r.eventId) set('eventId', r.eventId as string);
      setStep(5);
    } else if (step === 5) {
      const eventId = data.eventId;
      if (!eventId) {
        setError('Nejprve dokončete krok 4.');
        return;
      }
      const ticketTypes = data.ticketTypes.filter((t) => t.name.trim() && t.priceKc && t.quantity);
      if (ticketTypes.length === 0) {
        setError('Přidejte alespoň jeden typ vstupenky.');
        return;
      }
      const r = await submitStep(5, {
        eventId,
        ticketTypes: ticketTypes.map((t) => ({
          name: t.name,
          priceHalire: Math.round(parseFloat(t.priceKc) * 100),
          quantity: parseInt(t.quantity, 10),
          description: t.description || undefined,
        })),
      });
      if (!r) return;
      setStep(6);
    } else if (step === 6) {
      if (!data.iban.trim()) {
        setError('IBAN je povinný. Nebo přeskočte tento krok.');
        return;
      }
      const r = await submitStep(6, { iban: data.iban, bankName: data.bankName });
      if (!r) return;
      setStep(7);
    } else if (step === 7) {
      const emails = data.teamEmails
        .split(/[\n,;]+/)
        .map((e) => e.trim())
        .filter((e) => e.includes('@'));
      await submitStep(7, { emails });
      await finishOnboarding();
    }
  }

  async function handleSkip() {
    if (step === 6) {
      await authFetch(`/api/admin/onboarding/step/6`, {
        method: 'POST',
        body: JSON.stringify({ skip: true, iban: '' }),
      });
      setCompletedSteps((prev) => Array.from(new Set([...prev, 6])));
      setStep(7);
    } else if (step === 7) {
      await finishOnboarding();
    }
  }

  async function finishOnboarding() {
    setLoading(true);
    try {
      await authFetch('/api/admin/onboarding', {
        method: 'POST',
        body: JSON.stringify({ action: 'complete' }),
      });
      setDone(true);
    } finally {
      setLoading(false);
    }
  }

  function handleBack() {
    if (step > 1) setStep(step - 1);
  }

  const progress = Math.round(((completedSteps.length) / 7) * 100);

  if (initialLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Načítání…</p>
      </div>
    );
  }

  if (done) {
    return <CompletionScreen data={data} confettiRef={confettiRef} />;
  }

  const currentStepInfo = STEPS[step - 1];

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-slate-50 to-white">
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(-100px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        .confetti-piece {
          position: fixed;
          width: 10px;
          height: 10px;
          animation: confetti-fall linear forwards;
        }
      `}</style>

      <div className="sticky top-0 z-10 border-b bg-white/90 px-6 py-3 shadow-sm backdrop-blur">
        <div className="mx-auto max-w-4xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">Nastavení divadla</span>
            <span className="text-sm text-muted-foreground">{progress} % hotovo</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-3 flex gap-1 overflow-x-auto">
            {STEPS.map((s) => {
              const isDone = completedSteps.includes(s.num);
              const isCurrent = s.num === step;
              return (
                <div
                  key={s.num}
                  className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-md px-1 py-1 text-center transition
                    ${isCurrent ? 'bg-primary/10 ring-1 ring-primary' : ''}
                    ${isDone ? 'opacity-70' : ''}
                  `}
                >
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold
                      ${isDone ? 'bg-emerald-500 text-white' : isCurrent ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}
                    `}
                  >
                    {isDone ? '✓' : s.num}
                  </div>
                  <span className={`hidden text-[10px] leading-tight sm:block ${isCurrent ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-1">
        <aside className="hidden w-56 shrink-0 border-r bg-white/60 py-8 pl-6 pr-4 lg:block">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Kroky</p>
          {STEPS.map((s) => {
            const isDone = completedSteps.includes(s.num);
            const isCurrent = s.num === step;
            return (
              <div
                key={s.num}
                className={`mb-1 flex items-center gap-2 rounded-md px-3 py-2 text-sm
                  ${isCurrent ? 'bg-primary/10 font-semibold text-primary' : isDone ? 'text-muted-foreground' : 'text-foreground'}
                `}
              >
                <div
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs
                    ${isDone ? 'bg-emerald-500 text-white' : isCurrent ? 'bg-primary text-primary-foreground' : 'border border-muted-foreground/40 text-muted-foreground'}
                  `}
                >
                  {isDone ? '✓' : s.num}
                </div>
                <span className="truncate">{s.label}</span>
              </div>
            );
          })}
        </aside>

        <main className="flex-1 overflow-y-auto px-4 py-8 sm:px-8">
          <div className="mx-auto max-w-xl">
            <div className="mb-6 flex items-center gap-3">
              <span className="text-3xl">{currentStepInfo.icon}</span>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Krok {step} z 7</p>
                <h1 className="text-2xl font-bold">{currentStepInfo.label}</h1>
              </div>
            </div>

            {error && (
              <div className="mb-4 rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                {error}
              </div>
            )}

            {step === 1 && (
              <Step1 data={data} set={set} />
            )}
            {step === 2 && (
              <Step2 data={data} set={set} />
            )}
            {step === 3 && (
              <Step3 data={data} set={set} />
            )}
            {step === 4 && (
              <Step4 data={data} set={set} />
            )}
            {step === 5 && (
              <Step5 data={data} set={set} />
            )}
            {step === 6 && (
              <Step6 data={data} set={set} />
            )}
            {step === 7 && (
              <Step7 data={data} set={set} />
            )}

            <div className="mt-8 flex items-center justify-between gap-3">
              <Button
                variant="outline"
                onClick={handleBack}
                disabled={step === 1 || loading}
              >
                Zpět
              </Button>

              <div className="flex items-center gap-3">
                {currentStepInfo.skippable && (
                  <button
                    type="button"
                    onClick={handleSkip}
                    disabled={loading}
                    className="text-sm text-muted-foreground underline hover:text-foreground"
                  >
                    Přeskočit tento krok
                  </button>
                )}
                <Button onClick={handleNext} disabled={loading}>
                  {loading ? 'Ukládám…' : step === 7 ? 'Dokončit' : 'Pokračovat →'}
                </Button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function Step1({ data, set }: { data: WizardData; set: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void }) {
  return (
    <div className="space-y-5">
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
        Vítejte v Tixly! Nastavení zabere asi 10 minut.
      </p>

      <div>
        <FieldLabel required>Název divadla</FieldLabel>
        <Input value={data.name} onChange={(e) => set('name', e.target.value)} placeholder="Divadlo Na Zábradlí" />
      </div>
      <div>
        <FieldLabel required>Telefon</FieldLabel>
        <Input value={data.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+420 222 111 222" type="tel" />
      </div>
      <div>
        <FieldLabel>Webová stránka</FieldLabel>
        <Input value={data.website} onChange={(e) => set('website', e.target.value)} placeholder="https://nazabradli.cz" type="url" />
      </div>
      <div>
        <FieldLabel>Krátký popis</FieldLabel>
        <Textarea value={data.description} onChange={(e) => set('description', e.target.value)} placeholder="Pár vět o vašem divadle…" rows={3} />
      </div>
      <div>
        <FieldLabel>URL loga</FieldLabel>
        <Input value={data.logoUrl} onChange={(e) => set('logoUrl', e.target.value)} placeholder="https://…/logo.png" type="url" />
        {data.logoUrl && (
          <img src={data.logoUrl} alt="Logo náhled" className="mt-2 h-16 w-auto rounded border object-contain" />
        )}
      </div>
      <div>
        <FieldLabel>Press email</FieldLabel>
        <Input value={data.pressEmail} onChange={(e) => set('pressEmail', e.target.value)} placeholder="press@divadlo.cz" type="email" />
      </div>

      <TipBox>
        Tyto informace uvidí diváci na každé vstupence a na vaší veřejné stránce.
      </TipBox>
    </div>
  );
}

function Step2({ data, set }: { data: WizardData; set: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void }) {
  return (
    <div className="space-y-5">
      <div>
        <FieldLabel required>Název sálu</FieldLabel>
        <Input value={data.venueName} onChange={(e) => set('venueName', e.target.value)} placeholder="Hlavní sál" />
      </div>
      <div>
        <FieldLabel required>Kapacita (počet míst)</FieldLabel>
        <Input value={data.capacity} onChange={(e) => set('capacity', e.target.value)} placeholder="300" type="number" min="1" />
      </div>
      <div>
        <FieldLabel required>Typ sálu</FieldLabel>
        <div className="flex gap-3">
          {[
            { value: 'seated', label: 'Sedací' },
            { value: 'standing', label: 'Stání' },
            { value: 'mixed', label: 'Kombinovaný' },
          ].map((opt) => (
            <label key={opt.value} className="flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2.5 text-sm transition hover:border-primary">
              <input
                type="radio"
                name="venueType"
                value={opt.value}
                checked={data.venueType === opt.value}
                onChange={() => set('venueType', opt.value as 'seated' | 'standing' | 'mixed')}
                className="accent-primary"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>
      <div>
        <FieldLabel>Adresa sálu</FieldLabel>
        <Input value={data.address} onChange={(e) => set('address', e.target.value)} placeholder="Anenské nám. 5, Praha 1" />
      </div>

      <TipBox>
        Sedací sál umožní prodej konkrétních míst na mapě sálu — nastavíte ji v sekci Sály po dokončení průvodce.
      </TipBox>
    </div>
  );
}

function Step3({ data, set }: { data: WizardData; set: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void }) {
  return (
    <div className="space-y-5">
      <div>
        <FieldLabel required>Název hry</FieldLabel>
        <Input value={data.productionTitle} onChange={(e) => set('productionTitle', e.target.value)} placeholder="Hamlet" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel>Autor</FieldLabel>
          <Input value={data.author} onChange={(e) => set('author', e.target.value)} placeholder="William Shakespeare" />
        </div>
        <div>
          <FieldLabel>Režisér</FieldLabel>
          <Input value={data.director} onChange={(e) => set('director', e.target.value)} placeholder="Jan Novák" />
        </div>
      </div>
      <div>
        <FieldLabel required>Žánr</FieldLabel>
        <select
          value={data.genre}
          onChange={(e) => set('genre', e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Vyberte žánr…</option>
          {GENRES.map((g) => (
            <option key={g.value} value={g.value}>{g.label}</option>
          ))}
        </select>
      </div>
      <div>
        <FieldLabel>Popis inscenace</FieldLabel>
        <Textarea value={data.prodDescription} onChange={(e) => set('prodDescription', e.target.value)} placeholder="Krátký popis pro diváky…" rows={3} />
      </div>
      <div>
        <FieldLabel>URL plakátu</FieldLabel>
        <Input value={data.posterUrl} onChange={(e) => set('posterUrl', e.target.value)} placeholder="https://…/plakat.jpg" type="url" />
        {data.posterUrl && (
          <img src={data.posterUrl} alt="Plakát náhled" className="mt-2 h-32 w-auto rounded border object-contain" />
        )}
      </div>
    </div>
  );
}

function Step4({ data, set }: { data: WizardData; set: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void }) {
  return (
    <div className="space-y-5">
      {data.productionTitle && (
        <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm">
          <span className="font-medium">Inscenace:</span> {data.productionTitle}
          {data.venueName && <> &nbsp;·&nbsp; <span className="font-medium">Sál:</span> {data.venueName}</>}
        </div>
      )}

      <div>
        <FieldLabel required>Datum a čas</FieldLabel>
        <Input
          type="datetime-local"
          value={data.dateStart}
          onChange={(e) => set('dateStart', e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel>Délka představení (min)</FieldLabel>
          <Input value={data.durationMinutes} onChange={(e) => set('durationMinutes', e.target.value)} placeholder="90" type="number" min="1" />
        </div>
        <div>
          <FieldLabel>Délka přestávky (min)</FieldLabel>
          <Input value={data.intermissionMinutes} onChange={(e) => set('intermissionMinutes', e.target.value)} placeholder="15" type="number" min="0" />
        </div>
      </div>

      <TipBox>
        Termín bude zpočátku jako návrh (draft). Zveřejníte ho jedním kliknutím v sekci Představení.
      </TipBox>
    </div>
  );
}

function Step5({ data, set }: { data: WizardData; set: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void }) {
  function addRow() {
    if (data.ticketTypes.length >= 5) return;
    set('ticketTypes', [...data.ticketTypes, { name: '', priceKc: '', quantity: '', description: '' }]);
  }

  function removeRow(i: number) {
    set('ticketTypes', data.ticketTypes.filter((_, idx) => idx !== i));
  }

  function updateRow(i: number, field: keyof TicketTypeRow, value: string) {
    const updated = data.ticketTypes.map((t, idx) => idx === i ? { ...t, [field]: value } : t);
    set('ticketTypes', updated);
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Název</th>
              <th className="px-3 py-2 text-right font-medium">Cena (Kč)</th>
              <th className="px-3 py-2 text-right font-medium">Počet</th>
              <th className="w-10 px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {data.ticketTypes.map((tt, i) => (
              <tr key={i} className="border-b last:border-b-0 hover:bg-muted/20">
                <td className="px-2 py-1.5">
                  <Input
                    value={tt.name}
                    onChange={(e) => updateRow(i, 'name', e.target.value)}
                    placeholder="Plné vstupné"
                    className="h-8 text-sm"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    value={tt.priceKc}
                    onChange={(e) => updateRow(i, 'priceKc', e.target.value)}
                    placeholder="400"
                    type="number"
                    min="0"
                    className="h-8 text-right text-sm"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    value={tt.quantity}
                    onChange={(e) => updateRow(i, 'quantity', e.target.value)}
                    placeholder="100"
                    type="number"
                    min="1"
                    className="h-8 text-right text-sm"
                  />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="text-muted-foreground hover:text-rose-500"
                    title="Smazat"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.ticketTypes.length < 5 && (
        <Button variant="outline" size="sm" onClick={addRow} type="button">
          + Přidat typ
        </Button>
      )}

      <TipBox>
        Provize Tixly: 2,5–3 % z každé prodané vstupenky. Nic jiného neplatíte.
      </TipBox>
    </div>
  );
}

function Step6({ data, set }: { data: WizardData; set: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void }) {
  return (
    <div className="space-y-5">
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Na tento účet vám Tixly zasílá výtěžek z prodeje, vždy do 5 pracovních dnů po konání akce.
      </div>

      <div>
        <FieldLabel required>IBAN</FieldLabel>
        <Input value={data.iban} onChange={(e) => set('iban', e.target.value)} placeholder="CZ65 0800 0000 1920 0014 5399" />
      </div>
      <div>
        <FieldLabel>Název banky</FieldLabel>
        <Input value={data.bankName} onChange={(e) => set('bankName', e.target.value)} placeholder="Česká spořitelna" />
      </div>
    </div>
  );
}

function Step7({ data, set }: { data: WizardData; set: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void }) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Každý člen dostane email s odkazem pro přihlášení jako personál divadla. Role můžete změnit kdykoli v sekci Tým.
      </p>

      <div>
        <FieldLabel>Emaily členů týmu</FieldLabel>
        <Textarea
          value={data.teamEmails}
          onChange={(e) => set('teamEmails', e.target.value)}
          placeholder={"jan@divadlo.cz\nmarie@divadlo.cz\npokladna@divadlo.cz"}
          rows={5}
        />
        <p className="mt-1 text-xs text-muted-foreground">Každý email na nový řádek nebo oddělte čárkou.</p>
      </div>
    </div>
  );
}

function CompletionScreen({
  data,
  confettiRef,
}: {
  data: WizardData;
  confettiRef: React.RefObject<HTMLDivElement>;
}) {
  const [copied, setCopied] = useState(false);
  const shareUrl = data.eventId
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/cs/events/${data.eventId}`
    : '';

  useEffect(() => {
    const colors = ['#f44336', '#e91e63', '#9c27b0', '#3f51b5', '#2196f3', '#4caf50', '#ffeb3b', '#ff9800'];
    const pieces = Array.from({ length: 60 }, (_, i) => {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      el.style.left = `${Math.random() * 100}vw`;
      el.style.top = '0';
      el.style.backgroundColor = colors[i % colors.length];
      el.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
      el.style.animationDuration = `${1.5 + Math.random() * 2}s`;
      el.style.animationDelay = `${Math.random() * 1.5}s`;
      document.body.appendChild(el);
      return el;
    });
    const timer = setTimeout(() => pieces.forEach((el) => el.remove()), 5000);
    return () => { clearTimeout(timer); pieces.forEach((el) => el.remove()); };
  }, []);

  async function copyLink() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 to-white p-6" ref={confettiRef}>
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(-100px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        .confetti-piece {
          position: fixed;
          width: 10px;
          height: 10px;
          animation: confetti-fall linear forwards;
          pointer-events: none;
          z-index: 9999;
        }
      `}</style>

      <div className="w-full max-w-lg text-center">
        <div className="mb-4 text-5xl">🎉</div>
        <h1 className="mb-2 text-3xl font-bold">Hotovo! Vaše divadlo je připraveno.</h1>
        <p className="mb-6 text-muted-foreground">
          Vše je nastaveno. Teď stačí zveřejnit první termín a diváci mohou začít kupovat vstupenky.
        </p>

        {(data.name || data.productionTitle || data.dateStart) && (
          <div className="mb-6 rounded-xl border bg-white p-5 text-left shadow-sm">
            <h2 className="mb-3 font-semibold">Souhrn</h2>
            <dl className="space-y-2 text-sm">
              {data.name && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Divadlo</dt>
                  <dd className="font-medium">{data.name}</dd>
                </div>
              )}
              {data.venueName && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Sál</dt>
                  <dd className="font-medium">{data.venueName}</dd>
                </div>
              )}
              {data.productionTitle && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">První inscenace</dt>
                  <dd className="font-medium">{data.productionTitle}</dd>
                </div>
              )}
              {data.dateStart && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Datum premiéry</dt>
                  <dd className="font-medium">{new Date(data.dateStart).toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' })}</dd>
                </div>
              )}
              {data.ticketTypes.filter((t) => t.name && t.priceKc).length > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Ceny</dt>
                  <dd className="flex flex-wrap justify-end gap-1">
                    {data.ticketTypes.filter((t) => t.name && t.priceKc).map((t, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {t.name}: {(parseFloat(t.priceKc)).toLocaleString('cs-CZ')} Kč
                      </Badge>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        )}

        <div className="mb-6 flex flex-col gap-3">
          <Link href="/admin/events">
            <Button className="w-full" variant="default">
              Zobrazit moje představení
            </Button>
          </Link>
          {data.eventId && (
            <Link href={`/admin/events/${data.eventId}`}>
              <Button className="w-full" variant="outline">
                Zveřejnit první termín
              </Button>
            </Link>
          )}
          {data.venueId && (
            <Link href={`/admin/venues/${data.venueId}`}>
              <Button className="w-full" variant="outline">
                Nastavit mapu sálu
              </Button>
            </Link>
          )}
        </div>

        {shareUrl && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-4 py-3">
            <span className="flex-1 truncate text-sm text-muted-foreground">{shareUrl}</span>
            <Button size="sm" variant="outline" onClick={copyLink}>
              {copied ? '✓ Zkopírováno' : 'Kopírovat odkaz'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
