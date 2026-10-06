'use client';

/**
 * Kolo 12 — výsledek skenu pro obsluhu vstupu: velký barevný pruh čitelný na slunci i ve tmě, krátké heslo velkým
 * písmem, zvuk a vibrace. Obsluha kouká na příchozího, ne do telefonu — každý stav má vlastní zvuk i vibraci:
 *   ok    zelená  VSTUP POVOLEN        1 vysoké pípnutí, 1 dlouhá vibrace
 *   warn  oranžová OVĚŘTE PRŮKAZ / RUČNĚ 2 střední pípnutí, 3 krátké vibrace
 *   deny  červená NEVPOUŠTĚT / JINÝ TERMÍN / UŽ POUŽITO   2 hluboké tóny, výrazná dvojitá vibrace
 *   info  modrá   ODCHOD / UŽ NAČTENO  1 krátké pípnutí
 * (iOS Safari vibraci nepodporuje — zvuk proto hraje vždy.)
 */
import { useEffect, useState } from 'react';

export type ScanTone = 'ok' | 'warn' | 'deny' | 'info';

export interface ScanStateInput {
  result: string;
  message?: string;
  unverified?: boolean;
  direction?: 'entry' | 'exit';
  ticket?: { verifyId?: string | null; seat?: string | null } | null;
}

export function scanVerdict(r: ScanStateInput): { tone: ScanTone; headline: string } {
  if (r.result === 'admitted') {
    if (r.unverified) return { tone: 'warn', headline: 'OVĚŘTE RUČNĚ' };
    // verifyId nese celý pokyn ze serveru („Ověřit průkaz: ZTP/P")
    if (r.ticket?.verifyId) return { tone: 'warn', headline: r.ticket.verifyId };
    return { tone: 'ok', headline: r.direction === 'exit' ? 'ODCHOD' : 'VSTUP POVOLEN' };
  }
  switch (r.result) {
    case 'exited': case 'released': return { tone: 'info', headline: 'ODCHOD' };
    case 'duplicate': return { tone: 'info', headline: 'UŽ NAČTENO' };
    case 'undone': return { tone: 'info', headline: 'PRŮCHOD VZAT ZPĚT' };
    case 'wrong_event': return { tone: 'deny', headline: 'JINÝ TERMÍN' };
    case 'already_used': case 'already_redeemed_today': case 'already_inside': return { tone: 'deny', headline: 'UŽ POUŽITO' };
    case 'not_found': case 'invalid_token': return { tone: 'deny', headline: 'NEPLATNÁ VSTUPENKA' };
    case 'revoked': return { tone: 'deny', headline: 'ZRUŠENÁ VSTUPENKA' };
    case 'error': return { tone: 'deny', headline: 'CHYBA — ZKUSTE ZNOVU' };
    default: return { tone: 'deny', headline: 'NEVPOUŠTĚT' };
  }
}

const TONE_CLASS: Record<ScanTone, string> = {
  ok: 'bg-emerald-600 text-white border-emerald-800',
  warn: 'bg-amber-400 text-black border-amber-700',
  deny: 'bg-red-600 text-white border-red-900',
  info: 'bg-sky-600 text-white border-sky-900',
};
const VIBRATE: Record<ScanTone, number | number[]> = { ok: 100, warn: [100, 60, 100, 60, 100], deny: [200, 80, 200], info: 40 };
const BEEPS: Record<ScanTone, Array<[number, number]>> = {
  ok: [[880, 120]], warn: [[660, 120], [660, 120]], deny: [[220, 350], [180, 350]], info: [[520, 80]],
};

let ctx: AudioContext | null = null;
function beep(tone: ScanTone): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx ?? new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    let t = ctx.currentTime;
    for (const [freq, ms] of BEEPS[tone]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      o.type = tone === 'deny' ? 'square' : 'sine';
      g.gain.value = 0.25;
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + ms / 1000);
      t += ms / 1000 + 0.08;
    }
  } catch { /* zvuk je doplněk — bez něj skener funguje dál */ }
}

/**
 * Na mobilu panel přilepený u spodního okraje (obsluha ho vidí hned po klepnutí na „Ověřit", bez posouvání), na počítači
 * v toku stránky. Klepnutí panel zavře; zelený a modrý zmizí sám po 3 s, červený a oranžový po 8 s.
 */
export function ScanState({ result }: { result: ScanStateInput | null }): JSX.Element | null {
  const v = result ? scanVerdict(result) : null;
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(false);
    if (!v) return;
    beep(v.tone);
    try { navigator.vibrate?.(VIBRATE[v.tone]); } catch { /* */ }
    // zelený/modrý po 3 s, červený/oranžový po 8 s (obsluha mezitím řeší příchozího); klepnutím kdykoli
    const t = setTimeout(() => setHidden(true), v.tone === 'ok' || v.tone === 'info' ? 3000 : 8000);
    return () => clearTimeout(t);
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!result || !v || hidden) return null;
  return (
    <div
      role="status"
      aria-live="assertive"
      data-testid="scan-state"
      data-tone={v.tone}
      className={`fixed inset-x-2 bottom-2 z-40 cursor-pointer rounded-xl border-4 px-4 py-6 text-center shadow-2xl md:static md:cursor-default md:shadow-lg ${TONE_CLASS[v.tone]}`}
      onClick={() => setHidden(true)}
      title="Klepnutím zavřete"
    >
      <div data-testid="scan-headline" className="text-4xl font-black uppercase leading-tight tracking-wide sm:text-5xl">{v.headline}</div>
      {result.ticket?.seat ? <div className="mt-2 text-2xl font-bold">{result.ticket.seat}</div> : null}
      {result.message ? <div className="mt-2 text-base font-semibold">{result.message}</div> : null}
      <div className="mt-3 text-xs font-medium opacity-80 md:hidden">Klepnutím zavřete</div>
    </div>
  );
}
