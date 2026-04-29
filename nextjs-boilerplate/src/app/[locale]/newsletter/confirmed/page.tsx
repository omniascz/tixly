export default function NewsletterConfirmedPage({
  searchParams,
}: {
  searchParams: { status?: string; error?: string };
}) {
  const isOk = searchParams.status === 'ok';
  return (
    <div className="mx-auto max-w-md py-12 text-center">
      {isOk ? (
        <>
          <div className="text-4xl">✅</div>
          <h1 className="mt-3 text-2xl font-bold">Potvrzeno!</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Tvůj e-mail je úspěšně přihlášený k odběru. Děkujeme!
          </p>
        </>
      ) : (
        <>
          <div className="text-4xl">⚠️</div>
          <h1 className="mt-3 text-2xl font-bold">Něco se nezdařilo</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {searchParams.error === 'invalid-token'
              ? 'Token je neplatný nebo už byl použit.'
              : 'Zkus prosím znovu.'}
          </p>
        </>
      )}
    </div>
  );
}
