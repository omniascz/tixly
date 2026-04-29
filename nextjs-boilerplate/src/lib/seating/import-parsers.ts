/**
 * Parsers pro import seating layoutů z různých formátů.
 *
 * Cílové vlnové scénáře:
 *   • Pre-mapped sály (Camp Nou, O2 arena) — promotér posílá CSV / JSON export z svého
 *     venue management software.
 *   • Tužkové plány — promotér nakreslí v SVG editoru (Inkscape, Figma exportované jako SVG).
 *     Parser převede <circle> nebo <rect> na seats.
 *   • Nové stadiony — vizuální editor, není zde řešeno.
 */

export interface ParsedSeat {
  num: string;
  x: number;
  y: number;
  accessibility?: boolean;
}
export interface ParsedRow {
  label: string;
  seats: ParsedSeat[];
}
export interface ParsedSector {
  name: string;
  color: string;
  rows: ParsedRow[];
}
export interface ParsedLayout {
  viewBox: string;
  sectors: ParsedSector[];
}

export interface ParseResult {
  layout: ParsedLayout;
  warnings: string[];
}

const DEFAULT_COLORS = ['#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#84cc16', '#ef4444', '#14b8a6'];

/**
 * CSV format:
 *   sector,row,num,x,y[,accessibility]
 *   "Tribuna A","A","1",100,200
 *   "Tribuna A","A","2",130,200
 *   ...
 */
export function parseCsv(csv: string): ParseResult {
  const warnings: string[] = [];
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    throw new Error('CSV: očekávána aspoň hlavička a 1 řádek dat');
  }
  const header = splitCsvLine(lines[0]!).map((h) => h.toLowerCase().trim());
  const idx = {
    sector: header.indexOf('sector'),
    row: header.indexOf('row'),
    num: header.indexOf('num'),
    x: header.indexOf('x'),
    y: header.indexOf('y'),
    accessibility: header.indexOf('accessibility'),
  };
  for (const [k, v] of Object.entries(idx)) {
    if (k !== 'accessibility' && v === -1) {
      throw new Error(`CSV: chybí povinný sloupec "${k}"`);
    }
  }

  const sectorMap = new Map<string, Map<string, ParsedSeat[]>>();
  let maxX = 0;
  let maxY = 0;
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!);
    const sectorName = cells[idx.sector] ?? '';
    const rowLabel = cells[idx.row] ?? '';
    const num = cells[idx.num] ?? '';
    const x = Number(cells[idx.x]);
    const y = Number(cells[idx.y]);
    const accessibility =
      idx.accessibility >= 0
        ? ['1', 'true', 'yes', 'y'].includes((cells[idx.accessibility] ?? '').toLowerCase())
        : false;
    if (!sectorName || !rowLabel || !num) {
      warnings.push(`Řádek ${i + 1}: vynechán (chybí sector/row/num)`);
      continue;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      warnings.push(`Řádek ${i + 1}: vynechán (neplatné x/y)`);
      continue;
    }
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    let secMap = sectorMap.get(sectorName);
    if (!secMap) {
      secMap = new Map();
      sectorMap.set(sectorName, secMap);
    }
    let seats = secMap.get(rowLabel);
    if (!seats) {
      seats = [];
      secMap.set(rowLabel, seats);
    }
    seats.push({ num, x, y, accessibility: accessibility || undefined });
  }

  const sectors: ParsedSector[] = [];
  let colorIdx = 0;
  for (const [sectorName, rowMap] of sectorMap) {
    const rows: ParsedRow[] = [];
    for (const [rowLabel, seats] of rowMap) {
      seats.sort((a, b) => Number(a.num) - Number(b.num) || a.num.localeCompare(b.num));
      rows.push({ label: rowLabel, seats });
    }
    rows.sort((a, b) => a.label.localeCompare(b.label));
    sectors.push({
      name: sectorName,
      color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length]!,
      rows,
    });
    colorIdx++;
  }

  if (sectors.length === 0) {
    throw new Error('CSV: žádné platné řádky');
  }

  return {
    layout: {
      viewBox: `0 0 ${Math.ceil(maxX + 50)} ${Math.ceil(maxY + 50)}`,
      sectors,
    },
    warnings,
  };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"' && line[i + 1] === '"') {
      cur += '"';
      i++;
    } else if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * JSON: očekává buď přímo náš `Layout` formát, nebo podobný.
 * Validace je voláním kontextu (Zod) — zde jen normalizujeme.
 */
