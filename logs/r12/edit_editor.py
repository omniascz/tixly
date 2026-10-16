# Kolo 12 / F8: editor plánku česky, „Zpět" do knihovny míst, odkazy na neexistující stránky pryč.
import re

def rw(p, pairs):
    s = open(p, encoding='utf8').read()
    for a, b in pairs:
        assert s.count(a) >= 1, (p, a[:70])
        s = s.replace(a, b)
    open(p, 'w', encoding='utf8').write(s)

E = 'src/app/platform/venues/[id]/seating-chart/editor/VisualEditor.tsx'
rw(E, [
    ('placeholder="Název layoutu"', 'placeholder="Název plánku"'),
    ('↖ Select <kbd>1</kbd>', '↖ Výběr <kbd>1</kbd>'),
    ('✋ Pan <kbd>4</kbd>', '✋ Posun <kbd>4</kbd>'),
    ('↶ Undo', '↶ Vrátit'),
    ('↷ Redo', '↷ Znovu'),
    ('          Čísla seat', '          Čísla míst'),
    ("{saving ? 'Ukládám…' : 'Uložit layout'}", "{saving ? 'Ukládám…' : 'Uložit plánek'}"),
    ("setFeedback('Layout uložen.');", "setFeedback('Plánek uložen.');"),
    ("title={fullscreen ? 'Zavřít fullscreen (Esc)' : 'Fullscreen'}", "title={fullscreen ? 'Zavřít celou obrazovku (Esc)' : 'Na celou obrazovku'}"),
    ('♿ Accessibility', '♿ Pro vozíčkáře'),
    ('Zobrazí se pod sedadly jako předloha k obkreslení. Ukládá se s layoutem.', 'Zobrazí se pod sedadly jako předloha k obkreslení. Uloží se spolu s plánkem.'),
    ('<div><strong>Posunout sedadlo:</strong> Select → chyť a táhni</div>', '<div><strong>Posunout sedadlo:</strong> Výběr → chyť a táhni</div>'),
    ('<div className="pt-1"><kbd>1</kbd>–<kbd>6</kbd> Tool · <kbd>Ctrl+Z</kbd> Undo · <kbd>Del</kbd> Smazat · <kbd>Esc</kbd> Zrušit · <kbd>Shift+klik</kbd> Multi</div>',
     '<div className="pt-1"><kbd>1</kbd>–<kbd>6</kbd> nástroje · <kbd>Ctrl+Z</kbd> vrátit · <kbd>Del</kbd> smazat · <kbd>Esc</kbd> zrušit · <kbd>Shift+klik</kbd> vybrat víc</div>'),
])
s = open(E, encoding='utf8').read()
# title="Reset" (pohled)
s = s.replace('title="Reset"', 'title="Původní pohled"')
open(E, 'w', encoding='utf8').write(s)

P = 'src/app/admin/venues/[venueId]/seating-chart/editor/page.tsx'
rw(P, [
    ("useState('Default')", "useState('Plánek sálu')"),
    ('Pokud potřebujete změnit layout, kontaktujte', 'Pokud potřebujete změnit plánek, kontaktujte'),
    ('<Link href="/admin/venues/new" className="text-primary underline">\n            Vytvořte si nový soukromý sál →', '<Link href="/admin/venues" className="text-primary underline">\n            Založte si vlastní sál v knihovně míst →'),
    ('Chyba při načítání: {error}', 'Plánek se nepodařilo načíst ({error}). Obnovte stránku; pokud to nepomůže, vraťte se do knihovny míst a otevřete editor znovu.'),
    ('<Link href={`/admin/venues/${venueId}`} className="text-sm text-primary hover:underline">\n            ← Zpět na detail sálu',
     '<Link href="/admin/venues" className="text-sm text-primary hover:underline">\n            ← Zpět do knihovny míst'),
    ('<h1 className="mt-1 text-2xl font-bold">Seating editor</h1>', '<h1 className="mt-1 text-2xl font-bold">Editor plánku sálu</h1>'),
    ('Drag-and-draw editor pro layout sedadel. Změny se projeví na všech budoucích akcích v tomto sálu.',
     'Rozmístění sedadel, sekcí a cenových zón. Změny platí pro termíny založené od teď; už založené termíny se nemění.'),
])
print('ok')
