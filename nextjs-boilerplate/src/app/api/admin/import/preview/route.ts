import { NextRequest, NextResponse } from 'next/server';
import { runAsActivePromoter } from '@/lib/admin-auth';

function detectDelimiter(sample: string): string {
  const counts = {
    ',': (sample.match(/,/g) ?? []).length,
    ';': (sample.match(/;/g) ?? []).length,
    '\t': (sample.match(/\t/g) ?? []).length,
  };
  const max = Math.max(...Object.values(counts));
  for (const [d, c] of Object.entries(counts)) {
    if (c === max && max > 0) return d;
  }
  return ',';
}

function parseCsv(text: string, delimiter: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const cols: string[] = [];
      let cur = '';
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQuote = !inQuote;
        } else if (ch === delimiter && !inQuote) {
          cols.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      cols.push(cur.trim());
      return cols;
    });
}

function detectMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const h of headers) {
    const lower = h.toLowerCase().trim();
    if (!mapping.email && ['email', 'e-mail', 'mail'].includes(lower)) {
      mapping.email = h;
    }
    if (
      !mapping.name &&
      ['jmeno', 'name', 'prijmeni', 'jméno', 'celé jméno', 'full name', 'jméno a příjmení'].includes(lower)
    ) {
      mapping.name = h;
    }
    if (!mapping.phone && ['telefon', 'phone', 'tel', 'mobil'].includes(lower)) {
      mapping.phone = h;
    }
    if (
      !mapping.purchases &&
      ['pocet', 'purchases', 'nakupy', 'nákupy', 'počet nákupů', 'počet'].includes(lower)
    ) {
      mapping.purchases = h;
    }
    if (
      !mapping.spend &&
      ['utraceno', 'spend', 'celkem', 'total', 'utraceno celkem'].includes(lower)
    ) {
      mapping.spend = h;
    }
  }
  return mapping;
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async () => {
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'Soubor chybí' }, { status: 400 });
    }
    const text = await (file as File).text();
    if (text.length > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Soubor je příliš velký (max 10 MB)' }, { status: 400 });
    }

    const sample = text.slice(0, 2000);
    const delimiter = detectDelimiter(sample);
    const allRows = parseCsv(text, delimiter);
    if (allRows.length === 0) {
      return NextResponse.json({ error: 'Prázdný soubor' }, { status: 400 });
    }

    const headers = allRows[0];
    const rows = allRows.slice(1, 6);
    const detectedMapping = detectMapping(headers);

    return NextResponse.json({ headers, rows, delimiter, detectedMapping });
  });
}
