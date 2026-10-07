import { SearchClient } from './SearchClient';

export const dynamic = 'force-dynamic';

export default async function SearchPage(
  props: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ q?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  return (
    <div className="space-y-6 py-6">
      <div>
        <h1 className="text-3xl font-bold">🔎 Hledat akce</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Zkus „akce pro děti tento víkend v Praze do 200 Kč" nebo „rock koncert příští týden".
        </p>
      </div>
      <SearchClient locale={params.locale} initialQuery={searchParams.q ?? ''} />
    </div>
  );
}
