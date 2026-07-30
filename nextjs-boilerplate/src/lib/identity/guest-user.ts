/**
 * Sdílený guest-create / user-upsert helper.
 *
 * Root-cause remediace: 25 lokací v `src/` replikovalo tentýž `INSERT INTO
 * identity.users` ručně a rozcházelo se v tom, co dodává a jak řeší konflikt.
 * Schema-drift-guard je na tuhle třídu strukturálně slepý (parse-only PREPARE
 * nevidí NOT NULL / ON CONFLICT / CHECK), takže obrana musí být runtime —
 * viz `tests/guest-user.live.test.ts`.
 *
 * Ověřená fakta o `identity.users` (prod, information_schema):
 *   - `gdpr_consent_at` je NOT NULL BEZ defaultu → musí ho dodat každý INSERT
 *     (jinak 23502).
 *   - Jediný unique na e-mailu je PARTIAL:
 *       uq_identity_users_email_active UNIQUE (email) WHERE (anonymized_at IS NULL)
 *     → `ON CONFLICT (email)` bez predikátu nemá arbiter index a skončí 42P10.
 *   - `password_hash` je NULLABLE — sentinel je konvence, ne požadavek schématu.
 *   - `created_at` / `updated_at` mají DEFAULT now() → v INSERT listu jsou zbytečné.
 *   - Na tabulce visí trigger `trg_move_password` (migrace 335:50-54), podmínka
 *     `WHEN (NEW.password_hash IS NOT NULL)` — tedy NE „neprázdný", ale
 *     „ne NULL". Přesune hodnotu do `identity.user_secrets` a v `users` ji
 *     vynuluje. Sentinel v `users.password_hash` nikdy nezůstane a login
 *     (`auth/login:58`, INNER JOIN na `user_secrets`) proti němu bcryptem selže.
 *   - Důsledek pro guestlist, který dřív psal `''` místo `'!guest'`: `''` NENÍ
 *     NULL, takže trigger vystřelil i tehdy → řádek v `user_secrets` vznikl
 *     v obou variantách. Rozdíl je jen v uložené hodnotě sentinelu, a tu nikdo
 *     nerozlišuje: jediný čtenář je `bcrypt.compare` a ten vrací `false` pro
 *     `''`, `'!guest'` i `'!deleted'` (změřeno, 9 kombinací, žádný throw).
 *     Přechod na `'!guest'` je proto chování-zachovávající a navíc srovnává
 *     guestlist s ostatními 9 guest-create lokacemi, které `'!guest'` už psaly.
 *
 * Transakce: helper NEotevírá ani NEuzavírá transakci. Bere handle volajícího,
 * takže funguje jak uvnitř `client` transakce (23 z 25 lokací), tak
 * v autocommitu přes `db()` (waitlist, admin/import).
 */
import type { QueryResult, QueryResultRow } from 'pg';

/**
 * Minimální strukturální typ handle. Vyhoví jak `pg.PoolClient`
 * (`await db().connect()`), tak `RlsAwarePool` z `@/lib/db/rls-pool`.
 */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
}

/**
 * Sentinel v `password_hash` pro účty založené bez registrace. Není to platný
 * hash žádného hesla — na žádné heslo se nenahashuje, takže se přes něj nedá
 * přihlásit.
 */
export const GUEST_PASSWORD_HASH = '!guest';

/**
 * Co se má stát, když účet s tímhle e-mailem UŽ existuje (aktivní).
 *
 * Politiky NEJSOU designové preference — každá odpovídá jedné `ON CONFLICT`
 * akci, kterou nějaká call-site měla ve vlastní kopii SQL PŘED zavedením
 * helperu. Sjednocení na jednu politiku je samostatné produktové rozhodnutí
 * (mění chování vůči zákazníkovi), takže se tu ZÁMĚRNĚ reprodukuje původní
 * stav 1:1.
 *
 *  - `touch`         → `SET updated_at = NOW()`
 *                      Existující účet se nesahá. checkout, accreditation,
 *                      press, guestlist, waitlist.
 *  - `overwriteName` → `SET name = EXCLUDED.name`
 *                      Jméno se PŘEPÍŠE dodaným. Jen box-office/sell.
 *                      Pozor: původní SQL `updated_at` NEnastavovalo → tahle
 *                      politika ho taky nenastavuje.
 *  - `fillName`      → `SET name = COALESCE(EXCLUDED.name, users.name), updated_at = NOW()`
 *                      Jméno se doplní, jen když dodané není NULL. Jen comps.
 */
