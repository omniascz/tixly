/**
 * Parser pro SVG mapy z smsticket.cz (jVectorMap library).
 *
 * Vstup je obvykle SVG ze stránky `/mapa/nahled/<uuid>` zkopírovaný z DevTools (po
 * přihlášení uživatele). Formát:
 *   - sedadla jako <path d="M cx,cy m -16,0 a 16,16 0 1,0 32,0 ..."> s data-code="sNNNNN"
 *   - barva fill určuje sektor (typicky 4 cenové zóny)
 *   - <text data-parent-code="sNNNNN"><tspan>NUM</tspan></text> obsahuje číslo sedadla
 *   - <image xlink:href="..."> je floor plan jako pozadí
 *
 * Sektor/řadu rekonstruujeme heuristicky:
 *   • sektor = barva (uživatel přejmenuje při importu — viz `applySectorRenames`)
 *   • řady v rámci sektoru = clustery podle Y souřadnice (15px tolerance)
 *   • pořadí v řadě = X (left-to-right)
 *
 * Limit: pokud SVG pochází z neoznámeného layoutu (gridless concert floor), Y-clustering
 * fallback na "row 1" pro celý sektor — pro rovné amfiteátry funguje 99% případů.
 */

import type { ParseResult, ParsedSector, ParsedRow, ParsedSeat } from './import-parsers';
import { spatialCluster } from './transforms';

interface RawSeat {
  code: string;
  x: number;
  y: number;
  color: string;
  num?: string;
}

const Y_ROW_TOLERANCE = 15;

export function isSmsTicketSvg(svg: string): boolean {
  return /jvectormap-region/.test(svg) || /data-code="s\d+"/.test(svg);
}