export function parseJson(json: string): ParseResult {
  const warnings: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`JSON: ${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON: očekáván objekt');
  }
  const obj = parsed as Record<string, unknown>;
  const sectorsRaw = obj.sectors;
  if (!Array.isArray(sectorsRaw)) {
    throw new Error('JSON: chybí "sectors" (array)');
  }
  const sectors: ParsedSector[] = [];
  let maxX = 0;
  let maxY = 0;
  let colorIdx = 0;
  for (const s of sectorsRaw) {
    if (!s || typeof s !== 'object') continue;
    const sec = s as Record<string, unknown>;
    const name = String(sec.name ?? `Sector ${sectors.length + 1}`);
    const color = typeof sec.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(sec.color)
      ? sec.color
      : DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length]!;
    colorIdx++;
    const rowsRaw = Array.isArray(sec.rows) ? sec.rows : [];
    const rows: ParsedRow[] = [];
    for (const r of rowsRaw) {
      if (!r || typeof r !== 'object') continue;
      const row = r as Record<string, unknown>;
      const label = String(row.label ?? '');
      if (!label) continue;
      const seatsRaw = Array.isArray(row.seats) ? row.seats : [];
      const seats: ParsedSeat[] = [];
      for (const seat of seatsRaw) {
        if (!seat || typeof seat !== 'object') continue;
        const sObj = seat as Record<string, unknown>;
        const num = String(sObj.num ?? '');
        const x = Number(sObj.x);
        const y = Number(sObj.y);
        if (!num || !Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        seats.push({ num, x, y, accessibility: sObj.accessibility === true || undefined });
      }
      if (seats.length > 0) rows.push({ label, seats });
    }
    if (rows.length > 0) sectors.push({ name, color, rows });
  }
  if (sectors.length === 0) {
    throw new Error('JSON: žádné platné sektory');
  }
  const viewBox = typeof obj.viewBox === 'string' && /^[\d\s.-]+$/.test(obj.viewBox)
    ? obj.viewBox
    : `0 0 ${Math.ceil(maxX + 50)} ${Math.ceil(maxY + 50)}`;
  return { layout: { viewBox, sectors }, warnings };
}

/**
 * SVG parser: extrahuje <circle> a <rect> elementy, použije jejich data-* atributy
 * pro sector/row/num metadata, jinak heuristicky podle barvy seskupí do sektorů.
 *
 * Podporované metadata atributy:
 *   data-sector="Tribuna A" data-row="A" data-num="1" data-accessibility="true"
 *
 * Bez metadat: každá barva = sektor, seats v rámci sektoru se očísluje sequentially.
 */
export function parseSvg(svg: string): ParseResult {
  const warnings: string[] = [];
  const viewBoxMatch = svg.match(/viewBox\s*=\s*"([^"]+)"/i);
  const widthMatch = svg.match(/<svg[^>]*\swidth\s*=\s*"([\d.]+)"/i);
  const heightMatch = svg.match(/<svg[^>]*\sheight\s*=\s*"([\d.]+)"/i);
  let viewBox: string;
  if (viewBoxMatch) {
    viewBox = viewBoxMatch[1]!.trim();
  } else if (widthMatch && heightMatch) {
    viewBox = `0 0 ${widthMatch[1]} ${heightMatch[1]}`;
  } else {
    viewBox = '0 0 1000 800';
    warnings.push('SVG: chybí viewBox/width — použit fallback 1000×800');
  }

  type RawSeat = ParsedSeat & { sector?: string; row?: string; color?: string };
  const seats: RawSeat[] = [];

  // Match circles: <circle ... cx="..." cy="..." ... />
  const circleRe = /<circle\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = circleRe.exec(svg)) !== null) {
    const attrs = parseAttrs(m[1]!);
    const cx = Number(attrs.cx);
    const cy = Number(attrs.cy);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    seats.push({
      x: cx,
      y: cy,
      num: attrs['data-num'] ?? '',
      sector: attrs['data-sector'],
      row: attrs['data-row'],
      color: extractColor(attrs.fill ?? attrs.style),
      accessibility: attrs['data-accessibility'] === 'true' || undefined,
    });
  }

  // Match rects: use center
  const rectRe = /<rect\b([^>]*)\/?>/gi;
  while ((m = rectRe.exec(svg)) !== null) {
    const attrs = parseAttrs(m[1]!);
    const x = Number(attrs.x);
    const y = Number(attrs.y);
    const w = Number(attrs.width);
    const h = Number(attrs.height);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) continue;
    seats.push({
      x: x + w / 2,
      y: y + h / 2,
      num: attrs['data-num'] ?? '',
      sector: attrs['data-sector'],
      row: attrs['data-row'],
      color: extractColor(attrs.fill ?? attrs.style),
      accessibility: attrs['data-accessibility'] === 'true' || undefined,
    });
  }

  if (seats.length === 0) {
    throw new Error('SVG: nenalezeny žádné <circle> ani <rect> elementy');
  }

  // Group: prefer data-sector/row, fallback by color
  const sectorMap = new Map<string, Map<string, RawSeat[]>>();
  let unlabelled = 0;
  for (const s of seats) {
    const sectorKey = s.sector ?? s.color ?? 'default';
    const rowKey = s.row ?? '__auto__';
    let secMap = sectorMap.get(sectorKey);
    if (!secMap) {
      secMap = new Map();
      sectorMap.set(sectorKey, secMap);
    }
    let arr = secMap.get(rowKey);
    if (!arr) {
      arr = [];
      secMap.set(rowKey, arr);
    }
    arr.push(s);
    if (!s.sector || !s.row) unlabelled++;
  }
  if (unlabelled > 0) {
    warnings.push(
      `SVG: ${unlabelled} z ${seats.length} seats nemělo data-sector/data-row — seskupeno heuristicky.`,
    );
  }

  const sectors: ParsedSector[] = [];
  let colorIdx = 0;
  for (const [sectorKey, rowMap] of sectorMap) {
    const sectorName = sectorMap.size === 1 || sectorKey === 'default'
      ? 'Default'
      : sectorKey.startsWith('#')
        ? `Sektor ${colorIdx + 1}`
        : sectorKey;
    const sectorColor = sectorKey.startsWith('#')
      ? sectorKey
      : DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length]!;

    const rows: ParsedRow[] = [];
    for (const [rowKey, rowSeats] of rowMap) {
      // Sort by x for natural numbering
      rowSeats.sort((a, b) => a.x - b.x);
      const rowLabel = rowKey === '__auto__'
        ? autoRowLabel(rows.length)
        : rowKey;
      const finalSeats: ParsedSeat[] = rowSeats.map((s, i) => ({
        num: s.num || String(i + 1),
        x: Math.round(s.x),
        y: Math.round(s.y),
        accessibility: s.accessibility,
      }));
      rows.push({ label: rowLabel, seats: finalSeats });
    }
    rows.sort((a, b) => a.label.localeCompare(b.label));
    sectors.push({ name: sectorName, color: sectorColor, rows });
    colorIdx++;
  }

  return { layout: { viewBox, sectors }, warnings };
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

function extractColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const m = value.match(/#[0-9a-fA-F]{6}/);
  if (m) return m[0].toLowerCase();
  // CSS named colors → ignore (caller falls back)
  return undefined;
}

function autoRowLabel(idx: number): string {
  if (idx < 26) return String.fromCharCode(65 + idx);
  return (
    String.fromCharCode(65 + Math.floor(idx / 26) - 1) +
    String.fromCharCode(65 + (idx % 26))
  );
}

export function detectFormat(text: string, filename?: string): 'csv' | 'svg' | 'json' | 'smsticket' | null {
  const lower = (filename ?? '').toLowerCase();
  const trimmed = text.trim();
  // SmsTicket signature beats generic .svg — same extension but jVectorMap structure.
  if (trimmed.startsWith('<') && (/jvectormap-region/.test(trimmed) || /data-code="s\d+"/.test(trimmed))) {
    return 'smsticket';
  }
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.svg')) return 'svg';
  if (lower.endsWith('.json')) return 'json';
  if (trimmed.startsWith('<')) return 'svg';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (trimmed.includes(',') && /\bsector\b/i.test(trimmed)) return 'csv';
  return null;
}
