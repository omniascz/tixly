import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Kontakt — Tixly',
  description: 'Kontaktní informace pro diváky i pořadatele Tixly.',
};

export default function ContactPage({ params }: { params: { locale: string } }) {
  return (
    <div className="mx-auto max-w-2xl space-y-8 py-10">
      <h1 className="text-3xl font-bold">Kontakt</h1>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border p-4">
          <h2 className="font-semibold">Mám problém s lístkem</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Zkus nejdřív kontaktovat pořadatele přes e-mail uvedený u akce — má
            přístup ke všem detailům objednávky.
          </p>
          <p className="mt-2 text-sm">
            Když pořadatel neodpovídá:{' '}
            <a href="mailto:podpora@tixly.cz" className="text-primary hover:underline">
              podpora@tixly.cz
            </a>
          </p>
        </div>

        <div className="rounded-md border p-4">
          <h2 className="font-semibold">Chci prodávat na Tixly</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Bez měsíčních paušálů, jen z prodaného lístku. Onboarding cca 1 den
            (KYC).
          </p>
          <p className="mt-2 text-sm">
            <Link
              href={`/${params.locale}/register-promoter`}
              className="text-primary hover:underline"
            >
              Registrace pořadatele →
            </Link>
            <br />
            <a href="mailto:obchod@tixly.cz" className="text-primary hover:underline">
              obchod@tixly.cz
            </a>
          </p>
        </div>

        <div className="rounded-md border p-4">
          <h2 className="font-semibold">GDPR a osobní údaje</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Export dat / smazání účtu řeší{' '}
            <Link
              href={`/${params.locale}/profile`}
              className="text-primary hover:underline"
            >
              profil
            </Link>
            .
          </p>
          <p className="mt-2 text-sm">
            <a href="mailto:gdpr@tixly.cz" className="text-primary hover:underline">
              gdpr@tixly.cz
            </a>
          </p>
        </div>

        <div className="rounded-md border p-4">
          <h2 className="font-semibold">Bezpečnostní hlášení</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Pokud jsi našel zranitelnost, dej nám prosím vědět. Responsible
            disclosure ocení odměnou v plné výši ceny lístku na tvoji vybranou akci.
          </p>
          <p className="mt-2 text-sm">
            <a href="mailto:security@tixly.cz" className="text-primary hover:underline">
              security@tixly.cz
            </a>
          </p>
        </div>
      </div>

      <div className="rounded-md border bg-muted/30 p-4 text-sm">
        <p className="font-medium">Fakturační údaje</p>
        <p className="mt-1 text-muted-foreground">
          Tixly s.r.o.
          <br />
          IČO: [doplníme]
          <br />
          DIČ: [doplníme]
          <br />
          Adresa: [doplníme]
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Placeholder — produkční verze doplní reálné údaje po registraci subjektu.
        </p>
      </div>
    </div>
  );
}
