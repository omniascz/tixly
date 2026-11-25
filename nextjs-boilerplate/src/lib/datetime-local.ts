/** ISO okamžik → hodnota pro <input type="datetime-local"> v časové zóně prohlížeče.
 *  `iso.slice(0, 16)` dává UTC a po uložení (new Date(lokální).toISOString()) posune čas o offset. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
