/**
 * Geometry helpers pro visual seating editor.
 * Generuje seat positions po lineární linie nebo oblouku.
 */

export interface Point {
  x: number;
  y: number;
}

export interface SeatPosition {
  num: string;
  x: number;
  y: number;
}

/**
 * Linear row: N seats rovnoměrně mezi start a end.
 */
export function straightRow(start: Point, end: Point, count: number, startNum = 1): SeatPosition[] {
  if (count < 1) return [];
  if (count === 1) {
    return [{ num: String(startNum), x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }];
  }
  const seats: SeatPosition[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    seats.push({
      num: String(startNum + i),
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
    });
  }
  return seats;
}

/**
 * Arc row: 3 points (start, peak, end) define quadratic bezier-like arc.
 * Seats jsou rozmístěny rovnoměrně po křivce.
 */
export function arcRow(
  start: Point,
  peak: Point,
  end: Point,
  count: number,
  startNum = 1,
): SeatPosition[] {
  if (count < 1) return [];
  if (count === 1) return [{ num: String(startNum), x: peak.x, y: peak.y }];

  // Quadratic Bezier: B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
  const seats: SeatPosition[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const u = 1 - t;
    const x = u * u * start.x + 2 * u * t * peak.x + t * t * end.x;
    const y = u * u * start.y + 2 * u * t * peak.y + t * t * end.y;
    seats.push({ num: String(startNum + i), x: Math.round(x), y: Math.round(y) });
  }
  return seats;
}

/**
 * Compute SVG arc path d-string pro preview.
 */
export function arcPath(start: Point, peak: Point, end: Point): string {
  return `M ${start.x} ${start.y} Q ${peak.x} ${peak.y} ${end.x} ${end.y}`;
}

/**
 * Pythagoras distance.
 */
export function distance(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

export function rowLabel(index: number): string {
  // A-Z, then AA, AB, ...
  if (index < 26) return String.fromCharCode(65 + index);
  return (
    String.fromCharCode(65 + Math.floor(index / 26) - 1) +
    String.fromCharCode(65 + (index % 26))
  );
}
