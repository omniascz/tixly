# Kolo 15 — inventura serverových fetch(): pro každé volání vypíše metodu, cache volby a kontext (route metoda / lib).
import io, re, sys, json
files = [l.strip() for l in io.open('../logs/r15/2_server_fetch_files.txt', encoding='utf8') if l.strip()]
rows = []
for f in files:
    src = io.open(f, encoding='utf8').read()
    for m in re.finditer(r'\bfetch\(', src):
        i = m.start(); depth = 0; j = m.end() - 1
        while j < len(src):
            c = src[j]
            if c == '(': depth += 1
            elif c == ')':
                depth -= 1
                if depth == 0: break
            j += 1
        call = src[i:j+1]
        line = src.count('\n', 0, i) + 1
        meth = re.search(r"method:\s*['\"`]?(\w+)", call)
        cache = re.search(r"cache:\s*['\"](\S+?)['\"]", call)
        reval = re.search(r"revalidate:\s*(\w+)", call)
        before = src[:i]
        enc = re.findall(r'export (?:async )?function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b', before)
        rows.append({'f': f, 'l': line, 'method': (meth.group(1).upper() if meth else ('?opts' if re.search(r'fetch\([^,]+,\s*\w+\s*\)', call) else 'GET')),
                     'cache': cache.group(1) if cache else '', 'reval': reval.group(1) if reval else '',
                     'route': f.endswith('route.ts'), 'enc': enc[-1] if enc else '',
                     'force_dyn': bool(re.search(r"export const dynamic = ['\"]force-dynamic", src)),
                     'dynfn': bool(re.search(r'\b(cookies|headers)\(\)', before))})
json.dump(rows, io.open('../logs/r15/2_fetch_inventory.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
from collections import Counter
print(len(rows), Counter(r['method'] for r in rows))
print('s cache:', Counter(r['cache'] or '-' for r in rows))
print('revalidate:', Counter(r['reval'] or '-' for r in rows))
