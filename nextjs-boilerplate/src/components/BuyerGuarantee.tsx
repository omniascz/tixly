'use client';

/**
 * BuyerGuarantee — pojmenovaný „záruka kupujícího" trust blok.
 *
 * Zabaluje existující ochrany Tixly do jednoho zákaznického slibu (jako
 * SeatGeek Buyer Guarantee / See Tickets fan protection). KAŽDÝ slib je krytý
 * reálnou funkcí platformy — nic se neslibuje navíc:
 *   1. Okamžité doručení   → lístek se vystaví hned po platbě (PDF + Wallet).
 *   2. Platný vstup        → ověřená vstupenka s rotujícím QR (TOTP) u brány.
 *   3. Shoda s objednávkou → dostaneš přesně typ/místo, které sis koupil.
 *   4. Refund při zrušení  → zruší-li pořadatel akci, vracíme peníze
 *                             (event emergency offer_refund / refund-requests).
 *
 * variant='compact' → drobný blok do checkoutu; 'full' → samostatná stránka.
 */

type Variant = 'compact' | 'full';

interface Strings {
  badge: string;
  title: string;
  intro: string;
  points: { title: string; desc: string }[];
  resale: string;
  insurance: string;
  learnMore: string;
}

const DICT: Record<string, Strings> = {
  cs: {
    badge: 'Záruka Tixly',
    title: 'Nakupuješ v bezpečí — Záruka Tixly',
    intro: 'Každý nákup na Tixly je krytý čtyřmi sliby. Stojí za nimi reálné funkce platformy, ne marketing.',
    points: [
      { title: 'Lístek hned po platbě', desc: 'Vstupenku dostaneš okamžitě e-mailem jako PDF a do Apple/Google Wallet.' },
      { title: 'Platný vstup u dveří', desc: 'Ověřená vstupenka s rotujícím QR kódem — u brány projde za 2 sekundy.' },
      { title: 'Přesně co sis objednal', desc: 'Dostaneš typ vstupenky a místo, které sis vybral — nebo nic neplatíš.' },
      { title: 'Vrácení peněz při zrušení', desc: 'Když pořadatel akci zruší, vrátíme ti zaplacenou částku zpět.' },
    ],
    resale: 'Bezpečný přeprodej jen za původní cenu (face value) — žádní překupníci.',
    insurance: 'Volitelné pojištění vstupenky pro vrácení i z osobních důvodů.',
    learnMore: 'Více o Záruce Tixly',
  },
  en: {
    badge: 'Tixly Guarantee',
    title: 'You’re covered — the Tixly Guarantee',
    intro: 'Every purchase on Tixly is backed by four promises — each one powered by a real platform feature, not marketing.',
    points: [
      { title: 'Tickets right after payment', desc: 'You get your ticket instantly by email as a PDF and in Apple/Google Wallet.' },
      { title: 'Valid entry at the door', desc: 'A verified ticket with a rotating QR code — you’re in within 2 seconds.' },
      { title: 'Exactly what you ordered', desc: 'You get the ticket type and seat you picked — or you don’t pay.' },
      { title: 'Refund if the event is cancelled', desc: 'If the organizer cancels the event, we refund what you paid.' },
    ],
    resale: 'Safe resale at face value only — no scalpers, no markups.',
    insurance: 'Optional ticket protection to get a refund for personal reasons too.',
    learnMore: 'More about the Tixly Guarantee',
  },
  sk: {
    badge: 'Záruka Tixly',
    title: 'Nakupuješ bezpečne — Záruka Tixly',
    intro: 'Každý nákup na Tixly je krytý štyrmi sľubmi. Stoja za nimi reálne funkcie platformy, nie marketing.',
    points: [
      { title: 'Lístok hneď po platbe', desc: 'Vstupenku dostaneš okamžite e-mailom ako PDF a do Apple/Google Wallet.' },
      { title: 'Platný vstup pri dverách', desc: 'Overená vstupenka s rotujúcim QR kódom — pri bráne prejdeš za 2 sekundy.' },
      { title: 'Presne to, čo si objednal', desc: 'Dostaneš typ vstupenky a miesto, ktoré si si vybral — alebo nič neplatíš.' },
      { title: 'Vrátenie peňazí pri zrušení', desc: 'Keď organizátor akciu zruší, vrátime ti zaplatenú sumu.' },
    ],
    resale: 'Bezpečný ďalší predaj len za pôvodnú cenu (face value) — žiadni prekupníci.',
    insurance: 'Voliteľné poistenie vstupenky na vrátenie aj z osobných dôvodov.',
    learnMore: 'Viac o Záruke Tixly',
  },
};

function pick(locale: string | undefined): Strings {
  return DICT[(locale ?? 'cs').slice(0, 2)] ?? DICT.en;
}

export function BuyerGuarantee({
  locale,
  variant = 'compact',
}: {
  locale?: string;
  variant?: Variant;
}): React.JSX.Element {
  const t = pick(locale);

  if (variant === 'compact') {
    return (
      <div className="rounded-md border bg-muted/30 p-3 text-xs">
        <p className="mb-1 font-semibold">🛡️ {t.badge}</p>
        <ul className="space-y-0.5 text-muted-foreground">
          {t.points.map((p) => (
            <li key={p.title}>✓ {p.title}</li>
          ))}
        </ul>
        <a
          href={`/${(locale ?? 'cs').slice(0, 2)}/buyer-guarantee`}
          className="mt-1 inline-block text-primary hover:underline"
        >
          {t.learnMore}
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="text-center">
        <h1 className="text-3xl font-bold">🛡️ {t.title}</h1>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">{t.intro}</p>
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        {t.points.map((p) => (
          <div key={p.title} className="rounded-md border p-5">
            <h2 className="font-semibold">✓ {p.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{p.desc}</p>
          </div>
        ))}
      </section>
      <section className="rounded-md border bg-muted/30 p-5 text-sm text-muted-foreground">
        <p>• {t.resale}</p>
        <p className="mt-1">• {t.insurance}</p>
      </section>
    </div>
  );
}

export default BuyerGuarantee;
