/**
 * Odznak „Poctivá cena" — veřejný trust signál na stránce akce / v checkoutu.
 *
 * All-in cena je u Tixly standard; `noSurgePledge` navíc slibuje, že cena se
 * nikdy nezvýší nad zveřejněnou (diferenciátor proti drip/surge pricingu konkurence).
 */

interface Props {
  noSurgePledge?: boolean;
  className?: string;
}

export function HonestPriceBadge({ noSurgePledge = false, className }: Props) {
  return (
    <div
      className={`rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 ${className ?? ''}`}
    >
      <div className="flex items-center gap-2 font-semibold">
        <span aria-hidden>✅</span>
        Poctivá cena
      </div>
      <ul className="mt-1 space-y-0.5 text-xs">
        <li>• Cena je <strong>all-in</strong> — žádné skryté poplatky u pokladny.</li>
        {noSurgePledge ? (
          <li>• <strong>Bez surge:</strong> cena se u této akce <strong>nikdy nezvýší</strong> nad zveřejněnou.</li>
        ) : null}
      </ul>
    </div>
  );
}
