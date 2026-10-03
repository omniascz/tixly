# Vloží řádek do tabulky nálezů FIX_REPORT_R4.md (před <!-- /nalezy -->) a označí krok v PROGRESS_R4.md.
# Pouziti: python audit/r4/report-row.py "<radek tabulky>" "<prefix radku kroku v PROGRESS>" "<novy stav>"
import sys
row, step, state = sys.argv[1], sys.argv[2], sys.argv[3]
p = 'FIX_REPORT_R4.md'
s = open(p, encoding='utf8').read()
s = s.replace('\n<!-- /nalezy -->', '\n' + row.rstrip('\n') + '\n<!-- /nalezy -->', 1)
open(p, 'w', encoding='utf8').write(s)
p = 'PROGRESS_R4.md'
lines = open(p, encoding='utf8').read().split('\n')
for i, l in enumerate(lines):
    if l.startswith('| ' + step):
        parts = l.split('|')
        parts[2] = ' ' + state + ' '
        lines[i] = '|'.join(parts)
open(p, 'w', encoding='utf8').write('\n'.join(lines))
