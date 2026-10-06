'use client';

/**
 * /admin/scanner/guide — Výukové materiály pro personál skeneru
 *
 * Krok za krokem průvodce pro obsluhu vstupů (scan staff).
 * Mobile-first, bez potřeby přihlášení pro základní čtení.
 */

import Link from 'next/link';
import { CheckCircle2, XCircle, AlertTriangle, ScanLine, WifiOff, Smartphone, HelpCircle, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const RESULT_EXAMPLES = [
  {
    color: 'emerald',
    icon: CheckCircle2,
    label: 'VSTUP POVOLEN',
    bg: 'border-emerald-300 bg-emerald-50 text-emerald-900',
    iconColor: 'text-emerald-600',
    when: 'Lístek je platný, poprvé skenován.',
    action: 'Zákazník může projít. Nic nemusíte dělat.',
  },
  {
    color: 'amber',
    icon: AlertTriangle,
    label: 'UŽ POUŽITO',
    bg: 'border-amber-300 bg-amber-50 text-amber-900',
    iconColor: 'text-amber-600',
    when: 'Lístek byl skenován dříve — může to být pokus o duplikaci.',
    action: 'Zákazníka zastavte a zavolejte vedoucího. Nezapomeňte zaznamenat čas prvního použití.',
  },
  {
    color: 'rose',
    icon: XCircle,
    label: 'VSTUP ZAMÍTNUT',
    bg: 'border-rose-300 bg-rose-50 text-rose-900',
    iconColor: 'text-rose-600',
    when: 'Lístek neexistuje, byl stornován, nebo QR neplatný.',
    action: 'Zákazníka zastavte, zavolejte vedoucího. Nepouštějte dovnitř.',
  },
];

const STEPS = [
  {
    n: 1,
    title: 'Přihlaste se',
    desc: 'Otevřete scanner app na svém telefonu nebo tabletu. Přihlaste se svým přihlašovacím kódem od promotéra (e-mail + heslo).',
  },
  {
    n: 2,
    title: 'Vyberte akci, den a zónu',
    desc: 'Po přihlášení uvidíte seznam vašich akcí. Vyberte správnou akci → den → vstupní zónu (pokud je více vstupů). Toto nastavení zůstane po celou směnu.',
  },
  {
    n: 3,
    title: 'Stáhněte manifest (offline)',
    desc: 'Klikněte na tlačítko "Stáhnout manifest" — app si uloží databázi lístků. Tím funguje i bez internetu. Doporučeno stáhnout 30 minut před začátkem akce.',
  },
  {
    n: 4,
    title: 'Skenujte QR kód',
    desc: 'Namíříte kameru na QR kód zákazníkova telefonu nebo tištěného lístku. Výsledek se zobrazí okamžitě — zeleně, oranžově nebo červeně.',
  },
  {
    n: 5,
    title: 'Reagujte na výsledek',
    desc: 'Zelená = vpusťte. Oranžová nebo červená = zastavte zákazníka a zavolejte vedoucího. Nikdy nevpouštějte zákazníka s červeným nebo oranžovým výsledkem bez potvrzení.',
  },
];

const TROUBLESHOOT = [
  {
    q: 'QR kód nejde přečíst',
    a: 'Požádejte zákazníka, aby zvýšil jas displeje a minimalizoval okolní osvětlení. Pokud stále nejde, zákazník zadá ID ručně (číselný kód pod QR) do pole "Ticket ID".',
  },
  {
    q: 'App říká "Offline — synchronizuji"',
    a: 'Nemáte internet. App stále funguje offline ze staženého manifestu. Po obnovení připojení se fronta automaticky synchronizuje.',
  },
  {
    q: 'Zákazník tvrdí, že má platný lístek, ale app říká "nenalezen"',
    a: 'Ověřte, zda zákazník otevřel správnou appku nebo email. Zkontrolujte ticket ID ručně. Volejte vedoucímu — neřešte sami.',
  },
  {
    q: 'App se zasekla nebo nereaguje',
    a: 'Zavřete a restartujte browser nebo app. Manifest zůstane uložený. Offline skeny se neztratí.',
  },
  {
    q: 'Zákazník má tištěný lístek (papírový)',
    a: 'Naskenujte QR na papírovém lístku stejným způsobem jako mobilní. Funguje identicky.',
  },
];

export default function ScannerGuidePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin/scanner" className="text-sm text-primary hover:underline">
          ← Zpět na scanner
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold">Průvodce pro personál skeneru</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Přečtěte si tento průvodce před začátkem směny. Stačí 5 minut.
        </p>
      </div>

      {/* Quick Reference Card — barevné výsledky */}
      <Card className="border-2">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScanLine className="h-5 w-5" />
            Co znamenají barvy?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {RESULT_EXAMPLES.map((ex) => {
            const Icon = ex.icon;
            return (
              <div key={ex.color} className={`rounded-md border p-3 ${ex.bg}`}>
                <div className="flex items-center gap-2">
                  <Icon className={`h-5 w-5 ${ex.iconColor}`} />
                  <span className="font-bold">{ex.label}</span>
                </div>
                <p className="mt-1 text-sm">
                  <strong>Kdy:</strong> {ex.when}
                </p>
                <p className="text-sm">
                  <strong>Co dělat:</strong> {ex.action}
                </p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Krok za krokem */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Krok za krokem</h2>
        <div className="space-y-3">
          {STEPS.map((s) => (
            <div key={s.n} className="flex gap-4">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                {s.n}
              </div>
              <div>
                <div className="font-medium">{s.title}</div>
                <p className="mt-0.5 text-sm text-muted-foreground">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Offline režim */}
      <Card>
        <CardContent className="flex gap-4 p-4">
          <div className="flex-shrink-0 pt-0.5">
            <WifiOff className="h-6 w-6 text-amber-500" />
          </div>
          <div>
            <div className="font-medium">Offline provoz</div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Scanner funguje bez internetu díky staženému manifestu. Skenování se ukládá do fronty a odešle automaticky po obnovení připojení. Manifest stáhněte min. 30 minut před začátkem akce.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Mobilní přístup */}
      <Card>
        <CardContent className="flex gap-4 p-4">
          <div className="flex-shrink-0 pt-0.5">
            <Smartphone className="h-6 w-6 text-blue-500" />
          </div>
          <div>
            <div className="font-medium">Doporučené nastavení telefonu</div>
            <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
              <li>• Jas displeje na maximum</li>
              <li>• Nerušit / tichý mód</li>
              <li>• Nepřepínat mezi aplikacemi (výdrž baterie)</li>
              <li>• Power bank jako zálohu baterie</li>
              <li>• Scanner URL si uložte do oblíbených nebo na plochu</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Řešení problémů */}
      <div>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <HelpCircle className="h-5 w-5" />
          Řešení častých situací
        </h2>
        <div className="divide-y rounded-md border">
          {TROUBLESHOOT.map((t, i) => (
            <details key={i} className="group">
              <summary className="flex cursor-pointer items-center gap-2 p-4 text-sm font-medium hover:bg-muted/50">
                <ChevronRight className="h-4 w-4 flex-shrink-0 transition-transform group-open:rotate-90" />
                {t.q}
              </summary>
              <div className="border-t bg-muted/30 p-4 text-sm text-muted-foreground">
                {t.a}
              </div>
            </details>
          ))}
        </div>
      </div>

      {/* Kontakt vedoucí */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 text-sm">
          <div className="font-semibold text-primary">Zlaté pravidlo</div>
          <p className="mt-1 text-muted-foreground">
            Při jakékoliv pochybnosti <strong>zákazníka zastavte a zavolejte vedoucímu</strong>.
            Nikdy sami nerozhodujte o vstupech s oranžovým nebo červeným výsledkem.
          </p>
        </CardContent>
      </Card>

      <div className="text-center">
        <Link
          href="/admin/scanner"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <ScanLine className="h-4 w-4" />
          Otevřít scanner
        </Link>
      </div>
    </div>
  );
}
