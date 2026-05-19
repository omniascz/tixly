import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'O Tixly',
  description: 'Tixly je česká platforma pro prodej vstupenek na divadelní, hudební a sportovní akce.',
};

export default function AboutPage({ params }: { params: { locale: string } }) {
  return (
    <div className="mx-auto max-w-3xl space-y-8 py-10">
      <section className="text-center">
        <h1 className="text-4xl font-bold">O Tixly</h1>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          Vstupenky bez složitostí — pro diváky i pořadatele.
        </p>
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-md border p-5">
          <h2 className="font-semibold">Pro diváky</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            <li>• Lístek v mobilu — Apple/Google Wallet</li>
            <li>• Bezpečný resale (přeprodej) za fair cenu</li>
            <li>• Self-service vrácení do refund okna</li>
            <li>• Permanentky a předplatné na celou sezónu</li>
          </ul>
        </div>
        <div className="rounded-md border p-5">
          <h2 className="font-semibold">Pro pořadatele</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            <li>• Bez měsíčních paušálů, jen z prodaného</li>
            <li>• POS pokladna, scanner s offline režimem</li>
            <li>• Newsletter, předprodejní okna, promo kódy</li>
            <li>• Měsíční CSV pro účetní s DPH rozpisem</li>
          </ul>
        </div>
      </section>

      <section className="rounded-md border bg-muted/30 p-6 text-center">
        <h2 className="text-xl font-semibold">Jak to funguje</h2>
        <ol className="mx-auto mt-3 max-w-md space-y-2 text-left text-sm">
          <li><strong>1.</strong> Pořadatel vystaví akci v admin panelu.</li>
          <li><strong>2.</strong> Divák si na <code>tixly.cz</code> vybere lístek a zaplatí.</li>
          <li><strong>3.</strong> Lístek se okamžitě objeví v mailu jako PDF + Wallet pas.</li>
          <li><strong>4.</strong> U dveří se skenuje QR — vstup za 2 sekundy.</li>
          <li>
            <strong>5.</strong> Po skončení akce dostane pořadatel měsíční výplatu
            na účet.
          </li>
        </ol>
      </section>

      <section className="text-center">
        <h2 className="text-xl font-semibold">Můžeme ti pomoct?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          <Link
            href={`/${params.locale}/contact`}
            className="text-primary hover:underline"
          >
            Napiš nám
          </Link>{' '}
          nebo se podívej na{' '}
          <Link
            href={`/${params.locale}/legal/terms`}
            className="text-primary hover:underline"
          >
            obchodní podmínky
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
