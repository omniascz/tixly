# Kolo 12 / F9: karta inscenace — obsazení po řádcích, nahrání fotky, české chyby.
p = 'src/app/admin/productions/[id]/page.tsx'
s = open(p, encoding='utf8').read()


def rep(a, b):
    global s
    assert s.count(a) == 1, (a[:70], s.count(a))
    s = s.replace(a, b)


rep("  const [castText, setCastText] = useState('');",
    "  // Kolo 12: obsazení po řádcích (dřív textové pole se syntaxí „role: jméno\"); poslední řádek je vždy prázdný pro novou roli\n"
    "  const [castRows, setCastRows] = useState<Array<{ role: string; name: string }>>([{ role: '', name: '' }]);\n"
    "  const [uploading, setUploading] = useState(false);")
rep("    setCastText(j.production.cast.map((c) => `${c.role}: ${c.name}`).join('\\n'));",
    "    setCastRows([...j.production.cast.map((c) => ({ role: c.role, name: c.name })), { role: '', name: '' }]);")
rep("""    const cast = castText.split('\\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const i = l.indexOf(':');
      return i >= 0 ? { role: l.slice(0, i).trim(), name: l.slice(i + 1).trim() } : { role: '', name: l };
    });""",
    "    const cast = castRows.map((c) => ({ role: c.role.trim(), name: c.name.trim() })).filter((c) => c.name);")
rep("    if (!r.ok) { setErr(`Uložení selhalo: ${JSON.stringify((await r.json().catch(() => ({}))))}`); return; }",
    "    if (!r.ok) { setErr(`Kartu se nepodařilo uložit. ${errorText(await r.json().catch(() => ({})), r.status)}`); return; }")
rep("    if (!r.ok) { setErr(`Inscenaci nelze načíst (HTTP ${r.status}).`); return; }",
    "    if (!r.ok) { setErr(`Inscenaci nelze načíst. ${errorText(await r.json().catch(() => ({})), r.status)}`); return; }")
rep("  async function saveCard() {", """  // Kolo 12: fotka souborem (stejné úložiště jako titulní obrázek akce); dřív jen odkazy
  async function uploadPhoto(file: File) {
    setErr(null); setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const token = localStorage.getItem('accessToken');
      const r = await fetch('/api/admin/uploads/cover-image', { method: 'POST', body: fd, credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!r.ok || !j.url) {
        setErr(r.status === 503 ? 'Nahrávání fotek zatím není na tomto serveru zapnuté (chybí úložiště souborů). Vložte prozatím odkaz na fotku do pole „Odkazy na fotky".'
          : r.status === 413 ? 'Fotka je větší než 5 MB. Zmenšete ji a nahrajte znovu.'
          : r.status === 415 ? 'Nahrát jde jen fotka ve formátu JPG, PNG nebo WebP.'
          : `Fotku se nepodařilo nahrát. ${errorText(j, r.status)}`);
        return;
      }
      const url = j.url;
      setPhotosText((t) => (t.trim() ? `${t.trim()}\\n${url}` : url));
      setMsg('Fotka nahraná — nezapomeňte kartu uložit.');
    } finally { setUploading(false); }
  }

  async function saveCard() {""")
rep("""          <label className="block text-sm">Obsazení (řádek „role: jméno")
            <textarea className="mt-1 h-28 w-full rounded-md border bg-background p-2 text-sm" value={castText} onChange={(e) => setCastText(e.target.value)} />
          </label>
          <label className="block text-sm">Fotky (jeden odkaz na řádek)
            <textarea className="mt-1 h-28 w-full rounded-md border bg-background p-2 text-sm" value={photosText} onChange={(e) => setPhotosText(e.target.value)} />
          </label>""", """          <fieldset className="space-y-2 text-sm" data-testid="cast-editor">
            <legend className="font-medium">Obsazení</legend>
            {castRows.map((c, i) => (
              <div key={i} className="flex gap-2">
                <Input placeholder="Role (např. Hamlet)" value={c.role} onChange={(e) => setCastRows(castRows.map((x, k) => (k === i ? { ...x, role: e.target.value } : x)))} />
                <Input placeholder="Jméno herce" value={c.name} onChange={(e) => setCastRows(castRows.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                {i < castRows.length - 1 ? (
                  <Button type="button" variant="outline" size="sm" aria-label={`Odebrat roli ${c.role || c.name}`} onClick={() => setCastRows(castRows.filter((_, k) => k !== i))}>Odebrat</Button>
                ) : null}
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setCastRows([...castRows, { role: '', name: '' }])}>Přidat roli</Button>
          </fieldset>
          <div className="space-y-2 text-sm">
            <span className="font-medium">Fotky</span>
            <label className="flex items-center gap-2">
              <span className="inline-flex cursor-pointer rounded-md border px-3 py-1.5 font-medium hover:bg-muted">{uploading ? 'Nahrávám…' : 'Nahrát fotku z počítače'}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={uploading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadPhoto(f); e.target.value = ''; }} />
            </label>
            <label className="block">Odkazy na fotky (jeden na řádek)
              <textarea className="mt-1 h-20 w-full rounded-md border bg-background p-2 text-sm" value={photosText} onChange={(e) => setPhotosText(e.target.value)} />
            </label>
          </div>""")
rep("import { Input } from '@/components/ui/input';", "import { Input } from '@/components/ui/input';\nimport { errorText } from '@/lib/ui/error-text';")
open(p, 'w', encoding='utf8').write(s)
print('ok')
