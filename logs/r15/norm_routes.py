import io, re, sys, collections
src, dst = sys.argv[1], sys.argv[2]
rows = []
for line in io.open(src, encoding='utf8'):
    m = re.match(r'^[┌├└│ ]*([○ƒ●λ◐])\s+(/\S*)', line)
    if m: rows.append((m.group(2), m.group(1)))
rows.sort()
io.open(dst, 'w', encoding='utf8', newline='\n').write(''.join(f'{s} {r}\n' for r, s in rows))
print(len(rows), dict(collections.Counter(s for _, s in rows)))
