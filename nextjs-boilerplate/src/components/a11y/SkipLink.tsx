/**
 * SkipLink — keyboard accessibility helper.
 *
 * První Tab na page focusne tento link. Stisknutí Enter přeskočí na #main.
 *
 * Použití: vlož do root layout jako první child v <body>.
 */

export function SkipLink({ targetId = 'main-content', label = 'Přeskočit na obsah' }: {
  targetId?: string;
  label?: string;
}) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-emerald-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
    >
      {label}
    </a>
  );
}
