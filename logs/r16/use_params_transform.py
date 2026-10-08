# Kolo 16 / krok 1 — klientské stránky: `const params = use(props.params);` → `const params = useParams<T>();`
# (synchronní params jako v Next 14; use() na Promise při hydrataci pozastaví vykreslení a pozdější aktualizace
# kontextu pak React donutí obsah zahodit a vykreslit znovu → ztráta toho, co uživatel napsal před hydratací).
# T se vezme z typu props `params: Promise<T>`. `props` se přejmenuje na `_props`, pokud už není použité.
import io, os, re, sys

BS = chr(92)
changed, skipped = [], []
for d, _, fs in os.walk('src'):
    for f in fs:
        if not f.endswith('.tsx'):
            continue
        p = os.path.join(d, f).replace(BS, '/')
        s = io.open(p, encoding='utf8').read()
        if 'const params = use(props.params);' not in s or not re.search(r"^['\"]use client['\"];", s, re.M):
            continue
        m = re.search(r'params:\s*Promise<(\{[^{}]*\})>', s)
        if not m:
            skipped.append((p, 'typ params nenalezen'))
            continue
        t = re.sub(r'\s+', ' ', m.group(1)).strip()
        s = s.replace('const params = use(props.params);', f'const params = useParams<{t}>();', 1)
        # props už nepoužité? → _props (lint argsIgnorePattern ^_)
        if not re.search(r'\bprops\.', s):
            s = re.sub(r'\(\s*props(\s*:)', r'(_props\1', s, count=1)
        # import useParams z next/navigation
        nav = re.search(r"import \{([^}]*)\} from 'next/navigation';", s)
        if nav:
            names = [x.strip() for x in nav.group(1).split(',') if x.strip()]
            if 'useParams' not in names:
                names.append('useParams')
                s = s.replace(nav.group(0), "import { " + ', '.join(names) + " } from 'next/navigation';", 1)
        else:
            react = re.search(r"import [^;]*from 'react';\n", s)
            ins = "import { useParams } from 'next/navigation';\n"
            s = s.replace(react.group(0), react.group(0) + ins, 1) if react else s.replace("'use client';\n", "'use client';\n" + ins, 1)
        # `use` z react odstranit, pokud už není volaný
        if not re.search(r'(?<![\w.])use\(', s):
            s = re.sub(r"(import \{[^}]*?)(,\s*use\b|\buse\s*,\s*)([^}]*\} from 'react';)", lambda mm: mm.group(1) + ('' if mm.group(2).startswith(',') else '') + mm.group(3), s, count=1)
            s = re.sub(r"import \{\s*use\s*\} from 'react';\n", '', s)
        io.open(p, 'w', encoding='utf8', newline='\n').write(s)
        changed.append((p, t))
for p, t in changed:
    print('OK  ', p, t)
for p, why in skipped:
    print('SKIP', p, why)
print(len(changed), 'změněno,', len(skipped), 'přeskočeno')
