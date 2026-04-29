'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Calendar,
  MapPin,
  Ticket,
  Image as ImageIcon,
  Shield,
  Eye,
  Layers,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  EVENT_TEMPLATES,
  TEMPLATE_LIST,
  type TemplateId,
  type EventTemplate,
} from '@/lib/events/templates';

interface Venue {
  id: string;
  name: string;
  city: string;
  capacity: number;
}

interface DayInput {
  label: string;
  startsAt: string; // datetime-local
  endsAt: string;
  notes?: string;
}

interface ZoneInput {
  name: string;
  zoneType: string;
  capacity: string;
  description?: string;
}

interface AccessSpec {
  dayIndex: number | 'all';
  zoneName: string | 'all';
  level: 'general' | 'premium' | 'vip' | 'backstage' | 'accessibility';
}

interface TicketTypeRow {
  name: string;
  priceCzk: string;
  capacity: string;
  maxPerUser: string;
  description?: string;
  access: AccessSpec[];
  // Seated mapping: zone matchuje název sektoru v venue_seating_charts.layout
  // (přesně nebo přes prefix). Bez zone = standing event (nedostane sedadla).
  zone?: string;
  isSeated?: boolean;
}

interface FormState {
  template: TemplateId;
  // Krok 2: Základ
  title: string;
  description: string;
  category: string;
  eventType: string;
  // Krok 3: Datum & místo
  dateStart: string;
  dateEnd: string;
  saleStartAt: string;
  saleEndAt: string;
  venueId: string;
  // Krok 4 (festival): Days + Zones
  days: DayInput[];
  zones: ZoneInput[];
  // Krok 5: Vstupenky + access
  ticketTypes: TicketTypeRow[];
  maxTicketsPerOrder: string;
  // Krok 6: Marketing
  coverImageUrl: string;
  // Krok 7: Pravidla
  minAge: string;
  resaleAllowed: boolean;
  // Submit
  publishImmediately: boolean;
}

interface WizardStepDef {
  id: string;
  label: string;
  icon: typeof Calendar;
  /** Některé kroky se zobrazují jen pro festival/multi-day templates. */
  templates?: TemplateId[];
}

const ALL_STEPS: WizardStepDef[] = [
  { id: 'template', label: 'Typ akce', icon: Layers },
  { id: 'basics', label: 'Základ', icon: Calendar },
  { id: 'datetime_venue', label: 'Datum & místo', icon: MapPin },
  {
    id: 'days_zones',
    label: 'Dni & zóny',
    icon: Calendar,
    templates: [
      'multi_day_festival',
      'sport_season',
      'theatre_subscription',
      'conference',
      'workshop_series',
    ],
  },
  { id: 'tickets_access', label: 'Vstupenky', icon: Ticket },
  { id: 'marketing', label: 'Marketing', icon: ImageIcon },
  { id: 'rules', label: 'Pravidla', icon: Shield },
  { id: 'review', label: 'Náhled', icon: Eye },
];

const CATEGORIES: Record<string, string> = {
  concert: 'Koncert',
  festival: 'Festival',
  theatre: 'Divadlo',
  club_party: 'Klubová party',
  sports: 'Sport',
  conference: 'Konference',
  workshop: 'Workshop',
  family: 'Rodinná akce',
  comedy: 'Komedie / Stand-up',
  other: 'Jiné',
};

const EVENT_TYPES: Record<string, string> = {
  concert: 'Koncert',
  theatre: 'Divadlo',
  sport: 'Sport',
  festival: 'Festival',
  conference: 'Konference',
  workshop: 'Workshop',
  club: 'Klub',
  family: 'Rodinné',
  online: 'Online',
  hybrid: 'Hybrid',
  other: 'Jiné',
};

const ZONE_TYPES: Record<string, string> = {
  general: 'GA / general',
  stage: 'Stage / scéna',
  vip: 'VIP',
  premium: 'Premium',
  backstage: 'Backstage',
  camping: 'Camping',
  parking: 'Parking',
  accessibility: 'Bezbariérová',
  other: 'Jiné',
};

const ACCESS_LEVELS: Record<string, string> = {
  general: 'Standard',
  premium: 'Premium',
  vip: 'VIP',
  backstage: 'Backstage',
  accessibility: 'Bezbariérový',
};

