import { VerificationsClient } from './VerificationsClient';

export const dynamic = 'force-dynamic';

export default async function VerificationsPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  return (
    <div className="mx-auto max-w-md py-8">
      <h1 className="mb-2 text-2xl font-bold">Slevové oprávnění</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Nahraj proof (ISIC, senior pass, ZTP/P) a po ověření máš automaticky slevu na všech akcích
        s odpovídajícím pravidlem.
      </p>
      <VerificationsClient locale={params.locale} />
    </div>
  );
}
