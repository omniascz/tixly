'use client';

import { useState, type JSX } from 'react';
import Link from 'next/link';
import { CheckCircle, ArrowLeft } from 'lucide-react';

const PARTNER_TYPES = [
  { value: 'media',       label: 'Média / Blog',         desc: 'Publikujete obsah o kultuře, hudbě, sportu' },
  { value: 'travel',      label: 'Cestovní portál',       desc: 'Prodáváte zájezdy nebo nabízíte tipy na výlety' },
  { value: 'ticketshop',  label: 'Pokladna / Výdejna',    desc: 'Fyzická pokladna nebo kamenný obchod' },
  { value: 'agency',      label: 'Agentura',              desc: 'Marketingová nebo PR agentura' },
  { value: 'other',       label: 'Jiné',                  desc: 'Systémová integrace, API partner, apod.' },
] as const;

export default function PartnerApplyPage(): JSX.Element {
  const [name, setName]               = useState('');
  const [email, setEmail]             = useState('');
  const [phone, setPhone]             = useState('');
  const [website, setWebsite]         = useState('');
  const [type, setType]               = useState<string>('');
  const [note, setNote]               = useState('');
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [success, setSuccess]         = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!type) { setError('Vyberte typ partnerství.'); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/partner/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, contactEmail: email, contactPhone: phone || undefined,
          websiteUrl: website || undefined, partnerType: type, applyNote: note || undefined,
        }),
      });
      if (res.status === 409) {
        const d = await res.json() as { error: string };
        if (d.error === 'ALREADY_PARTNER') { setError('Tento e-mail je již aktivním partnerem.'); return; }
        if (d.error === 'ALREADY_APPLIED') { setError('Žádost s tímto e-mailem již existuje. Brzy vás kontaktujeme.'); return; }
      }
      if (!res.ok) throw new Error('Chyba serveru');
      setSuccess(true);
    } catch {
      setError('Něco se pokazilo. Zkuste to prosím znovu nebo napište na partners@tixly.cz');
    } finally { setBusy(false); }
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0f1a] p-6">
        <div className="max-w-md text-center">
          <CheckCircle className="mx-auto mb-4 h-16 w-16 text-emerald-400" />
          <h1 className="mb-2 text-2xl font-bold text-white">Žádost odeslána</h1>
          <p className="mb-6 text-white/60">
            Děkujeme! Vaši žádost o partnerství jsme přijali. Ozveme se vám do 2 pracovních dnů na <strong className="text-white">{email}</strong>.
          </p>
          <Link href="/developer" className="text-sm text-white/50 hover:text-white">
            ← Zpět na Developer Portal
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0f1a] text-white">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Link href="/developer" className="mb-8 flex items-center gap-2 text-sm text-white/50 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Developer Portal
        </Link>

        <h1 className="mb-2 text-3xl font-bold">Stát se partnerem</h1>
        <p className="mb-10 text-white/60">
          Prodávejte vstupenky na svém webu nebo v aplikaci a získávejte provizi za každou prodanou vstupenku.
          Po schválení žádosti obdržíte API klíč a přístup do Partner portálu.
        </p>

        {/* Benefits */}
        <div className="mb-10 grid gap-3 sm:grid-cols-3">
          {[
            { label: 'Provize', value: 'od 3 %', desc: 'z každé prodané vstupenky' },
            { label: 'Platba', value: 'měsíčně', desc: 'automatický settlement' },
            { label: 'Integrace', value: 'REST API', desc: 'nebo embeddovatelný widget' },
          ].map((b) => (
            <div key={b.label} className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
              <p className="text-xl font-bold text-emerald-400">{b.value}</p>
              <p className="text-xs font-semibold uppercase text-white/60">{b.label}</p>
              <p className="text-xs text-white/40">{b.desc}</p>
            </div>
          ))}
        </div>

        <form onSubmit={(e) => void submit(e)} className="space-y-5">
          {/* Company name */}
          <div>
            <label className="mb-1 block text-sm font-medium text-white/70">Název firmy / webu <span className="text-red-400">*</span></label>
            <input
              value={name} onChange={(e) => setName(e.target.value)} required
              placeholder="GoOut.cz s.r.o."
              className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm placeholder-white/30 focus:border-white/30 focus:outline-none"
            />
          </div>

          {/* Email */}
          <div>
            <label className="mb-1 block text-sm font-medium text-white/70">Kontaktní e-mail <span className="text-red-400">*</span></label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              placeholder="jan.novak@firma.cz"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm placeholder-white/30 focus:border-white/30 focus:outline-none"
            />
          </div>

          {/* Phone + Website */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-white/70">Telefon</label>
              <input
                value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder="+420 777 123 456"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm placeholder-white/30 focus:border-white/30 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-white/70">Web</label>
              <input
                value={website} onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://www.firma.cz"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm placeholder-white/30 focus:border-white/30 focus:outline-none"
              />
            </div>
          </div>

          {/* Partner type */}
          <div>
            <label className="mb-2 block text-sm font-medium text-white/70">Typ partnerství <span className="text-red-400">*</span></label>
            <div className="grid gap-2 sm:grid-cols-2">
              {PARTNER_TYPES.map((pt) => (
                <button
                  key={pt.value} type="button"
                  onClick={() => setType(pt.value)}
                  className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                    type === pt.value
                      ? 'border-white/40 bg-white/10'
                      : 'border-white/10 bg-white/5 hover:bg-white/8'
                  }`}
                >
                  <p className="text-sm font-medium">{pt.label}</p>
                  <p className="text-xs text-white/40">{pt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Note */}
          <div>
            <label className="mb-1 block text-sm font-medium text-white/70">Jak plánujete vstupenky nabízet?</label>
            <textarea
              value={note} onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Popište váš web, aplikaci nebo kanál, kde chcete vstupenky prodávat..."
              className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm placeholder-white/30 focus:border-white/30 focus:outline-none"
            />
          </div>

          {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">{error}</p>}

          <button
            type="submit" disabled={busy}
            className="w-full rounded-lg bg-white py-3 text-sm font-semibold text-[#0a0f1a] hover:bg-white/90 disabled:opacity-50"
          >
            {busy ? 'Odesílám…' : 'Odeslat žádost'}
          </button>

          <p className="text-center text-xs text-white/30">
            Odpovídáme do 2 pracovních dnů. Dotazy na <a href="mailto:partners@tixly.cz" className="text-white/50 hover:text-white">partners@tixly.cz</a>
          </p>
        </form>
      </div>
    </div>
  );
}