function buildFromTemplate(tpl: EventTemplate, baseDate: Date): {
  days: DayInput[];
  zones: ZoneInput[];
  ticketTypes: TicketTypeRow[];
} {
  const toLocalInput = (d: Date): string => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const days: DayInput[] = tpl.defaultDays.map((d) => {
    const start = new Date(baseDate.getTime() + d.offsetHours * 3600_000);
    const end = new Date(start.getTime() + d.durationHours * 3600_000);
    return { label: d.label, startsAt: toLocalInput(start), endsAt: toLocalInput(end) };
  });
  const zones: ZoneInput[] = tpl.defaultZones.map((z) => ({
    name: z.name,
    zoneType: z.zoneType,
    capacity: z.capacityHint ? String(z.capacityHint) : '',
  }));
  const ticketTypes: TicketTypeRow[] = tpl.defaultTicketTypes.map((t) => ({
    name: t.name,
    priceCzk: String(t.priceCzk),
    capacity: String(t.capacity),
    maxPerUser: '',
    description: t.description,
    access: [...t.accessSpec],
  }));
  return { days, zones, ticketTypes };
}

const DEFAULT_TEMPLATE: TemplateId = 'single_event';

export default function NewEventWizardPage() {
  const router = useRouter();
  const [stepIdx, setStepIdx] = useState(0);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const initialBase = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    d.setHours(18, 0, 0, 0);
    return d;
  }, []);

  const initialFromTemplate = useMemo(
    () => buildFromTemplate(EVENT_TEMPLATES[DEFAULT_TEMPLATE], initialBase),
    [initialBase],
  );

  const [form, setForm] = useState<FormState>({
    template: DEFAULT_TEMPLATE,
    title: '',
    description: '',
    category: EVENT_TEMPLATES[DEFAULT_TEMPLATE].defaultCategory,
    eventType: EVENT_TEMPLATES[DEFAULT_TEMPLATE].defaultEventType,
    dateStart: initialFromTemplate.days[0]!.startsAt,
    dateEnd:
      initialFromTemplate.days[initialFromTemplate.days.length - 1]!.endsAt,
    saleStartAt: '',
    saleEndAt: '',
    venueId: '',
    days: initialFromTemplate.days,
    zones: initialFromTemplate.zones,
    ticketTypes: initialFromTemplate.ticketTypes,
    maxTicketsPerOrder: '10',
    coverImageUrl: '',
    minAge: '',
    resaleAllowed: true,
    publishImmediately: false,
  });

  const visibleSteps = ALL_STEPS.filter(
    (s) => !s.templates || s.templates.includes(form.template),
  );
  const currentStep = visibleSteps[stepIdx]!;

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    fetch('/api/admin/venues', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.json() : { venues: [] }))
      .then((d: { venues: Venue[] }) => setVenues(d.venues ?? []))
      .catch(() => setVenues([]));
  }, []);

  function selectTemplate(id: TemplateId) {
    const tpl = EVENT_TEMPLATES[id];
    const built = buildFromTemplate(tpl, initialBase);
    setForm((f) => ({
      ...f,
      template: id,
      category: tpl.defaultCategory,
      eventType: tpl.defaultEventType,
      dateStart: built.days[0]!.startsAt,
      dateEnd: built.days[built.days.length - 1]!.endsAt,
      days: built.days,
      zones: built.zones,
      ticketTypes: built.ticketTypes,
    }));
    setError(null);
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Day management
  function updateDay(idx: number, patch: Partial<DayInput>) {
    setForm((f) => ({
      ...f,
      days: f.days.map((d, i) => (i === idx ? { ...d, ...patch } : d)),
    }));
  }
  function addDay() {
    setForm((f) => {
      const last = f.days[f.days.length - 1];
      const lastEnd = last ? new Date(last.endsAt) : new Date();
      const newStart = new Date(lastEnd.getTime() + 24 * 3600_000);
      newStart.setHours(18, 0, 0, 0);
      const newEnd = new Date(newStart.getTime() + 4 * 3600_000);
      const toLocal = (d: Date) => {
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      };
      return {
        ...f,
        days: [
          ...f.days,
          {
            label: `Den ${f.days.length + 1}`,
            startsAt: toLocal(newStart),
            endsAt: toLocal(newEnd),
          },
        ],
      };
    });
  }
  function removeDay(idx: number) {
    setForm((f) => ({
      ...f,
      days: f.days.filter((_, i) => i !== idx),
      // Adjust ticket access — odstranit reference na tento dayIndex, posunout vyšší
      ticketTypes: f.ticketTypes.map((t) => ({
        ...t,
        access: t.access
          .filter((a) => a.dayIndex !== idx)
          .map((a) =>
            typeof a.dayIndex === 'number' && a.dayIndex > idx
              ? { ...a, dayIndex: a.dayIndex - 1 }
              : a,
          ),
      })),
    }));
  }

  // Zone management
  function updateZone(idx: number, patch: Partial<ZoneInput>) {
    setForm((f) => ({
      ...f,
      zones: f.zones.map((z, i) => (i === idx ? { ...z, ...patch } : z)),
    }));
  }
  function addZone() {
    setForm((f) => ({
      ...f,
      zones: [
        ...f.zones,
        { name: `Zóna ${f.zones.length + 1}`, zoneType: 'general', capacity: '' },
      ],
    }));
  }
  function removeZone(idx: number) {
    setForm((f) => {
      const zoneName = f.zones[idx]?.name;
      return {
        ...f,
        zones: f.zones.filter((_, i) => i !== idx),
        ticketTypes: f.ticketTypes.map((t) => ({
          ...t,
          access: t.access.filter((a) => a.zoneName !== zoneName),
        })),
      };
    });
  }

  // Ticket management
  function updateTicket(idx: number, patch: Partial<TicketTypeRow>) {
    setForm((f) => ({
      ...f,
      ticketTypes: f.ticketTypes.map((t, i) => (i === idx ? { ...t, ...patch } : t)),
    }));
  }
  function addTicket() {
    setForm((f) => ({
      ...f,
      ticketTypes: [
        ...f.ticketTypes,
        {
          name: '',
          priceCzk: '0',
          capacity: '100',
          maxPerUser: '',
          access: [{ dayIndex: 'all', zoneName: 'all', level: 'general' }],
        },
      ],
    }));
  }
  function removeTicket(idx: number) {
    setForm((f) => ({
      ...f,
      ticketTypes: f.ticketTypes.filter((_, i) => i !== idx),
    }));
  }

  function toggleAccessCell(
    ticketIdx: number,
    dayIndex: number,
    zoneName: string,
    level: AccessSpec['level'],
  ) {
    setForm((f) => {
      const ticket = f.ticketTypes[ticketIdx]!;
      const existing = ticket.access.find(
        (a) => a.dayIndex === dayIndex && a.zoneName === zoneName,
      );
      let nextAccess: AccessSpec[];
      if (existing && existing.level === level) {
        // toggle off
        nextAccess = ticket.access.filter(
          (a) => !(a.dayIndex === dayIndex && a.zoneName === zoneName),
        );
      } else if (existing) {
        // change level
        nextAccess = ticket.access.map((a) =>
          a.dayIndex === dayIndex && a.zoneName === zoneName ? { ...a, level } : a,
        );
      } else {
        nextAccess = [...ticket.access, { dayIndex, zoneName, level }];
      }
      return {
        ...f,
        ticketTypes: f.ticketTypes.map((t, i) =>
          i === ticketIdx ? { ...t, access: nextAccess } : t,
        ),
      };
    });
  }

  function setWildcardAll(ticketIdx: number, level: AccessSpec['level']) {
    setForm((f) => ({
      ...f,
      ticketTypes: f.ticketTypes.map((t, i) =>
        i === ticketIdx
          ? { ...t, access: [{ dayIndex: 'all', zoneName: 'all', level }] }
          : t,
      ),
    }));
  }

  function clearAccess(ticketIdx: number) {
    setForm((f) => ({
      ...f,
      ticketTypes: f.ticketTypes.map((t, i) =>
        i === ticketIdx ? { ...t, access: [] } : t,
      ),
    }));
  }

  function getAccessLevel(
    ticket: TicketTypeRow,
    dayIndex: number,
    zoneName: string,
  ): AccessSpec['level'] | null {
    // Check exact match
    const exact = ticket.access.find(
      (a) => a.dayIndex === dayIndex && a.zoneName === zoneName,
    );
    if (exact) return exact.level;
    // Check wildcard day
    const wildDay = ticket.access.find(
      (a) => a.dayIndex === 'all' && (a.zoneName === zoneName || a.zoneName === 'all'),
    );
    if (wildDay) return wildDay.level;
    // Check wildcard zone
    const wildZone = ticket.access.find(
      (a) => a.zoneName === 'all' && a.dayIndex === dayIndex,
    );
    if (wildZone) return wildZone.level;
    return null;
  }

  function validateStep(s: WizardStepDef): string | null {
    if (s.id === 'template') {
      if (!form.template) return 'Vyber typ akce.';
    }
    if (s.id === 'basics') {
      if (form.title.trim().length < 2) return 'Vyplň název akce (min 2 znaky).';
    }
    if (s.id === 'datetime_venue') {
      if (!form.dateStart) return 'Vyplň datum začátku.';
      if (form.dateEnd && new Date(form.dateEnd) <= new Date(form.dateStart)) {
        return 'Konec akce musí být po začátku.';
      }
    }
    if (s.id === 'days_zones') {
      if (form.days.length === 0) return 'Přidej alespoň jeden den.';
      for (let i = 0; i < form.days.length; i++) {
        const d = form.days[i]!;
        if (!d.label.trim()) return `Den #${i + 1}: chybí popis.`;
        if (!d.startsAt || !d.endsAt) return `Den #${i + 1}: chybí datum.`;
        if (new Date(d.endsAt) <= new Date(d.startsAt))
          return `Den #${i + 1}: konec musí být po začátku.`;
      }
      if (form.zones.length === 0) return 'Přidej alespoň jednu zónu.';
      const zoneNames = new Set<string>();
      for (let i = 0; i < form.zones.length; i++) {
        const z = form.zones[i]!;
        if (!z.name.trim()) return `Zóna #${i + 1}: chybí název.`;
        if (zoneNames.has(z.name)) return `Zóna "${z.name}" duplicitní.`;
        zoneNames.add(z.name);
      }
    }
    if (s.id === 'tickets_access') {
      if (form.ticketTypes.length === 0) return 'Přidej alespoň jeden ticket type.';
      for (let i = 0; i < form.ticketTypes.length; i++) {
        const t = form.ticketTypes[i]!;
        if (!t.name.trim()) return `Vstupenka #${i + 1}: chybí název.`;
        if (parseFloat(t.priceCzk) < 0) return `Vstupenka #${i + 1}: cena ≥ 0.`;
        if (parseInt(t.capacity, 10) < 1) return `Vstupenka #${i + 1}: kapacita ≥ 1.`;
        if (showAccessMatrix && t.access.length === 0) {
          return `Vstupenka #${i + 1}: vyber alespoň jednu (den, zóna).`;
        }
      }
    }
    if (s.id === 'marketing') {
      if (form.coverImageUrl && !/^https?:\/\//.test(form.coverImageUrl)) {
        return 'Cover image URL musí začínat http(s):// nebo prázdné.';
      }
    }
    if (s.id === 'rules') {
      if (form.minAge && (parseInt(form.minAge, 10) < 0 || parseInt(form.minAge, 10) > 99)) {
        return 'Min věk: 0–99.';
      }
    }
    return null;
  }

  function next() {
    const err = validateStep(currentStep);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setStepIdx((i) => Math.min(visibleSteps.length - 1, i + 1));
  }
  function back() {
    setError(null);
    setStepIdx((i) => Math.max(0, i - 1));
  }

  async function handleSubmit(e: FormEvent, publish: boolean) {
    e.preventDefault();
    for (let i = 0; i < visibleSteps.length; i++) {
      const err = validateStep(visibleSteps[i]!);
      if (err) {
        setStepIdx(i);
        setError(err);
        return;
      }
    }
    setError(null);
    setSubmitting(true);
    try {
      const token = localStorage.getItem('accessToken');
      const r = await fetch('/api/admin/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          template: form.template,
          title: form.title,
          description: form.description || undefined,
          category: form.category,
          eventType: form.eventType,
          dateStart: new Date(form.dateStart).toISOString(),
          dateEnd: form.dateEnd ? new Date(form.dateEnd).toISOString() : null,
          saleStartAt: form.saleStartAt ? new Date(form.saleStartAt).toISOString() : null,
          saleEndAt: form.saleEndAt ? new Date(form.saleEndAt).toISOString() : null,
          venueId: form.venueId || null,
          days: showDaysZones
            ? form.days.map((d) => ({
                label: d.label,
                startsAt: new Date(d.startsAt).toISOString(),
                endsAt: new Date(d.endsAt).toISOString(),
                notes: d.notes,
              }))
            : undefined,
          zones: showDaysZones
            ? form.zones.map((z) => ({
                name: z.name,
                zoneType: z.zoneType,
                capacity: z.capacity ? parseInt(z.capacity, 10) : null,
                description: z.description,
              }))
            : undefined,
          ticketTypes: form.ticketTypes.map((t) => ({
            name: t.name,
            priceHalire: Math.round(parseFloat(t.priceCzk) * 100),
            capacity: parseInt(t.capacity, 10),
            maxPerUser: t.maxPerUser ? parseInt(t.maxPerUser, 10) : null,
            description: t.description,
            access: t.access.map((a) => ({
              dayIndex: a.dayIndex,
              zoneName: a.zoneName,
              level: a.level,
            })),
            zone: t.zone?.trim() ? t.zone.trim() : null,
            isSeated: Boolean(t.isSeated),
          })),
          maxTicketsPerOrder: form.maxTicketsPerOrder
            ? parseInt(form.maxTicketsPerOrder, 10)
            : null,
          coverImageUrl: form.coverImageUrl || null,
          minAge: form.minAge ? parseInt(form.minAge, 10) : null,
          resaleAllowed: form.resaleAllowed,
          publishImmediately: publish,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.message ?? d.error ?? `HTTP ${r.status}`);
        return;
      }
      router.push('/admin/events');
    } catch {
      setError('Síťová chyba');
    } finally {
      setSubmitting(false);
    }
  }

  const showDaysZones = visibleSteps.some((s) => s.id === 'days_zones');
  const showAccessMatrix = showDaysZones;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Nová akce</h1>
        <p className="text-sm text-muted-foreground">
          Krok {stepIdx + 1} z {visibleSteps.length}
        </p>
      </div>

      {/* Stepper */}
      <ol className="flex flex-wrap items-center gap-2">
        {visibleSteps.map((s, i) => {
          const Icon = s.icon;
          const isCurrent = i === stepIdx;
          const isDone = i < stepIdx;
          return (
            <li key={s.id} className="flex items-center">
              <button
                type="button"
                onClick={() => i < stepIdx && setStepIdx(i)}
                disabled={i > stepIdx}
                className={[
                  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium',
                  isCurrent
                    ? 'bg-primary text-primary-foreground'
                    : isDone
                      ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 cursor-pointer'
                      : 'bg-muted text-muted-foreground cursor-default',
                ].join(' ')}
              >
                {isDone ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                <span>{s.label}</span>
              </button>
              {i < visibleSteps.length - 1 ? (
                <span className="mx-1 text-muted-foreground">›</span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <Card>
        <CardHeader>
          <CardTitle>{currentStep.label}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {currentStep.id === 'template' ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {TEMPLATE_LIST.map((tpl) => {
                const selected = form.template === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => selectTemplate(tpl.id)}
                    className={[
                      'flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors',
                      selected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'hover:border-primary/50',
                    ].join(' ')}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{tpl.icon}</span>
                      <span className="font-medium">{tpl.label}</span>
                      {selected ? <Check className="ml-auto h-4 w-4 text-primary" /> : null}
                    </div>
                    <p className="text-xs text-muted-foreground">{tpl.description}</p>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Defaultně: {tpl.defaultDays.length}{' '}
                      {tpl.defaultDays.length === 1 ? 'termín' : 'termínů'} ·{' '}
                      {tpl.defaultZones.length}{' '}
                      {tpl.defaultZones.length === 1 ? 'zóna' : 'zón'} ·{' '}
                      {tpl.defaultTicketTypes.length} typů vstupenek
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}

          {currentStep.id === 'basics' ? (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium">Název akce *</label>
                <Input
                  value={form.title}
                  onChange={(e) => update('title', e.target.value)}
                  placeholder="Letní festival 2026"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Popis</label>
                <textarea
                  className="flex min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.description}
                  onChange={(e) => update('description', e.target.value)}
                  maxLength={5000}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {form.description.length}/5000 znaků
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium">Kategorie</label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.category}
                    onChange={(e) => update('category', e.target.value)}
                  >
                    {Object.entries(CATEGORIES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Typ akce</label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.eventType}
                    onChange={(e) => update('eventType', e.target.value)}
                  >
                    {Object.entries(EVENT_TYPES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          ) : null}

          {currentStep.id === 'datetime_venue' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium">Začátek *</label>
                  <Input
                    type="datetime-local"
                    value={form.dateStart}
                    onChange={(e) => update('dateStart', e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Konec (volit.)</label>
                  <Input
                    type="datetime-local"
                    value={form.dateEnd}
                    onChange={(e) => update('dateEnd', e.target.value)}
                  />
                </div>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="mb-2 text-xs font-medium">Prodejní okno (volitelné)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">
                      Začátek prodeje
                    </label>
                    <Input
                      type="datetime-local"
                      value={form.saleStartAt}
                      onChange={(e) => update('saleStartAt', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">
                      Konec prodeje
                    </label>
                    <Input
                      type="datetime-local"
                      value={form.saleEndAt}
                      onChange={(e) => update('saleEndAt', e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Místo</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.venueId}
                  onChange={(e) => update('venueId', e.target.value)}
                >
                  <option value="">— Online / TBD —</option>
                  {venues.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} · {v.city} · kap. {v.capacity}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : null}

          {currentStep.id === 'days_zones' ? (
            <>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Dni / termíny</h3>
                  <Button type="button" size="sm" variant="outline" onClick={addDay} className="gap-1">
                    <Plus className="h-3 w-3" /> Přidat den
                  </Button>
                </div>
                <div className="space-y-2">
                  {form.days.map((day, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 rounded-md border p-2">
                      <Input
                        className="col-span-3"
                        placeholder="Pátek"
                        value={day.label}
                        onChange={(e) => updateDay(idx, { label: e.target.value })}
                      />
                      <Input
                        className="col-span-4"
                        type="datetime-local"
                        value={day.startsAt}
                        onChange={(e) => updateDay(idx, { startsAt: e.target.value })}
                      />
                      <Input
                        className="col-span-4"
                        type="datetime-local"
                        value={day.endsAt}
                        onChange={(e) => updateDay(idx, { endsAt: e.target.value })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="col-span-1 text-rose-700 hover:bg-rose-50"
                        onClick={() => removeDay(idx)}
                        disabled={form.days.length === 1}
                        title="Odebrat den"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Zóny / sekce</h3>
                  <Button type="button" size="sm" variant="outline" onClick={addZone} className="gap-1">
                    <Plus className="h-3 w-3" /> Přidat zónu
                  </Button>
                </div>
                <div className="space-y-2">
                  {form.zones.map((zone, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 rounded-md border p-2">
                      <Input
                        className="col-span-4"
                        placeholder="Stage A"
                        value={zone.name}
                        onChange={(e) => updateZone(idx, { name: e.target.value })}
                      />
                      <select
                        className="col-span-4 flex h-10 rounded-md border border-input bg-background px-2 text-sm"
                        value={zone.zoneType}
                        onChange={(e) => updateZone(idx, { zoneType: e.target.value })}
                      >
                        {Object.entries(ZONE_TYPES).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                      <Input
                        className="col-span-3"
                        type="number"
                        min={1}
                        placeholder="Kapacita"
                        value={zone.capacity}
                        onChange={(e) => updateZone(idx, { capacity: e.target.value })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="col-span-1 text-rose-700 hover:bg-rose-50"
                        onClick={() => removeZone(idx)}
                        disabled={form.zones.length === 1}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Zóny určují, kam má vstupenka přístup. „Stage A", „VIP Lounge", „Camping" — to vše
                  jsou samostatné zóny.
                </p>
              </div>
            </>
          ) : null}

          {currentStep.id === 'tickets_access' ? (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Max. lístků v 1 objednávce
                </label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={form.maxTicketsPerOrder}
                  onChange={(e) => update('maxTicketsPerOrder', e.target.value)}
                />
              </div>

              <div className="space-y-3">
                {form.ticketTypes.map((t, idx) => (
                  <div key={idx} className="space-y-2 rounded-md border p-3">
                    <div className="grid grid-cols-12 gap-2">
                      <Input
                        className="col-span-5"
                        placeholder="Název (Standard / VIP)"
                        value={t.name}
                        onChange={(e) => updateTicket(idx, { name: e.target.value })}
                      />
                      <Input
                        className="col-span-3"
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="Cena Kč"
                        value={t.priceCzk}
                        onChange={(e) => updateTicket(idx, { priceCzk: e.target.value })}
                      />
                      <Input
                        className="col-span-2"
                        type="number"
                        min={1}
                        placeholder="Kapacita"
                        value={t.capacity}
                        onChange={(e) => updateTicket(idx, { capacity: e.target.value })}
                      />
                      <Input
                        className="col-span-1"
                        type="number"
                        min={1}
                        placeholder="Max"
                        title="Max ks na uživatele"
                        value={t.maxPerUser}
                        onChange={(e) => updateTicket(idx, { maxPerUser: e.target.value })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="col-span-1 text-rose-700 hover:bg-rose-50"
                        onClick={() => removeTicket(idx)}
                        disabled={form.ticketTypes.length === 1}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {/* Seating mapping — pro sály s active seating chart.
                        Bez zone se sedadla nezkopírují do event_seats. */}
                    <div className="mt-1 flex items-center gap-3 border-t pt-2 text-xs">
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={Boolean(t.isSeated)}
                          onChange={(e) =>
                            updateTicket(idx, { isSeated: e.target.checked })
                          }
                        />
                        <span>Sedadlo</span>
                      </label>
                      <Input
                        className="h-7 flex-1 text-xs"
                        placeholder="Sektor v sále (např. PŘÍZEMÍ, BALKON STŘED)"
                        value={t.zone ?? ''}
                        onChange={(e) => updateTicket(idx, { zone: e.target.value })}
                        disabled={!t.isSeated}
                      />
                    </div>

                    {showAccessMatrix ? (
                      <div className="mt-2 rounded bg-muted/30 p-2">
                        <div className="mb-1 flex items-center justify-between">
                          <p className="text-xs font-medium">Co tato vstupenka pokrývá:</p>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => setWildcardAll(idx, 'general')}
                              className="text-[11px] text-primary hover:underline"
                            >
                              Vše GA
                            </button>
                            <span className="text-[11px] text-muted-foreground">·</span>
                            <button
                              type="button"
                              onClick={() => setWildcardAll(idx, 'vip')}
                              className="text-[11px] text-primary hover:underline"
                            >
                              Vše VIP
                            </button>
                            <span className="text-[11px] text-muted-foreground">·</span>
                            <button
                              type="button"
                              onClick={() => clearAccess(idx)}
                              className="text-[11px] text-rose-700 hover:underline"
                            >
                              Vymazat
                            </button>
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr>
                                <th className="px-2 py-1 text-left font-normal text-muted-foreground">
                                  Den \ Zóna
                                </th>
                                {form.zones.map((z) => (
                                  <th
                                    key={z.name}
                                    className="px-2 py-1 text-center font-medium"
                                  >
                                    {z.name}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {form.days.map((day, dayIdx) => (
                                <tr key={dayIdx} className="border-t">
                                  <td className="px-2 py-1 font-medium">{day.label}</td>
                                  {form.zones.map((z) => {
                                    const level = getAccessLevel(t, dayIdx, z.name);
                                    return (
                                      <td key={z.name} className="px-1 py-1 text-center">
                                        <select
                                          value={level ?? ''}
                                          onChange={(e) => {
                                            const v = e.target.value;
                                            if (!v) {
                                              // remove this cell
                                              setForm((f) => ({
                                                ...f,
                                                ticketTypes: f.ticketTypes.map((tt, i) =>
                                                  i === idx
                                                    ? {
                                                        ...tt,
                                                        access: tt.access.filter(
                                                          (a) =>
                                                            !(
                                                              a.dayIndex === dayIdx &&
                                                              a.zoneName === z.name
                                                            ),
                                                        ),
                                                      }
                                                    : tt,
                                                ),
                                              }));
                                              return;
                                            }
                                            toggleAccessCell(
                                              idx,
                                              dayIdx,
                                              z.name,
                                              v as AccessSpec['level'],
                                            );
                                          }}
                                          className={[
                                            'h-7 w-full rounded border px-1 text-[11px]',
                                            level === 'general'
                                              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                                              : level === 'premium'
                                                ? 'border-blue-300 bg-blue-50 text-blue-900'
                                                : level === 'vip'
                                                  ? 'border-violet-300 bg-violet-50 text-violet-900'
                                                  : level === 'backstage'
                                                    ? 'border-rose-300 bg-rose-50 text-rose-900'
                                                    : 'border-input bg-background text-muted-foreground',
                                          ].join(' ')}
                                        >
                                          <option value="">—</option>
                                          {Object.entries(ACCESS_LEVELS).map(([k, v]) => (
                                            <option key={k} value={k}>
                                              {v}
                                            </option>
                                          ))}
                                        </select>
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Tip: „Vše GA" wildcard = jeden řádek místo plné matrix. Pokud je některá
                          buňka prázdná (—), kupec do ní nemá vstup.
                        </p>
                      </div>
                    ) : null}
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addTicket} className="gap-1">
                  <Plus className="h-3 w-3" /> Přidat typ vstupenky
                </Button>
              </div>
            </>
          ) : null}

          {currentStep.id === 'marketing' ? (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium">Cover image URL</label>
                <Input
                  type="url"
                  value={form.coverImageUrl}
                  onChange={(e) => update('coverImageUrl', e.target.value)}
                  placeholder="https://..."
                />
              </div>
              {form.coverImageUrl ? (
                <div className="overflow-hidden rounded-md border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={form.coverImageUrl}
                    alt="cover preview"
                    className="h-48 w-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              ) : null}
            </>
          ) : null}

          {currentStep.id === 'rules' ? (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium">Min věk (volit.)</label>
                <Input
                  type="number"
                  min={0}
                  max={99}
                  value={form.minAge}
                  onChange={(e) => update('minAge', e.target.value)}
                  placeholder="18"
                />
              </div>
              <label className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={form.resaleAllowed}
                  onChange={(e) => update('resaleAllowed', e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <strong>Povolit resale</strong>
                  <span className="block text-xs text-muted-foreground">
                    Kupec může lístek dále prodat (max za face value).
                  </span>
                </span>
              </label>
            </>
          ) : null}

          {currentStep.id === 'review' ? (
            <ReviewStep form={form} venue={venues.find((v) => v.id === form.venueId)} />
          ) : null}

          {error ? (
            <p className="rounded-md border border-destructive/50 bg-destructive/5 p-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" onClick={back} disabled={stepIdx === 0}>
          <ChevronLeft className="h-4 w-4" /> Zpět
        </Button>
        <div className="flex gap-2">
          {stepIdx < visibleSteps.length - 1 ? (
            <Button type="button" onClick={next}>
              Pokračovat <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={(e) => handleSubmit(e, false)}
                disabled={submitting}
              >
                Uložit jako koncept
              </Button>
              <Button
                type="button"
                onClick={(e) => handleSubmit(e, true)}
                disabled={submitting}
              >
                {submitting ? 'Publikuji…' : 'Publikovat'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewStep({ form, venue }: { form: FormState; venue?: Venue }) {
  const tpl = EVENT_TEMPLATES[form.template];
  const totalCapacity = form.ticketTypes.reduce(
    (s, t) => s + (parseInt(t.capacity, 10) || 0),
    0,
  );
  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 p-4">
        <div className="text-xs uppercase text-muted-foreground">
          {tpl.icon} {tpl.label}
        </div>
        <h3 className="mt-1 text-lg font-semibold">{form.title || '(bez názvu)'}</h3>
        {form.description ? (
          <p className="mt-2 text-sm">
            {form.description.slice(0, 200)}
            {form.description.length > 200 ? '…' : ''}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-md border p-3">
          <div className="text-xs uppercase text-muted-foreground">Termín</div>
          <div className="font-medium">
            {form.dateStart ? new Date(form.dateStart).toLocaleString('cs-CZ') : '—'}
          </div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs uppercase text-muted-foreground">Místo</div>
          <div className="font-medium">{venue ? venue.name : 'Online / TBD'}</div>
        </div>
      </div>

      {form.days.length > 1 ? (
        <div className="rounded-md border p-3 text-sm">
          <div className="mb-2 text-xs uppercase text-muted-foreground">
            Dni ({form.days.length})
          </div>
          <ul className="space-y-1 text-xs">
            {form.days.map((d, i) => (
              <li key={i}>
                <strong>{d.label}</strong> · {new Date(d.startsAt).toLocaleString('cs-CZ')}–
                {new Date(d.endsAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {form.zones.length > 1 ? (
        <div className="rounded-md border p-3 text-sm">
          <div className="mb-2 text-xs uppercase text-muted-foreground">
            Zóny ({form.zones.length})
          </div>
          <div className="flex flex-wrap gap-1 text-xs">
            {form.zones.map((z) => (
              <span key={z.name} className="rounded bg-slate-100 px-2 py-0.5">
                {z.name} ({z.zoneType})
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-md border p-3">
        <div className="mb-2 text-xs uppercase text-muted-foreground">
          Vstupenky ({form.ticketTypes.length})
        </div>
        <ul className="space-y-1 text-sm">
          {form.ticketTypes.map((t, i) => (
            <li key={i} className="flex justify-between">
              <span>
                {t.name} · {t.capacity} ks · {t.access.length} access entries
              </span>
              <span className="font-medium">
                {parseFloat(t.priceCzk).toLocaleString('cs-CZ')} Kč
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">
          Celkem {totalCapacity.toLocaleString('cs-CZ')} ks
        </div>
      </div>
    </div>
  );
}
