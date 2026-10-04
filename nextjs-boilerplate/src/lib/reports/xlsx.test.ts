import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildCsv, buildXlsx, crc32 } from './xlsx';

describe('XLSX / CSV export (kolo 8 / krok 8)', () => {
  it('crc32 odpovídá referenční hodnotě', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('XLSX je platný ZIP s listy, čísla jako čísla, text s diakritikou', () => {
    const buf = buildXlsx([
      { name: 'Prodej', header: ['Zóna', 'Kategorie', 'Prodáno', 'Tržba Kč'], rows: [['Přízemí', 'ZTP/P', 3, 750.5], ['Balkon <A>', 'Plné & "VIP"', 1, null]] },
      { name: 'Obsazenost', header: ['Termín', '%'], rows: [['Hamlet', 87.5]] },
    ]);
    const files = unzipSync(new Uint8Array(buf));
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
    ]);
    const s1 = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(s1).toContain('<c r="C2"><v>3</v></c>');
    expect(s1).toContain('<c r="D2"><v>750.5</v></c>');
    expect(s1).toContain('Přízemí');
    expect(s1).toContain('Balkon &lt;A&gt;');
    expect(s1).toContain('Plné &amp; &quot;VIP&quot;');
    expect(s1).toContain('<c r="D3"/>');
    expect(strFromU8(files['xl/workbook.xml'])).toContain('<sheet name="Obsazenost" sheetId="2" r:id="rId2"/>');
  });

  it('CSV: BOM, středník, uvozovky', () => {
    const csv = buildCsv(['A', 'B'], [['x;y', 'a"b'], [1, null]]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toBe('﻿A;B\r\n"x;y";"a""b"\r\n1;\r\n');
  });
});