export function parseSmsTicketSvg(svg: string): ParseResult & { backgroundUrl?: string } {
  const warnings: string[] = [];

  // Background image → use its dimensions for viewBox, also remember URL for floor_plan_url.
  let viewBox = '0 0 1510 1880';
  let backgroundUrl: string | undefined;
  const imageTag = svg.match(/<image\b([^>]+?)\/?>/);
  if (imageTag) {
    const attrs = imageTag[1]!;
    const href = attrs.match(/\s(?:xlink:)?href="([^"]+)"/);
    const w = attrs.match(/\swidth="(\d+(?:\.\d+)?)"/);
    const h = attrs.match(/\sheight="(\d+(?:\.\d+)?)"/);
    if (href) backgroundUrl = href[1]!;
    if (w && h) viewBox = `0 0 ${Math.round(Number(w[1]))} ${Math.round(Number(h[1]))}`;
  }
  if (!backgroundUrl) {
    warnings.push('SmsTicket: nenalezen background image, použit fallback viewBox 1510×1880.');
  }

  // Path elements — smsticket používá DVA formáty pro circle seats:
  //   1) Arc:  d="M cx,cy m -16,0 a 16,16 0 1,0 ..."   → M point JE center
  //   2) Cubic: d="M (cx+r),cy C ..."                  → M point je rightmost (cx+r), takže center = M.x - 16
  // Druhý formát vidíme typicky pro "boční balkony" (zaoblené hrany hlediště).
  const seats: RawSeat[] = [];
  const pathRe = /<path\b([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(svg)) !== null) {
    const attrs = m[1]!;
    const codeMatch = attrs.match(/\sdata-code="(s\d+)"/);
    if (!codeMatch) continue;
    if (codeMatch[1]!.endsWith('o')) continue; // overlay path
    const fillMatch = attrs.match(/\sfill="(#[0-9a-fA-F]{6})"/);
    if (!fillMatch) continue;
    const dMatch = attrs.match(/\sd="([^"]+)"/);
    if (!dMatch) continue;
    const d = dMatch[1]!;
    let x: number;
    let y: number;
    const arcMatch = d.match(/^M\s+(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s+m\s+-\d+,0\s+a\s+\d+/);
    const cMatch = !arcMatch && d.match(/^M\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s+C/);
    if (arcMatch) {
      x = Number(arcMatch[1]);
      y = Number(arcMatch[2]);
    } else if (cMatch) {
      // Cubic bezier circle: M is at (cx + r, cy). Standard r=16.
      x = Number(cMatch[1]) - 16;
      y = Number(cMatch[2]);
    } else {
      continue;
    }
    seats.push({
      code: codeMatch[1]!,
      x,
      y,
      color: fillMatch[1]!.toUpperCase(),
    });
  }

  if (seats.length === 0) {
    throw new Error('SmsTicket: nenalezena žádná seat-paths (zkontroluj že SVG obsahuje data-code="sNNN")');
  }

  // Číslo sedadla z <text data-parent-code="sNNN"><tspan>NUM</tspan>
  const textRe = /<text\b[^>]*?\sdata-parent-code="(s\d+)"[^>]*?>\s*<tspan[^>]*?>([^<]+)<\/tspan>/g;
  const numByCode = new Map<string, string>();
  while ((m = textRe.exec(svg)) !== null) {
    numByCode.set(m[1]!, m[2]!.trim());
  }
  let unnumbered = 0;
  for (const seat of seats) {
    seat.num = numByCode.get(seat.code);
    if (!seat.num) unnumbered++;
  }
  if (unnumbered > 0) {
    warnings.push(`${unnumbered} z ${seats.length} sedadel nemělo číselný štítek — použito pořadí.`);
  }

  // Group by color → preliminary sector
  const byColor = new Map<string, RawSeat[]>();
  for (const seat of seats) {
    let arr = byColor.get(seat.color);
    if (!arr) { arr = []; byColor.set(seat.color, arr); }
    arr.push(seat);
  }

  // Pro každou barvu detekuj prostorové clustery (fyzicky oddělené části stejné barvy ≠ 1 sektor).
  // Anisotropic: X-práh 150 (uličku ~80-100px tolerujeme uvnitř sektoru, mezera mezi balkony 300+ rozsekne),
  // Y-práh 250 (curving balkonu má často Y-mezery 150-200 mezi top/middle/bottom částí stejné strany).
  const SPATIAL_X = 150;
  const SPATIAL_Y = 250;
  const sectors: ParsedSector[] = [];
  let splitInfo = 0;
  for (const [color, colorSeats] of byColor) {
    const clusters = spatialCluster(colorSeats, SPATIAL_X, SPATIAL_Y);
    const clusterGroups = clusters.length > 1 ? clusters : [colorSeats.map((_, i) => i)];
    if (clusters.length > 1) splitInfo += clusters.length;

    // Sort clusters by seat count desc — větší cluster dostane "základní" jméno.
    const groups = clusterGroups
      .map((idxs) => idxs.map((i) => colorSeats[i]!))
      .sort((a, b) => b.length - a.length);

    groups.forEach((groupSeats, ci) => {
      groupSeats.sort((a, b) => a.y - b.y || a.x - b.x);
      const rows: ParsedRow[] = [];
      let currentY = -Infinity;
      let currentRow: ParsedRow | null = null;
      for (const seat of groupSeats) {
        if (Math.abs(seat.y - currentY) > Y_ROW_TOLERANCE) {
          // Numerické labely — CZ zvyk + smsticket UI default.
          currentRow = { label: String(rows.length + 1), seats: [] };
          rows.push(currentRow);
          currentY = seat.y;
        }
        const num = seat.num ?? String(currentRow!.seats.length + 1);
        currentRow!.seats.push({ num, x: Math.round(seat.x), y: Math.round(seat.y) } satisfies ParsedSeat);
      }
      for (const row of rows) row.seats.sort((a, b) => a.x - b.x);
      // Pojmenování: jediný cluster = barva; více clusterů = barva s indexem (lze přejmenovat v importu).
      const name = clusterGroups.length > 1 ? `${color} #${ci + 1}` : color;
      sectors.push({ name, color, rows });
    });
  }
  if (splitInfo > 0) {
    warnings.push(
      `Detekováno ${splitInfo} prostorově oddělených clusterů uvnitř stejných barev — rozděleno do více sektorů. ` +
      `Pojmenuj je v náhledu (např. "Balkon vlevo" / "Balkon střed" / "Balkon vpravo").`,
    );
  }

  // Sort sectors by total seats descending — matches what user typically expects (largest sector first).
  sectors.sort((a, b) => seatCount(b) - seatCount(a));

  return {
    layout: { viewBox, sectors },
    warnings,
    backgroundUrl,
  };
}

function seatCount(s: ParsedSector): number {
  let n = 0;
  for (const r of s.rows) n += r.seats.length;
  return n;
}

/**
 * Aplikuje user-supplied mapping `barva nebo původní jméno → nové jméno`.
 * Voláno z import endpointu po dry-run, kdy uživatel přiřadil sektorům lidská jména.
 */
export function applySectorRenames(
  layout: { viewBox: string; sectors: ParsedSector[] },
  renames: Record<string, string>,
): { viewBox: string; sectors: ParsedSector[] } {
  return {
    viewBox: layout.viewBox,
    sectors: layout.sectors.map((s) => ({
      ...s,
      name: renames[s.name] ?? s.name,
    })),
  };
}
