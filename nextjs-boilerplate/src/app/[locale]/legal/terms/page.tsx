import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Obchodní podmínky — Tixly',
  description: 'Pravidla pro nákup a vrácení vstupenek na platformě Tixly.',
};

export default function TermsPage({ params }: { params: { locale: string } }) {
  return (
    <article className="prose prose-sm mx-auto max-w-3xl py-8">
      <h1>Obchodní podmínky</h1>
      <p className="text-xs text-muted-foreground">
        Naposledy aktualizováno: {new Date().toLocaleDateString('cs-CZ')}
      </p>

      <h2>1. Smluvní vztah</h2>
      <p>
        Tixly je technická platforma. Kupní smlouvu na vstupenku uzavíráš{' '}
        <strong>přímo s pořadatelem akce</strong>. Tixly vystupuje jako technický
        zprostředkovatel; provize Tixly je součástí ceny.
      </p>

      <h2>2. Objednávka a platba</h2>
      <ul>
        <li>Objednávka je závazná po zaplacení.</li>
        <li>Lístek dostaneš e-mailem do několika minut po platbě (PDF s QR kódem).</li>
        <li>
          Lístek je <strong>vázán na držitele</strong> (jméno + e-mail). Přenos je
          možný přes funkci „Transfer" v detailu objednávky.
        </li>
      </ul>

      <h2>3. Vrácení a storno</h2>
      <p>
        Vstupenky na kulturní akce jsou podle § 1837 OZ <strong>vyňaty z práva na
        odstoupení od smlouvy</strong> do 14 dní. Vrácení tedy závisí na <strong>refund
        policy pořadatele</strong>, kterou najdeš v detailu akce.
      </p>
      <ul>
        <li>
          Pokud pořadatel povolil <strong>self-service refund</strong>, můžeš v rámci
          refund okna sám zrušit objednávku v detailu objednávky.
        </li>
        <li>Pokud ne, kontaktuj pořadatele přes e-mail uvedený u akce.</li>
        <li>
          Při <strong>zrušení akce ze strany pořadatele</strong> dostaneš plnou částku
          zpět do 14 dní.
        </li>
      </ul>

      <h2>4. Resale (přeprodej)</h2>
      <p>
        Pokud pořadatel resale povolí, můžeš svůj lístek prodat dál přes Tixly za
        cenu maximálně 100 % nominální hodnoty. Provize Tixly z resale je 5 %
        z prodejní ceny.
      </p>

      <h2>5. Zodpovědnost</h2>
      <ul>
        <li>
          Za <strong>obsah akce</strong> (program, výkonu umělce, technické zajištění)
          odpovídá <strong>pořadatel</strong>.
        </li>
        <li>
          Za <strong>technické fungování platformy</strong> (dostupnost, doručení
          lístku) odpovídá <strong>Tixly</strong>. SLA: 99 % uptime mimo plánované
          servisní okna.
        </li>
      </ul>

      <h2>6. Skener a vstup</h2>
      <p>
        Vstup na akci je možný pouze s platným, neznehodnoceným QR kódem. Lístek
        je platný pouze po <strong>první sken</strong> — duplicitní skeny budou
        odmítnuty. Při ztrátě/poškození QR pošli ID lístku na podporu pořadatele.
      </p>

      <h2>7. Účet a registrace</h2>
      <p>
        Pro nákup nepotřebuješ účet (guest checkout). Pro správu objednávek
        a vystavení lístku do Wallet pasu doporučujeme se registrovat. Účet
        můžeš kdykoliv smazat v{' '}
        <Link href={`/${params.locale}/profile`}>profilu</Link>.
      </p>

      <h2>8. Ochrana osobních údajů</h2>
      <p>
        Zpracování osobních údajů upravují{' '}
        <Link href={`/${params.locale}/legal/privacy`}>Zásady ochrany osobních údajů</Link>.
      </p>

      <h2>9. Rozhodné právo</h2>
      <p>
        Smlouva se řídí českým právem. Spotřebitelské spory řeší primárně Česká
        obchodní inspekce (coi.cz).
      </p>

      <p className="mt-8 text-xs text-muted-foreground">
        Toto je placeholder znění. Před produkcí poveř právníka revizí (zejména
        sekci o resale a SLA).
      </p>
    </article>
  );
}
