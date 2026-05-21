/**
 * /[locale]/my-account/connected-apps
 *
 * Buyer vidí 3rd party apps s OAuth accessem do jeho účtu. Může revoke.
 */
import { ConnectedAppsClient } from './ConnectedAppsClient';

interface Props {
  params: Promise<{ locale: string }>;
}

export default async function ConnectedAppsPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Připojené aplikace</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Tyto 3rd party aplikace mají přístup k tvému Tixly účtu. Přístup můžeš kdykoliv odvolat.
      </p>
      <ConnectedAppsClient locale={locale} />
    </div>
  );
}
