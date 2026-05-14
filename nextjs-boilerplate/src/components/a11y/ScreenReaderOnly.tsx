/**
 * ScreenReaderOnly — visually hidden text pro screen readery.
 *
 * Použití: pro context-only text (např. „odebrat z košíku" pro × button).
 *   <button>×<ScreenReaderOnly>Odebrat z košíku</ScreenReaderOnly></button>
 */

export function ScreenReaderOnly({ children }: { children: React.ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
