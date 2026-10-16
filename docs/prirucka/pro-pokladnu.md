# Tixly — příručka pro pokladnu

Jedna stránka pro pokladní: vyzvednutí rezervace, prodej na místě, tisk vstupenek.

## Co potřebujete mít připravené

- Přihlašovací e-mail a heslo. Pozvánku pošle vlastník agentury v **Tým** → **Pozvat člena**: s rolí **Staff (scanner /
  read-only)** máte Pokladnu a Vstup; pro vyzvednutí rezervací (záložka Vstupenky u termínu) je potřeba role **Admin**.
- Počítač nebo tablet u pokladny s tiskárnou (vstupenky se otevřou jako PDF s QR kódem).
- Hotovost na vracení a platební terminál (karty se platí na vlastním terminálu, Tixly jen zaznamená platbu kartou).

## Vyzvednutí a zaplacení rezervace

1. Menu **Akce** → u představení **Upravit** → záložka **Vstupenky** → **Rezervace na pokladně**. Stejnojmenná představení
   rozlišíte podle data v sloupci **Termín**.
2. Do pole „Kód, jméno, e-mail nebo telefon" napište údaj a klikněte na **Hledat** (nebo Enter). Kód celý; u jména a
   e-mailu stačí část; u telefonu aspoň 6 číslic.
3. U rezervace klikněte na **Hotově** nebo **Kartou**. Objeví se „Rezervace … zaplacena (…): … vstupenek, doklad …".
4. Vstupenky odejdou kupci e-mailem. Tištěné vstupenky: **Objednávky** → otevřete objednávku → **Tisk vstupenek**.

![Rezervace nalezená](img/P-03-rezervace-nalezena.png)

## Prodej na místě

1. Menu **Pokladna** → **Představení** (název — město (datum)) → **Typ lístku**.
2. Klikněte na místa v plánku **Výběr sedadel**. Šedá = obsazeno, oranžová = blokace (prodej z blokace, název v nápovědě).
3. **Jméno kupce** je volitelné. Zvolte **Hotově** nebo **Karta (externí terminál)** — „Celkem k inkasu" ukazuje částku.
4. Klikněte na **Vystavit lístek**.
5. Klikněte na **Vytisknout / uložit jako PDF** — otevře se PDF vstupenek s QR kódem; vytiskněte je a předejte kupci.

Slevová kategorie (senior, student) se na pokladně nevybírá — prodává se cena typu lístku.

![Prodej na místě — vystaveno](img/P-07-pos-vystaveno.png)

## Když něco nefunguje

| Co vidíte | Co udělat |
|---|---|
| Rezervace se nenajde | Zkuste jiný údaj (kód, příjmení, e-mail, telefon). Zkontrolujte, že máte otevřené správné představení (datum). Propadlá rezervace už neplatí — místa se vrátila do prodeje. |
| Nevidíte záložku **Vstupenky** u představení | Váš účet má roli Staff. Požádejte vlastníka o roli Admin, nebo o vyzvednutí rezervace. |
| Tlačítko **Vystavit lístek** je šedé | Vyberte typ lístku a aspoň jedno místo. |
| PDF se vstupenkami se neotevře | Povolte v prohlížeči vyskakovací okna pro Tixly a klikněte znovu. |
| Nejde internet | Prodej ani výdej rezervací bez internetu nefunguje. Zapište si kupce a místa na papír, prodej dokončete po obnovení spojení a zavolejte vedoucí. |
