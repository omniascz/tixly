import { TeamAcceptClient } from './TeamAcceptClient';

export const dynamic = 'force-dynamic';

export default async function TeamAcceptPage(
  props: {
    searchParams: Promise<{ token?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  return (
    <div className="mx-auto max-w-md py-12">
      <h1 className="mb-4 text-2xl font-bold">Přijmout pozvánku do týmu</h1>
      {searchParams.token ? (
        <TeamAcceptClient token={searchParams.token} />
      ) : (
        <p className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
          Chybí token v URL.
        </p>
      )}
    </div>
  );
}
