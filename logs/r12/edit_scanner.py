# Kolo 12 / F11: skener — velké stavy, zvuk/vibrace (ScanState), výpadek sítě ověřený proti seznamu, česky, auto-ověření z kamery.
p = 'src/app/admin/scanner/page.tsx'
s = open(p, encoding='utf8').read()


def rep(a, b, n=1):
    global s
    assert s.count(a) == n, (a[:80], s.count(a))
    s = s.replace(a, b)


# typ: příznak neověřeného (offline bez seznamu) vpuštění
rep("  kind?: 'single_use' | 'multi_day_redemption' | 'entry' | 'reentry';",
    "  kind?: 'single_use' | 'multi_day_redemption' | 'entry' | 'reentry';\n  /** Kolo 12: vpuštěno bez ověření (výpadek sítě, seznam nestažen) — obsluha musí vstupenku zkontrolovat očima. */\n  unverified?: boolean;")

# vibrace řeší ScanState (i u „jiného termínu", dřív chyběla)
i = s.index("  // Haptic feedback on scan result (Vibration API — mobile browsers)")
j = s.index("  }, [result]);", i) + len("  }, [result]);")
s = s[:i] + "  // Kolo 12: zvuk a vibrace výsledku dělá <ScanState> (dřív jen vibrace a bez „jiného termínu\")." + s[j:]

# offline ověření jako funkce — používá ji větev „offline" i výpadek sítě během požadavku
rep("  async function handleSubmit(e: FormEvent) {", """  /** Ověření proti staženému seznamu (offline). Bez seznamu NEPOUŠTÍ automaticky na zelenou — obsluha ověří ručně. */
  async function offlineVerdict(payload: Record<string, unknown>, raw: string, isPrintToken: boolean, why: string): Promise<ScanResult> {
    await enqueueScan(payload as Parameters<typeof enqueueScan>[0], gateLabel);
    await refreshPending();
    const offlineTicketId = isPrintToken ? decodePrintTokenUuid(raw) ?? undefined : raw;
    let check: OfflineCheck = 'no_manifest';
    if (gate.eventId && offlineTicketId) check = await validateOffline(gate.eventId, offlineTicketId);
    if (check === 'not_found') return { result: 'not_found', message: `${why} Vstupenka NENÍ v seznamu platných — nevpouštějte.` };
    if (check === 'already_used') return { result: 'already_used', message: `${why} Vstupenka už byla na tomto zařízení odbavena.` };
    if (check === 'admitted') return { result: 'admitted', message: `${why} Ověřeno proti staženému seznamu. Po obnovení internetu se odešle.` };
    return {
      result: 'admitted', unverified: true,
      message: `${why} Vstupenku NENÍ JAK OVĚŘIT (seznam pro výpadek není stažený). Zkontrolujte na vstupence název a datum představení.`,
    };
  }

  async function handleSubmit(e?: FormEvent) {""")
rep("    e.preventDefault();\n    setLoading(true);\n    setResult(null);", "    e?.preventDefault();\n    setLoading(true);\n    setResult(null);")

i = s.index("    if (!online) {\n      try {\n        await enqueueScan(payload, gateLabel);")
j = s.index("      return;\n    }\n", i) + len("      return;\n    }\n")
s = s[:i] + """    if (!online) {
      try {
        const v = await offlineVerdict(payload, raw, isPrintToken, 'Bez internetu.');
        setResult(v);
        if (v.result === 'admitted') { setTicketId(''); setTotpCode(''); }
      } catch {
        setResult({ result: 'error', message: 'Uložení skenu v zařízení selhalo. Vstupenku zkontrolujte ručně.' });
      } finally {
        setLoading(false);
      }
      return;
    }
""" + s[j:]

i = s.index("    } catch {\n      // Síť spadla mezi click a fetch — fallback do queue")
j = s.index("    } finally {\n      setLoading(false);\n    }\n  }", i)
s = s[:i] + """    } catch {
      // Kolo 12: síť spadla během ověření — dřív se ukázalo zelené „vpuštěno" bez jakékoli kontroly.
      try {
        const v = await offlineVerdict(payload, raw, isPrintToken, 'Výpadek internetu.');
        setResult(v);
        if (v.result === 'admitted') { setTicketId(''); setTotpCode(''); }
        setOnline(false);
      } catch {
        setResult({ result: 'error', message: 'Výpadek internetu a uložení skenu selhalo. Vstupenku zkontrolujte ručně.' });
      }
""" + s[j:]

rep("""        title="Scanner"
        description="Manuální validace QR lístku. Pro festivaly nastav bránu (akce + den + zóna) a scanner bude validovat per gate.\"""",
    """        title="Kontrola vstupenek"
        description="Načtěte QR kód kamerou (nebo opište kód ze vstupenky). Zelená = pustit, oranžová = zkontrolovat, červená = nepouštět.\"""")
rep("{online ? 'Online — server validuje každý sken' : 'Offline — skeny jdou do lokální fronty'}",
    "{online ? 'Připojeno — každá vstupenka se ověřuje na serveru' : 'Bez internetu — vstupenky se ověřují podle staženého seznamu'}")
rep("<span className=\"font-semibold\">{pendingCount} čeká na sync</span>", "<span className=\"font-semibold\">{pendingCount} čeká na odeslání</span>")
rep("              Synchronizovat\n", "              Odeslat\n")
rep("""                Offline seznam: <strong className="text-foreground">{manifestMeta.count.toLocaleString('cs-CZ')}</strong>{' '}
                lístků · staženo""", """                Seznam pro výpadek internetu: <strong className="text-foreground">{manifestMeta.count.toLocaleString('cs-CZ')}</strong>{' '}
                vstupenek · staženo""")
