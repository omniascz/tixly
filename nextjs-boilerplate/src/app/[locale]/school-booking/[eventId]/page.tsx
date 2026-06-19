'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface EventInfo {
  id: string;
  title: string;
  date_start: string;
  venue_name: string | null;
  city: string | null;
  base_price: number | null;
}

interface BookingResult {
  bookingId: string;
  groupQrToken: string;
  totalPrice: number;
  unitPrice: number;
  studentCount: number;
  teacherCount: number;
  contactEmail: string;
}

const AGE_GROUPS = [
  { value: 'preschool', label: 'Předškolní věk (3–6 let)' },
  { value: 'primary', label: 'Základní škola (6–15 let)' },
  { value: 'secondary', label: 'Střední škola (15–18 let)' },
  { value: 'university', label: 'Vysokoškolský věk (18+)' },
  { value: 'mixed', label: 'Smíšená skupina' },
];

function formatKc(halire: number): string {
  return `${Math.round(halire / 100).toLocaleString('cs-CZ')} Kč`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export default function SchoolBookingPage() {
  const params = useParams<{ eventId: string; locale: string }>();
  const eventId = params.eventId;

  const [event, setEvent] = useState<EventInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [schoolName, setSchoolName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [schoolIco, setSchoolIco] = useState('');
  const [studentCount, setStudentCount] = useState(20);
  const [teacherCount, setTeacherCount] = useState(2);
  const [ageGroup, setAgeGroup] = useState('primary');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<BookingResult | null>(null);

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/events/${eventId}/ticket-types`)
      .then((r) => r.json())
      .then((data: { ticketTypes?: Array<{ base_price: number }> }) => {
        const minPrice = data.ticketTypes?.length
          ? Math.min(...data.ticketTypes.map((t) => t.base_price))
          : null;
        setEvent((prev) => (prev ? { ...prev, base_price: minPrice } : null));
      })
      .catch(() => {});

    fetch(`/api/events/${eventId}/addons`)
      .then((r) => r.json())
      .then((data: { event?: EventInfo }) => {
        if (data.event) setEvent((prev) => ({ ...(prev ?? data.event!), ...data.event }));
      })
      .catch(() => {});

    fetch(`/api/events/${eventId}/calendar`)
      .then((r) => r.json())
      .then((data: { event?: EventInfo }) => {
        if (data.event) setEvent((prev) => ({ ...(prev ?? ({} as EventInfo)), ...data.event }));
      })
      .catch(() => {
        setLoadError(null);
      });
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/events/${eventId}/ticket-types`)
      .then((r) => r.json())
      .then((data: { ticketTypes?: Array<{ base_price: number }> }) => {
        const minPrice = data.ticketTypes?.length
          ? Math.min(...data.ticketTypes.map((t) => t.base_price))
          : null;
        fetch(`/api/cron/health`).catch(() => {});
        setEvent({
          id: eventId,
          title: '',
          date_start: '',
          venue_name: null,
          city: null,
          base_price: minPrice,
        });
      })
      .catch(() => setLoadError('Nepodařilo se načíst akci.'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!eventId) return;
    const ctrl = new AbortController();
    fetch(`/api/events/${eventId}/ticket-types`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { ticketTypes?: Array<{ base_price: number }> }) => {
        const minPrice = data.ticketTypes?.length
          ? Math.min(...data.ticketTypes.map((t) => t.base_price))
          : null;
        setEvent((prev) => ({
          id: eventId,
          title: prev?.title ?? '',
          date_start: prev?.date_start ?? '',
          venue_name: prev?.venue_name ?? null,
          city: prev?.city ?? null,
          base_price: minPrice,
        }));
      })
      .catch(() => setLoadError('Nepodařilo se načíst akci.'));
    return () => ctrl.abort();
  }, [eventId]);

  const unitPrice = event?.base_price != null ? Math.round(event.base_price * 0.75) : null;
  const totalPrice = unitPrice != null ? unitPrice * studentCount : null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/school-bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          contactName,
          contactEmail,
          schoolName,
          schoolIco: schoolIco || undefined,
          studentCount,
          teacherCount,
          ageGroup,
          notes: notes || undefined,
        }),
      });
      const data = (await res.json()) as BookingResult & { error?: string };
      if (!res.ok) {
        setSubmitError(data.error ?? 'Chyba při odesílání rezervace.');
        return;
      }
      setResult(data);
    } catch {
      setSubmitError('Síťová chyba. Zkuste to prosím znovu.');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle className="text-green-700">Rezervace odeslána</CardTitle>
            <CardDescription>
              Děkujeme! Pošleme fakturu na {result.contactEmail}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-md border bg-muted/40 p-4 space-y-1">
              <div><span className="font-medium">Počet žáků:</span> {result.studentCount}</div>
              <div><span className="font-medium">Cena na žáka:</span> {formatKc(result.unitPrice)}</div>
              <div><span className="font-medium">Celkem:</span> {formatKc(result.totalPrice)}</div>
              <div className="pt-2 text-xs text-muted-foreground break-all">
                ID rezervace: {result.bookingId}
              </div>
            </div>
            <p className="text-muted-foreground">
              Po potvrzení objednávky obdržíte na email skupinový QR kód pro vstup celé třídy.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Skupinová rezervace pro školy</h1>
        {event?.title && (
          <p className="mt-1 text-lg text-muted-foreground">{event.title}</p>
        )}
        {event?.date_start && (
          <p className="text-sm text-muted-foreground">{formatDate(event.date_start)}</p>
        )}
        {unitPrice != null && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-1.5 text-sm font-medium text-emerald-800 border border-emerald-200">
            {formatKc(unitPrice)} / žák &nbsp;·&nbsp; učitelé zdarma &nbsp;·&nbsp; 25% sleva pro školy
          </div>
        )}
        {loadError && (
          <p className="mt-2 text-sm text-rose-600">{loadError}</p>
        )}
      </div>

      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kontaktní osoba</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Jméno učitele / koordinátora *</label>
              <Input
                required
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Jana Nováková"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">E-mail *</label>
              <Input
                required
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="ucitel@skola.cz"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Škola</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Název školy *</label>
              <Input
                required
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
                placeholder="ZŠ Jana Amose Komenského"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">IČO (nepovinné)</label>
              <Input
                value={schoolIco}
                onChange={(e) => setSchoolIco(e.target.value)}
                placeholder="12345678"
                maxLength={20}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Věková skupina</label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={ageGroup}
                onChange={(e) => setAgeGroup(e.target.value)}
              >
                {AGE_GROUPS.map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Počty osob</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium">Počet žáků *</label>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 w-9 p-0 text-lg"
                  onClick={() => setStudentCount((n) => Math.max(1, n - 1))}
                >
                  −
                </Button>
                <span className="min-w-[3rem] text-center text-xl font-semibold">{studentCount}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 w-9 p-0 text-lg"
                  onClick={() => setStudentCount((n) => Math.min(2000, n + 1))}
                >
                  +
                </Button>
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">Počet doprovodných učitelů (zdarma)</label>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 w-9 p-0 text-lg"
                  onClick={() => setTeacherCount((n) => Math.max(0, n - 1))}
                >
                  −
                </Button>
                <span className="min-w-[3rem] text-center text-xl font-semibold">{teacherCount}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 w-9 p-0 text-lg"
                  onClick={() => setTeacherCount((n) => Math.min(100, n + 1))}
                >
                  +
                </Button>
              </div>
            </div>

            {unitPrice != null && totalPrice != null && (
              <div className="rounded-md border bg-muted/40 p-4 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>{studentCount} žáků × {formatKc(unitPrice)}</span>
                  <span className="font-medium">{formatKc(totalPrice)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>{teacherCount} učitel{teacherCount === 1 ? '' : teacherCount < 5 ? 'é' : 'ů'}</span>
                  <span>zdarma</span>
                </div>
                <div className="flex justify-between font-semibold border-t pt-2 mt-1">
                  <span>Celkem bez DPH</span>
                  <span className="text-base">{formatKc(totalPrice)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Poznámka</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[80px] resize-y"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Speciální požadavky, přístupnost pro vozíčkáře, alergie…"
              maxLength={1000}
            />
          </CardContent>
        </Card>

        {submitError && (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
            {submitError}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Odesláním formuláře souhlasíte s obchodními podmínkami. Rezervace je závazná po potvrzení
          fakturou. Platba převodem do 14 dnů od vystavení faktury.
        </p>

        <Button type="submit" className="w-full" size="lg" disabled={submitting}>
          {submitting ? 'Odesílám…' : 'Odeslat rezervaci a vyžádat fakturu'}
        </Button>
      </form>
    </div>
  );
}
