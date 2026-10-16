'use client';

import { useEffect, useState, type JSX } from 'react';
import { useParams } from 'next/navigation';
import { CalendarX, CalendarCheck, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface RescheduleInfo {
  originalEvent: { title: string; date: string };
  newEvent: { title: string; date: string } | null;
  offerRefund: boolean;
  responseDeadline: string | null;
  alreadyResponded: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('cs-CZ', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ReschedulePage(): JSX.Element {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [info, setInfo] = useState<RescheduleInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<'accepted' | 'refund_requested' | null>(null);

  useEffect(() => {
    void load();
  }, [token]);

  async function load(): Promise<void> {
    try {
      const res = await fetch(`/api/reschedule/${token}`, { method: 'GET' });
      if (!res.ok) {
        setError('Odkaz je neplatný nebo vypršel.');
        return;
      }
      const data = (await res.json()) as RescheduleInfo;
      setInfo(data);
    } catch {
      setError('Nepodařilo se načíst informace o přesunu.');
    } finally {
      setLoading(false);
    }
  }

  async function respond(response: 'accepted' | 'refund_requested'): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/reschedule/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        if (body.error === 'DEADLINE_PASSED') {
          setError('Lhůta pro odpověď již uplynula.');
        } else {
          setError('Nepodařilo se uložit odpověď. Zkuste to znovu.');
        }
        return;
      }
      setDone(response);
    } catch {
      setError('Chyba při odesílání odpovědi. Zkuste to znovu.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <Clock className="mx-auto mb-3 h-8 w-8 animate-pulse text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Načítám informace…</p>
        </div>
      </div>
    );
  }

  if (error && !info) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <AlertCircle className="mx-auto mb-4 h-12 w-12 text-rose-500" />
        <h1 className="mb-2 text-xl font-semibold">Odkaz není platný</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!info) return <></>;

  if (info.alreadyResponded && !done) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-emerald-500" />
        <h1 className="mb-2 text-xl font-semibold">Již jste odpověděli</h1>
        <p className="text-sm text-muted-foreground">Děkujeme, vaše odpověď byla zaregistrována.</p>
      </div>
    );
  }

  if (done === 'accepted') {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-emerald-500" />
        <h1 className="mb-2 text-xl font-semibold">Vaše vstupenka byla přenesena</h1>
        <p className="text-sm text-muted-foreground">
          Těšíme se na vás na novém termínu.
        </p>
      </div>
    );
  }

  if (done === 'refund_requested') {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-blue-500" />
        <h1 className="mb-2 text-xl font-semibold">Žádost o vrácení peněz přijata</h1>
        <p className="text-sm text-muted-foreground">
          Pořadatel vás bude kontaktovat ohledně vrácení platby.
        </p>
      </div>
    );
  }

  const deadlinePassed =
    info.responseDeadline != null && new Date(info.responseDeadline) < new Date();

  return (
    <div className="mx-auto max-w-2xl py-10">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold">Změna termínu</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pořadatel přesunul akci na nový termín. Zvolte prosím, co preferujete.
        </p>
        {info.responseDeadline && (
          <p className="mt-2 text-xs text-muted-foreground">
            Odpovězte do{' '}
            <strong className={deadlinePassed ? 'text-rose-600' : ''}>
              {formatDate(info.responseDeadline)}
            </strong>
          </p>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-2 border-rose-200 bg-rose-50/30">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <CalendarX className="h-5 w-5 text-rose-500" />
              <CardTitle className="text-base">Původní termín</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-base font-medium line-through decoration-rose-500 decoration-2 text-rose-700">
              {info.originalEvent.title}
            </p>
            <p className="mt-1 text-sm line-through decoration-rose-400 text-muted-foreground">
              {formatDate(info.originalEvent.date)}
            </p>
            <Badge variant="destructive" className="mt-3">Zrušeno</Badge>
          </CardContent>
        </Card>

        <Card className={`border-2 ${info.newEvent ? 'border-emerald-200 bg-emerald-50/30' : 'border-muted'}`}>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <CalendarCheck className={`h-5 w-5 ${info.newEvent ? 'text-emerald-500' : 'text-muted-foreground'}`} />
              <CardTitle className="text-base">Nový termín</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {info.newEvent ? (
              <>
                <p className="text-base font-medium text-emerald-800">
                  {info.newEvent.title}
                </p>
                <p className="mt-1 text-sm text-emerald-700">
                  {formatDate(info.newEvent.date)}
                </p>
                <Badge className="mt-3 bg-emerald-600 text-white hover:bg-emerald-700">
                  Nový termín
                </Badge>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Náhradní termín zatím není stanoven.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Budeme vás informovat, jakmile bude vybrán nový termín.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {!deadlinePassed ? (
        <div className="mt-8 space-y-3">
          {info.newEvent && (
            <Button
              size="lg"
              className="w-full bg-emerald-600 text-white hover:bg-emerald-700 text-base py-6"
              onClick={() => void respond('accepted')}
              disabled={submitting}
            >
              <CalendarCheck className="mr-2 h-5 w-5" />
              {submitting ? 'Ukládám…' : 'Přijmout nový termín'}
            </Button>
          )}

          {info.offerRefund && (
            <Button
              size="lg"
              variant="outline"
              className="w-full text-base py-6 border-2"
              onClick={() => void respond('refund_requested')}
              disabled={submitting}
            >
              Požádat o vrácení peněz
            </Button>
          )}

          {!info.newEvent && !info.offerRefund && (
            <p className="text-center text-sm text-muted-foreground py-4">
              O novém termínu vás budeme informovat e-mailem.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-8 rounded-md border border-amber-300 bg-amber-50 p-4 text-center text-sm text-amber-900">
          Lhůta pro odpověď uplynula. Kontaktujte prosím pořadatele přímo.
        </div>
      )}
    </div>
  );
}
