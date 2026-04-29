// =============================================================================
// AI ad copy generator — Feature #166
//
// AI generuje připravený text pro Facebook Ads, Instagram Ads, email kampaně.
// Vstup: akce + cílová skupina → výstup: headlines, body copy, CTA varianty.
//
// SCHEMA: ai_ads.* (migration 120)
// =============================================================================

export interface AdCopyGeneratorInput {
  eventTitle: string;
  eventDescription: string;
  eventDate: string;
  venueAddress: string;
  targetAudience: 'general' | 'students' | 'professionals' | 'families' | 'tourists';
  eventCategory: string;
  lang: 'cs' | 'en';
}

export interface GeneratedAdCopy {
  id: string;
  eventId: string;
  promoterId: string;
  platform: 'facebook' | 'instagram' | 'email';
  headlines: string[];           // 3–5 variant headlines
  bodyCopy: string[];            // 2–3 body copy varianty
  callToActions: string[];       // 3–5 CTA tlačítko varianty
  generatedAt: string;
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

export interface CallAiFn {
  (prompt: string, options: { model?: string }): Promise<string>;
}

interface AdCopyRow {
  id: string;
  event_id: string;
  promoter_id: string;
  platform: string;
  headlines: string[];
  body_copy: string[];
  call_to_actions: string[];
  generated_at: string;
}

function mapAdCopy(row: AdCopyRow): GeneratedAdCopy {
  return {
    id: row.id,
    eventId: row.event_id,
    promoterId: row.promoter_id,
    platform: row.platform as 'facebook' | 'instagram' | 'email',
    headlines: row.headlines,
    bodyCopy: row.body_copy,
    callToActions: row.call_to_actions,
    generatedAt: row.generated_at,
  };
}

/**
 * Generuje ad copy pro konkrétní platformu a cílovou skupinu.
 * Využívá Claude Haiku model (rychlejší, levnější).
 */
export async function generateAdCopy(
  eventId: string,
  promoterId: string,
  input: AdCopyGeneratorInput,
  callAi: CallAiFn,
  db: DbAdapter,
): Promise<GeneratedAdCopy> {
  const platformDescriptions: Record<string, string> = {
    facebook: 'Facebook Ads (textová propoaga, max 125 znaků na headline)',
    instagram: 'Instagram Stories Ads (krátké, do-the-point, emotikonové)',
    email: 'Email kampáně (profesionální, informativní)',
  };

  const prompt = `Jsi copywriter pro ticketovací platformu Tixly.
Akce: ${input.eventTitle}
Popis: ${input.eventDescription}
Datum: ${input.eventDate}
Místo: ${input.venueAddress}
Kategorie: ${input.eventCategory}
Cílová skupina: ${input.targetAudience} (${input.targetAudience === 'students' ? 'studenti (levné vstupenky, zábava)' : input.targetAudience === 'professionals' ? 'profesionálové (networking, kvalita)' : input.targetAudience === 'families' ? 'rodiny (bezpečí, aktivita pro děti)' : input.targetAudience === 'tourists' ? 'turisti (unique experience, instagramable)' : 'všichni (broadest appeal)'})

Vygeneruj ad copy pro ${platformDescriptions.facebook}:
- 3–5 headlines (jasné benefity, urgence či curiosity)
- 2–3 body copy texty (story-driven, emotivní appeal)
- 3–5 CTA varianty ("Koupit vstupenku", "Zjistit více", "Rezervovat místo")

Vrať výsledek jako JSON:
{
  "headlines": ["...", "..."],
  "bodyCopy": ["...", "..."],
  "callToActions": ["...", "..."]
}`;

  let response: string;
  try {
    response = await callAi(prompt, { model: 'haiku' });
  } catch (err) {
    throw new Error(`AI_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Parse JSON response (handle markdown fences)
  const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/) || response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('INVALID_RESPONSE: Could not parse AI response as JSON');
  }
  const json = JSON.parse(jsonMatch[1] || jsonMatch[0]);

  const rows = await db.query<AdCopyRow>(
    `INSERT INTO ai_ads.generated_ad_copies
       (event_id, promoter_id, platform, headlines, body_copy, call_to_actions)
     VALUES ($1, $2, 'facebook', $3::text[], $4::text[], $5::text[])
     RETURNING *`,
    [
      eventId,
      promoterId,
      JSON.stringify(json.headlines || []),
      JSON.stringify(json.bodyCopy || []),
      JSON.stringify(json.callToActions || []),
    ],
  );
  if (!rows[0]) throw new Error('INTERNAL_ERROR: ad copy insert failed');
  return mapAdCopy(rows[0]);
}

/**
 * Vrátí historii vygenerovaných ad copy pro event.
 */
export async function listGeneratedCopies(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<GeneratedAdCopy[]> {
  const rows = await db.query<AdCopyRow>(
    `SELECT * FROM ai_ads.generated_ad_copies
     WHERE event_id = $1 AND promoter_id = $2
     ORDER BY generated_at DESC`,
    [eventId, promoterId],
  );
  return rows.map(mapAdCopy);
}
