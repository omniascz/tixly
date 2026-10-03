'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/PageHeader';
import { Input } from '@/components/ui/input';
import { ORG_ROUTES, type RouteEntry } from '@/lib/admin/nav';

/**
 * Rozcestník všech funkcí admina.
 *
 * Vzniklo proto, že 26 hotových stránek nebylo dosažitelných z žádného menu
 * — mimo jiné žádosti o vrácení peněz, GDPR, NIPOS výkaz, rezervace,
 * školní objednávky, import zákazníků a všech šest AI nástrojů.
 *
 * Zároveň slouží jako pojistka: i funkce, kterou levé menu neukazuje,
 * se tu dá najít podle názvu.
 */
export default function AllFeaturesPage() {
  const [query, setQuery] = useState('');

  const normalized = query.trim().toLocaleLowerCase('cs');

  const domains = useMemo(() => {
    if (!normalized) return ORG_ROUTES;
    return ORG_ROUTES.map((d) => ({
      ...d,
      items: d.items.filter((i) => matches(i, normalized)),
    })).filter((d) => d.items.length > 0);
  }, [normalized]);

  const total = domains.reduce((sum, d) => sum + d.items.length, 0);

  return (
    <div>
      <PageHeader
        title="Vše"
        description="Kompletní seznam funkcí administrace. Hledej podle názvu, nebo procházej podle oblastí."
      />

      <div className="relative mb-6 max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Hledat funkci — např. výplaty, GDPR, poukazy…"
          aria-label="Hledat funkci"
          className="pl-9"
        />
      </div>

      {total === 0 ? (
        <p className="rounded-lg border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
          Nic neodpovídá hledání „{query}". Zkus jiný výraz — hledá se v názvu i popisu.
        </p>
      ) : (
        domains.map((domain) => (
          <section key={domain.key} className="mb-8">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {domain.label}
            </h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {domain.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block rounded-lg border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/30"
                >
                  <div className="font-medium">{item.label}</div>
                  {item.hint ? (
                    <p className="mt-1 text-sm text-muted-foreground">{item.hint}</p>
                  ) : null}
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function matches(item: RouteEntry, needle: string): boolean {
  const haystack = `${item.label} ${item.hint ?? ''}`.toLocaleLowerCase('cs');
  if (haystack.includes(needle)) return true;
  // Ať se „vyplaty" najde i bez diakritiky.
  return stripDiacritics(haystack).includes(stripDiacritics(needle));
}

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
