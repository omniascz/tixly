import { notFound } from 'next/navigation';
import { Pool } from 'pg';
import { VoucherCheckoutForm } from './VoucherCheckoutForm';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface PromoterRow {
  id: string;
  slug: string;
  name: string;
  brand_color_hex: string | null;
  brand_logo_url: string | null;
}

async function fetchPromoter(slug: string): Promise<PromoterRow | null> {
  if (!/^[a-z0-9-]{2,80}$/.test(slug)) return null;
  // RLS bypass — public landing page (read-only metadata)
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);
    const r = await client.query<PromoterRow>(
      `SELECT id, slug, name, brand_color_hex, brand_logo_url
         FROM platform.promoters
        WHERE slug = $1 AND status = 'active'`,
      [slug],
    );
    await client.query('COMMIT');
    return r.rows[0] ?? null;
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    return null;
  } finally {
    client.release();
  }
}

export default async function PromoterVouchersPage({
  params,
}: {
  params: { locale: string; slug: string };
}): Promise<JSX.Element> {
  const promoter = await fetchPromoter(params.slug);
  if (!promoter) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <header className="text-center">
        <h1 className="text-3xl font-bold">Dárkové poukazy</h1>
        <p className="text-muted-foreground">
          {promoter.name}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Kupte poukaz na představení {promoter.name}. Platnost <strong>3 roky</strong>,
          uplatnitelný na všechny akce pořadatele.
        </p>
      </header>

      <VoucherCheckoutForm slug={promoter.slug} promoterName={promoter.name} />

      <section className="rounded-md border bg-muted/30 p-4 text-sm">
        <h2 className="mb-2 font-semibold">Jak to funguje</h2>
        <ol className="ml-4 list-decimal space-y-1 text-muted-foreground">
          <li>Vyber hodnotu poukazu nebo zadej vlastní částku.</li>
          <li>Volitelně přidej jméno a email obdarovaného (pošleme PDF).</li>
          <li>Po platbě obdržíš kód, kterým buď ty nebo obdarovaný zaplatí libovolnou akci pořadatele.</li>
          <li>Platí 3 roky od data nákupu.</li>
        </ol>
      </section>
    </div>
  );
}