export type OnExistingPolicy = 'touch' | 'overwriteName' | 'fillName';

/**
 * Mapa politika → `ON CONFLICT ... DO UPDATE SET` klauzule.
 *
 * Bezpečnost interpolace: klíč je hodnota uzavřeného union typu, nikdy vstup
 * od uživatele — do SQL se tedy nedostane nic jiného než tyhle tři literály.
 */
const CONFLICT_ACTION: Record<OnExistingPolicy, string> = {
  touch: 'SET updated_at = NOW()',
  overwriteName: 'SET name = EXCLUDED.name',
  fillName: 'SET name = COALESCE(EXCLUDED.name, identity.users.name), updated_at = NOW()',
};

export interface GuestUserInput {
  /** E-mail kupujícího. Normalizuje se (trim + lowercase) uvnitř helperu. */
  email: string;
  /** Jméno; když chybí nebo je prázdné, uloží se e-mail jako placeholder. */
  name?: string | null;
  /**
   * Politika pro už existující účet. Default `touch` = existující účet nesahat
   * (to měla většina lokací). Odlišnou politiku předávej VŽDY explicitně
   * s odkazem na původní SQL, ať je při čtení jasné, že to není nedopatření.
   */
  onExisting?: OnExistingPolicy;
}

/**
 * Najde existující aktivní účet podle e-mailu, nebo založí guest účet.
 *
 * Vrací `id` uživatele. Dedup jde přes partial unique index, takže opakované
 * volání se stejným e-mailem vrátí totéž `id` a nevytvoří druhý řádek.
 *
 * Chování v hraničních případech (ověřeno reálným během, viz live test):
 *   - Anonymizovaný účet (GDPR) se stejným e-mailem se NEvzkřísí — partial
 *     index ho nevidí, takže vznikne nový aktivní řádek a anonymizovaný
 *     zůstane nedotčený.
 *   - Co se stane s UŽ EXISTUJÍCÍM účtem, řídí `onExisting` — viz
 *     `OnExistingPolicy`. Default `touch` existující účet nesahá.
 */
export async function createOrGetGuestUser(
  client: Queryable,
  input: GuestUserInput,
): Promise<string> {
  const email = input.email.trim().toLowerCase();
  if (!email) {
    throw new Error('createOrGetGuestUser: email je povinný');
  }
  const name = input.name?.trim() || email;
  const conflictAction = CONFLICT_ACTION[input.onExisting ?? 'touch'];

  // POZOR: `DO UPDATE`, ne `DO NOTHING`. `ON CONFLICT ... DO NOTHING RETURNING id`
  // při konfliktu NEvrátí žádný řádek (dokázáno v live testu) a helper by musel
  // dělat druhý SELECT. `DO UPDATE` řádek vrátí vždy — proto i politika
  // `overwriteName`, která by sama o sobě šla zapsat jako DO NOTHING, jde
  // přes DO UPDATE.
  const res = await client.query<{ id: string }>(
    `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (email) WHERE anonymized_at IS NULL
       DO UPDATE ${conflictAction}
     RETURNING id`,
    [email, name, GUEST_PASSWORD_HASH],
  );

  if (res.rows.length === 0) {
    // Nemělo by nastat — DO UPDATE vrací řádek vždy. Pojistka proti tomu, aby
    // někdo v budoucnu přepsal klauzuli na DO NOTHING a rozbil to potichu.
    throw new Error('createOrGetGuestUser: upsert nevrátil řádek');
  }
  return res.rows[0].id;
}
