'use client';

import { useEffect, useState, type JSX } from 'react';
import { useParams } from 'next/navigation';
import { Flame, Shield, ShieldCheck, Phone, Gift, EyeOff, Camera } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedFetch, TypedFetchError } from '@/lib/typed-fetch';

interface Config {
  hot_event_mode: boolean;
  max_tickets_per_buyer: number | null;
  qr_reveal_minutes_before: number;
  require_tan_validation: boolean;
  require_phone_binding: boolean;
  no_gifting_mode: boolean;
  require_photo_id: boolean;
}

export default function HotEventModePage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const [config, setConfig] = useState<Config | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    typedGet<Config>(`/api/admin/events/${eventId}/hot-mode`)
      .then(setConfig)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Chyba'));
  }, [eventId]);

  async function patch(updates: Partial<{
    hotEventMode: boolean;
    maxTicketsPerBuyer: number | null;
    qrRevealMinutesBefore: number;
    requireTanValidation: boolean;
    requirePhoneBinding: boolean;
    noGiftingMode: boolean;
    requirePhotoId: boolean;
  }>): Promise<void> {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await typedFetch(`/api/admin/events/${eventId}/hot-mode`, {
        method: 'PATCH', body: updates, throwOnError: true,
      });
      const fresh = await typedGet<Config>(`/api/admin/events/${eventId}/hot-mode`);
      setConfig(fresh);
      setSaved(true);
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

  if (!config) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title="Hot Event Mode" description="Eventim Pass-style anti-scalp arsenal pro high-demand akce (Sheeran/Beyoncé scénář)" />
        <div className="text-sm text-muted-foreground">{error ?? 'Načítám…'}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Hot Event Mode"
        description="Eventim Pass-style anti-scalp arsenal pro high-demand akce (Sheeran/Beyoncé scénář)"
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
      ) : null}
      {saved ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">Uloženo.</div>
      ) : null}

      {/* Master switch */}
      <Card className={config.hot_event_mode ? 'border-orange-400 bg-orange-50/30' : ''}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flame className={`h-5 w-5 ${config.hot_event_mode ? 'text-orange-600' : 'text-muted-foreground'}`} />
            Master switch
          </CardTitle>
          <CardDescription>
            Když zapneš, automaticky se zapnou: phone binding + TAN SMS + no-gifting (Eventim Pass parita).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => patch({ hotEventMode: !config.hot_event_mode })}
            disabled={busy}
            variant={config.hot_event_mode ? 'destructive' : 'default'}
          >
            {config.hot_event_mode ? 'Vypnout hot mode' : 'Zapnout hot mode'}
          </Button>
        </CardContent>
      </Card>

      {/* Individual toggles */}
      <Card>
        <CardHeader>
          <CardTitle>Individuální ochrany</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ToggleRow
            icon={<Shield className="h-5 w-5" />}
            label="Max lístků na kupce"
            description="Anti-scalp cap. Buyer (per e-mail + per telefon) nekoupí víc."
            on={config.max_tickets_per_buyer !== null}
            onToggle={() => patch({ maxTicketsPerBuyer: config.max_tickets_per_buyer ? null : 6 })}
            busy={busy}
            extra={config.max_tickets_per_buyer !== null ? (
              <div className="ml-9 mt-2 flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={config.max_tickets_per_buyer}
                  onChange={(e) => patch({ maxTicketsPerBuyer: Number(e.target.value) })}
                  className="w-20"
                />
                <span className="text-xs text-muted-foreground">lístků</span>
              </div>
            ) : null}
          />

          <ToggleRow
            icon={<EyeOff className="h-5 w-5" />}
            label="Skrytý QR do času akce"
            description="QR kód se v aplikaci zobrazí jen X minut před akcí. Anti-screenshot."
            on={config.qr_reveal_minutes_before > 0}
            onToggle={() => patch({ qrRevealMinutesBefore: config.qr_reveal_minutes_before > 0 ? 0 : 120 })}
            busy={busy}
            extra={config.qr_reveal_minutes_before > 0 ? (
              <div className="ml-9 mt-2 flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={43200}
                  step={30}
                  value={config.qr_reveal_minutes_before}
                  onChange={(e) => patch({ qrRevealMinutesBefore: Number(e.target.value) })}
                  className="w-24"
                />
                <span className="text-xs text-muted-foreground">minut před</span>
              </div>
            ) : null}
          />

          <ToggleRow
            icon={<ShieldCheck className="h-5 w-5" />}
            label="TAN SMS validace"
            description="Po nákupu pošle 6-digit kód na telefon, buyer ho zadá pro odemčení vstupenek."
            on={config.require_tan_validation}
            onToggle={() => patch({ requireTanValidation: !config.require_tan_validation })}
            busy={busy}
          />

          <ToggleRow
            icon={<Phone className="h-5 w-5" />}
            label="Phone-number binding"
            description="Lístek se napíše na telefonní číslo. Zobrazí se jen tomu, kdo má v profilu stejné číslo."
            on={config.require_phone_binding}
            onToggle={() => patch({ requirePhoneBinding: !config.require_phone_binding })}
            busy={busy}
          />

          <ToggleRow
            icon={<Gift className="h-5 w-5" />}
            label="Bez darování"
            description="Kupující nemůže lístek převést ani přeposlat. Musí přijít sám."
            on={config.no_gifting_mode}
            onToggle={() => patch({ noGiftingMode: !config.no_gifting_mode })}
            busy={busy}
          />

          <ToggleRow
            icon={<Camera className="h-5 w-5" />}
            label="Kontrola dokladu totožnosti"
            description="U brány obsluha požádá o doklad. Hlášení v scanner aplikaci."
            on={config.require_photo_id}
            onToggle={() => patch({ requirePhotoId: !config.require_photo_id })}
            busy={busy}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Jak to vypadá pro kupujícího</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {config.hot_event_mode || config.max_tickets_per_buyer ? (
            <p>✓ Při checkoutu uvidí cap "max {config.max_tickets_per_buyer ?? 6} lístků na jednoho zákazníka".</p>
          ) : null}
          {config.qr_reveal_minutes_before > 0 ? (
            <p>✓ QR kód se odhalí <strong>{config.qr_reveal_minutes_before} minut před akcí</strong>. Před tím vidí jen info kartu.</p>
          ) : null}
          {config.require_tan_validation ? (
            <p>✓ Po platbě dostane <strong>6-digit SMS kód</strong>. Bez něj se lístky nezobrazí.</p>
          ) : null}
          {config.require_phone_binding ? (
            <p>✓ Lístek je vázaný na telefonní číslo zadané při koupi. Změna jen přes podporu (14 dní review).</p>
          ) : null}
          {config.no_gifting_mode ? (
            <p>✓ <strong>Nelze přeposlat ani darovat</strong>. Kupující musí být na akci osobně.</p>
          ) : null}
          {config.require_photo_id ? (
            <p>✓ U brány kontrola dokladu (jméno na lístku = jméno na dokladu).</p>
          ) : null}
          {!config.hot_event_mode &&
           !config.max_tickets_per_buyer &&
           config.qr_reveal_minutes_before === 0 &&
           !config.require_tan_validation &&
           !config.require_phone_binding &&
           !config.no_gifting_mode &&
           !config.require_photo_id ? (
            <p className="text-muted-foreground">Žádné dodatečné restrikce. Standardní prodej.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function ToggleRow({
  icon, label, description, on, onToggle, busy, extra,
}: {
  icon: JSX.Element;
  label: string;
  description: string;
  on: boolean;
  onToggle: () => void;
  busy: boolean;
  extra?: JSX.Element | null;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={on ? 'text-emerald-600' : 'text-muted-foreground'}>{icon}</div>
          <div>
            <p className="font-medium">{label}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          disabled={busy}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
            on ? 'bg-emerald-600' : 'bg-slate-300'
          }`}
          aria-label={on ? 'Vypnout' : 'Zapnout'}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
            on ? 'translate-x-6' : 'translate-x-1'
          }`} />
        </button>
      </div>
      {extra}
    </div>
  );
}