rep("<>⚠ Offline seznam není stažený — offline sken nepůjde ověřit. Stáhni před akcí (online).</>",
    "<>⚠ Seznam pro výpadek internetu není stažený — bez internetu nepůjde vstupenky ověřit. Stáhněte ho před začátkem představení.</>")
rep("{manifestLoading ? 'Stahuji…' : manifestMeta ? 'Aktualizovat' : 'Stáhnout offline seznam'}",
    "{manifestLoading ? 'Stahuji…' : manifestMeta ? 'Aktualizovat seznam' : 'Stáhnout seznam'}")
rep("""              Načítání akcí… Pokud nemáš žádnou nadcházející akci, vytvoř ji
              v sekci „Akce".""", """              Načítám představení… Pokud se žádné neobjeví, nemáte nadcházející představení — založte ho v sekci „Inscenace".""")
rep("""                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                  Akce
                </label>""", """                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                  Představení
                </label>""")
rep("<option value=\"\">— vyber akci —</option>", "<option value=\"\">— vyberte představení —</option>")
rep("Den{selectedEvent.days.length > 1 ? ' (povinné pro multi-day)' : ''}", "Den{selectedEvent.days.length > 1 ? ' (povinné u vícedenních akcí)' : ''}")

# velký stav hned pod přepínačem režimu (dřív výsledek dole pod formulářem, malým písmem)
rep("""      {entryMode === 'group' ? (
        <GroupScanPanel />""", """      {entryMode === 'single' ? <ScanState result={result} /> : null}

      {entryMode === 'group' ? (
        <GroupScanPanel />""")

rep("""              <ScanLine className="h-5 w-5" aria-hidden /> Validace""", """              <ScanLine className="h-5 w-5" aria-hidden /> Načíst vstupenku""")
rep("""                <label className="mb-1 block text-xs font-medium">
                  Ticket ID nebo QR payload{' '}
                  <code className="text-[11px] text-muted-foreground">
                    {'tixly:<id>:<code>'}
                  </code>
                </label>""", """                <label htmlFor="scanner-ticket" className="mb-1 block text-xs font-medium">
                  Kód vstupenky
                </label>""")
rep("""                    placeholder="8a4f7b2e-… / tixly:…:123456 / TXP2.…\"""", """                    id="scanner-ticket"
                    placeholder="QR kamerou nebo kód ze vstupenky\"""")
rep("""                    title="Otevřít kameru pro sken QR\"""", """                    title="Načíst QR kód kamerou"
                    aria-label="Načíst QR kód kamerou\"""")
rep("""              <div>
                <label className="mb-1 block text-xs font-medium">
                  TOTP kód (volitelné, z autentikační appky)
                </label>""", """              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Vstupenka s měnícím se kódem v mobilu</summary>
                <label className="mb-1 mt-2 block text-xs font-medium">
                  Šestimístný kód z mobilu kupce
                </label>""")
rep("""                  maxLength={6}
                />
              </div>""", """                  maxLength={6}
                />
              </details>""")
rep("""                    Standard
                  </button>""", """                    Běžný
                  </button>""")
rep("""                    Re-entry režim pro festivaly / open-air. Vyžaduje event s
                    <code className="mx-1">reentry_allowed=TRUE</code>.""", """                    Opakovaný vstup (festivaly, open-air). Funguje jen u akcí, kde má opakovaný vstup zapnutý pořadatel.""")
rep("""                {loading
                  ? 'Validuji…'
                  : scanMode === 'reentry_exit'
                    ? 'Označit výstup'
                    : 'Validovat lístek'}""", """                {loading
                  ? 'Ověřuji…'
                  : scanMode === 'reentry_exit'
                    ? 'Označit výstup'
                    : 'Ověřit vstupenku'}""")
rep("""            <CardTitle>Výsledek</CardTitle>""", """            <CardTitle>Podrobnosti</CardTitle>""")
# kamera: po načtení rovnou ověřit (dřív musela obsluha ještě klepnout na „Validovat lístek")
rep("""        onDetected={(raw) => {
          setTicketIdSmart(raw);
          setCameraOpen(false);
        }}""", """        onDetected={(raw) => {
          setTicketIdSmart(raw);
          setCameraOpen(false);
          setAutoSubmit(true);
        }}""")
rep("  const [cameraOpen, setCameraOpen] = useState(false);", "  const [cameraOpen, setCameraOpen] = useState(false);\n  const [autoSubmit, setAutoSubmit] = useState(false);")
rep("  // Poslední průchod si držíme kvůli tlačítku „opravit\".", """  // Kolo 12: QR z kamery se ověří hned (stav se nastaví v onDetected, ověření až s novým kódem ve stavu)
  useEffect(() => {
    if (!autoSubmit || !ticketId) return;
    setAutoSubmit(false);
    void handleSubmit();
  }, [autoSubmit, ticketId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poslední průchod si držíme kvůli tlačítku „opravit\".""")

# štítky výsledků česky
for a, b in [("return 'Lístek jiného promotéra';", "return 'Vstupenka jiného pořadatele';"),
             ("return 'Lístek na jinou akci';", "return 'Vstupenka na jiný termín';"),
             ("return 'TOTP kód neodpovídá';", "return 'Kód z mobilu nesouhlasí';"),
             ("return 'Neplatný stav';", "return 'Vstupenka není platná';"),
             ("return 'Flex pass vyčerpán';", "return 'Permanentka je vyčerpaná';"),
             ("      return 'Chyba';", "      return 'Chyba — zkuste to znovu';")]:
    rep(a, b)

s = s.replace("import Link from 'next/link';", "import Link from 'next/link';\nimport { ScanState } from './ScanState';", 1)
assert "import { ScanState }" in s
open(p, 'w', encoding='utf8').write(s)
print('ok')
