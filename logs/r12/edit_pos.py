# Kolo 12 / F10: pokladna česky, termín s městem, odkaz na rezervace, tisk s QR (bez TOTP tajemství na papíře).
def rw(p, pairs):
    s = open(p, encoding='utf8').read()
    for a, b in pairs:
        assert s.count(a) == 1, (p, a[:70], s.count(a))
        s = s.replace(a, b)
    open(p, 'w', encoding='utf8').write(s)

rw('src/app/api/admin/pos/events/route.ts', [
    ("  title: string;\n  date_start: string;", "  title: string;\n  date_start: string;\n  venue_city: string | null;"),
    ("    `SELECT id, title, date_start\n     FROM catalog.events", "    `SELECT id, title, date_start,\n            -- kolo 12: město — termíny jedné inscenace se v pokladně nedaly rozlišit\n            (SELECT v.city FROM catalog.venues v WHERE v.id = catalog.events.venue_id) AS venue_city\n     FROM catalog.events"),
    ("      dateStart: ev.date_start,", "      dateStart: ev.date_start,\n      venueCity: ev.venue_city,"),
])

P = 'src/app/admin/pos/page.tsx'
rw(P, [
    ("  title: string;\n  dateStart: string;\n  ticketTypes:", "  title: string;\n  dateStart: string;\n  venueCity?: string | null;\n  ticketTypes:"),
    ('        title="Pokladna (POS)"\n        description="Hotovostní/terminálový prodej u kasy. Vystaví lístek okamžitě s QR pro scanner."',
     '        title="Pokladna"\n        description="Prodej vstupenek na místě — hotově nebo kartou na terminálu. Vstupenku hned vytisknete."'),
    ("<CardDescription>Vyber představení a počet lístků.</CardDescription>", "<CardDescription>Vyberte představení, místa a způsob platby.</CardDescription>"),
    ("                      {ev.title} ({new Date(ev.dateStart).toLocaleDateString('cs-CZ')})",
     "                      {ev.title}{ev.venueCity ? ` — ${ev.venueCity}` : ''} ({new Date(ev.dateStart).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })})"),
    ('placeholder="Walk-in kupující"', 'placeholder="např. Jan Novák"'),
    ("{loading ? 'Vystavuji…' : 'Vystavit lístek'}", "{loading ? 'Vystavuji…' : 'Vystavit vstupenku'}"),
    ("{sale ? 'Lístek vystaven — vytiskni a předej kupci.' : 'Žádný prodej v této session.'}",
     "{sale ? 'Vstupenka vystavena — vytiskněte ji a předejte kupci.' : 'Zatím jste nic neprodali.'}"),
    ("""                        <span>
                          Lístek #{i + 1}: <code>{t.ticketId.slice(0, 8)}</code>
                        </span>""", """                        <span>Vstupenka č. {i + 1}</span>"""),
    ("""                <Button type="button" variant="outline" className="w-full" onClick={handlePrint}>
                  <Printer className="mr-2 h-4 w-4" aria-hidden />
                  Vytisknout / uložit jako PDF
                </Button>
                <p className="text-xs text-muted-foreground">
                  Plný PDF lístek s QR kódem dostane kupec přes mail (pokud zadáš e-mail).
                  Tady ti stačí potvrzení o vystavení a evidenci pro účetní.
                </p>""", """                {/* Kolo 12: tisk vstupenek s QR kódem (stejné jako tištěné vstupenky u vstupu); dřív window.print()
                    souhrnu s ID a TOTP tajemstvím — bez QR, tedy nepoužitelné u vstupu, a tajemství nepatří na papír */}
                <a
                  href={`/api/admin/orders/${sale.orderId}/print-labels`}
                  target="_blank"
                  rel="noopener"
                  className="flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <Printer className="mr-2 h-4 w-4" aria-hidden />
                  Vytisknout vstupenky (s QR kódem)
                </a>
                <Button type="button" variant="outline" className="w-full" onClick={handlePrint}>
                  Vytisknout doklad o prodeji
                </Button>
                <p className="text-xs text-muted-foreground">
                  Vstupenky se otevřou jako PDF — vytiskněte je na tiskárně pokladny a předejte kupci. QR kód načte obsluha u vstupu.
                </p>"""),
    ("""              <p className="font-medium">Lístek #{i + 1}</p>
              <p className="text-xs">ID: {t.ticketId}</p>
              <p className="text-xs">TOTP secret: {t.totpSecretBase32}</p>""", """              <p className="font-medium">Vstupenka č. {i + 1}</p>"""),
    ("""                Po vystavení tu uvidíš souhrn a tlačítko pro tisk.""", """                Po vystavení tu uvidíte souhrn a tlačítko pro tisk vstupenek."""),
])
print('ok')
