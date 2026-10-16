# Kolo 15 — kdo volá serverové GET fetch(): transitivní importéři lib souborů až po app/ routy a stránky.
# Pravidlo Next 14 (app-route/module.js 14.2.35): modul s POST/DELETE/PATCH/OPTIONS → za běhu revalidate = 0 →
# výchozí fetch se neukládá; modul jen s GET (/PUT) → výchozí GET fetch „auto cache" (revalidate false = napořád).
import io, os, re, json, collections

BS = chr(92)
rows = [r for r in json.load(io.open('../logs/r15/2_fetch_inventory.json', encoding='utf8'))
        if r['method'] in ('GET', 'OPTS', 'HEAD') and not r['cache'] and not r['reval'] and '__tests__' not in r['f']]
srcfiles = []
for d, _, fs in os.walk('src'):
    for f in fs:
        if f.endswith(('.ts', '.tsx')):
            srcfiles.append(os.path.join(d, f).replace(BS, '/'))


def modkey(p):
    p = re.sub(r'/index\.(ts|tsx)$', '', p)
    p = re.sub(r'\.(ts|tsx)$', '', p)
    return p.replace('src/', '@/', 1)


imports = collections.defaultdict(set)
for f in srcfiles:
    s = io.open(f, encoding='utf8').read()
    for m in re.finditer(r"""(?:from|import\()\s*['"]([^'"]+)['"]""", s):
        t = m.group(1)
        if t.startswith('.'):
            t = modkey(os.path.normpath(os.path.join(os.path.dirname(f), t)).replace(BS, '/'))
        imports[t].add(f)


def methods(f):
    s = io.open(f, encoding='utf8').read()
    ms = set(re.findall(r'export (?:async )?function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b', s))
    ms |= set(re.findall(r'export const (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b', s))
    fd = bool(re.search(r"export const dynamic\s*=\s*['\"]force-dynamic", s))
    return ms, fd


out = {}
for r in rows:
    f = r['f']
    seen = {f}
    q = [f]
    ends = set()
    while q:
        cur = q.pop()
        if cur.startswith('src/app/') and re.search(r'/(route|page|layout)\.tsx?$', cur):
            ends.add(cur)
            continue
        for imp in imports.get(modkey(cur), ()):
            if imp not in seen:
                seen.add(imp)
                q.append(imp)
    res = []
    for e in sorted(ends):
        if re.search(r'/route\.tsx?$', e):
            ms, fd = methods(e)
            nonstatic = bool(ms & {'POST', 'DELETE', 'PATCH', 'OPTIONS'})
            verdict = 'N14 neukládá (modul s POST/DELETE/PATCH/OPTIONS)' if nonstatic else ('GET-only' + (' force-dynamic' if fd else ''))
            res.append([e, ','.join(sorted(ms)), verdict])
        else:
            res.append([e, 'page/layout', 'stránka'])
    out[f"{f}:{r['l']}"] = res

json.dump(out, io.open('../logs/r15/2_fetch_callers.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
for k, v in out.items():
    risky = [x for x in v if not x[2].startswith('N14 neukládá')]
    print(f"{k}: koncových bodů {len(v)}, k prověření {len(risky)}")
    for x in risky:
        print('    ', x[0], x[1], x[2])
