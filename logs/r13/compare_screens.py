"""Kolo 13 / krok 4: porovnání screenshotů d0bbcb00 vs výsledek kola 13 (stejná DB, stejné obrazovky).
Výstup: logs/r13/screens/diff/<název>.png (rozdílné pixely červeně) a souhrn logs/r13/4_screens_compare.txt."""
import os
import sys
from PIL import Image, ImageChops

ROOT = os.path.join(os.path.dirname(__file__), 'screens')
A, B, D = (os.path.join(ROOT, x) for x in ('d0bbcb00', 'r13', 'diff'))
os.makedirs(D, exist_ok=True)
lines = []
for name in sorted(os.listdir(A)):
    pa, pb = os.path.join(A, name), os.path.join(B, name)
    if not os.path.exists(pb):
        lines.append(f'{name}: CHYBÍ ve výsledku')
        continue
    ia, ib = Image.open(pa).convert('RGB'), Image.open(pb).convert('RGB')
    if ia.size != ib.size:
        lines.append(f'{name}: JINÁ VELIKOST {ia.size} vs {ib.size}')
        w, h = max(ia.width, ib.width), max(ia.height, ib.height)
        ca, cb = Image.new('RGB', (w, h), 'white'), Image.new('RGB', (w, h), 'white')
        ca.paste(ia), cb.paste(ib)
        ia, ib = ca, cb
    diff = ImageChops.difference(ia, ib).convert('L').point(lambda v: 255 if v > 16 else 0)
    n = sum(1 for v in diff.getdata() if v)
    total = ia.width * ia.height
    bbox = diff.getbbox()
    if n:
        out = ib.copy()
        red = Image.new('RGB', ib.size, (255, 0, 0))
        out.paste(red, mask=diff)
        out.save(os.path.join(D, name))
    lines.append(f'{name}: {"SHODA" if n == 0 else f"rozdíl {n} px ({100 * n / total:.3f} %), oblast {bbox}"}')
for name in sorted(os.listdir(B)):
    if not os.path.exists(os.path.join(A, name)):
        lines.append(f'{name}: CHYBÍ v d0bbcb00')
txt = '\n'.join(lines)
open(os.path.join(os.path.dirname(__file__), '4_screens_compare.txt'), 'w', encoding='utf8').write(txt + '\n')
sys.stdout.reconfigure(encoding='utf8')
print(txt)
