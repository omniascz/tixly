/**
 * POST /api/platform/venues/[id]/seating-chart/from-text
 *
 * Vstup: { prompt, currentBuilder? }
 *   - bez currentBuilder → vygeneruje NOVÝ plán sálu z textového popisu
 *     (např. „sál 15 řad po 17 místech, jeviště nahoře")
 *   - s currentBuilder → UPRAVÍ stávající plán podle instrukce
 *     (např. „přidej balkon vlevo a vpravo, vždy 15 míst")
 *
 * Výstup: { builder: { stage, sectors:[{ name, groups:[{from,to,seats,aisleAfter?}] }] }, totalSeats }
 *
 * Stejná struktura jako from-image, jen textový vstup místo obrázku.
 * Master admin výsledek v UI ověří/doladí a uloží. Bez ANTHROPIC_API_KEY → 503 (nefejkujeme).
 *
 * Pozn.: geometrie grid builderu skládá sektory pod sebe; „balkon vlevo/vpravo" se
 * reprezentuje jako samostatné pojmenované sektory (Balkon vlevo / Balkon vpravo).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsPlatformAdmin } from '@/lib/platform-auth';

const groupSchema = z.object({
  from: z.number().int().min(1).max(500),
  to: z.number().int().min(1).max(500),
  seats: z.number().int().min(1).max(200),
  aisleAfter: z.number().int().min(0).max(200).optional(),
});
const builderShape = z.object({
  stage: z.enum(['top', 'bottom', 'none']),
  sectors: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        groups: z.array(groupSchema).min(1).max(100),
        placement: z.enum(['front', 'left', 'right']).optional(),
      }),
    )
    .min(1)
    .max(50),
});

const bodySchema = z.object({
  prompt: z.string().min(3).max(2000),
  currentBuilder: builderShape.optional(),
});

const SYSTEM = `Jsi generátor plánu hlediště (seating chart) pro ticketing platformu.
Podle textového zadání vrať STRUKTURU sedadel jako JSON pro "skupiny řad".

Pravidla:
- "stage": "top" (jeviště nahoře), "bottom" (dole), nebo "none" (bez jeviště). Default "top".
- Sektory = pojmenované bloky (Přízemí, Balkon, Parter, Lóže…). Když zadání mluví o jednom
  sále bez sektorů, udělej jeden sektor "Přízemí".
- V každém sektoru seskup PO SOBĚ JDOUCÍ řady se STEJNÝM počtem sedadel do jedné skupiny
  {from, to, seats}. "15 řad po 17 místech" = jedna skupina {from:1,to:15,seats:17}.
- "aisleAfter" = počet sedadel v levém bloku, pokud má řada uprostřed uličku. Jinak vynech.
- "placement" = umístění sektoru: "front" (parter/přízemí a zadní balkon — vodorovné řady
  pod sebou, default), "left" (boční balkon/lóže VLEVO), "right" (boční balkon/lóže VPRAVO).
  Když zadání mluví o balkonu vlevo/vpravo, použij placement "left"/"right".
- Když UPRAVUJEŠ stávající plán (dostaneš CURRENT), vrať CELÝ upravený plán,
  ne jen změnu. Zachovej sektory a řady, které se úpravy netýkají.
- Drž se zadání co nejpřesněji. Nevymýšlej sektory navíc.

Vrať POUZE JSON, nic jiného, v tomto tvaru:
{"stage":"top|bottom|none","sectors":[{"name":"Přízemí","placement":"front","groups":[{"from":1,"to":15,"seats":17}]},{"name":"Balkon vlevo","placement":"left","groups":[{"from":1,"to":3,"seats":10}]}]}`;

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsPlatformAdmin(req, async () => {
    void params;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error: 'AI_UNAVAILABLE',
          message:
            'Generování z textu vyžaduje ANTHROPIC_API_KEY (sekce 2 launch checklistu). Zatím použij šablony nebo ruční builder.',
        },
        { status: 503 },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'BAD_INPUT', issues: parsed.error.issues }, { status: 422 });

    const userText = parsed.data.currentBuilder
      ? `CURRENT plán (uprav ho podle instrukce a vrať CELÝ upravený):\n${JSON.stringify(parsed.data.currentBuilder)}\n\nInstrukce: ${parsed.data.prompt}`
      : `Zadání sálu: ${parsed.data.prompt}`;

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-opus-4-8',
          max_tokens: 2000,
          system: SYSTEM,
          messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
        }),
      });
      if (!res.ok) {
        return NextResponse.json({ error: 'AI_HTTP', message: `AI API selhalo (HTTP ${res.status}).` }, { status: 502 });
      }
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = data.content?.find((b) => b.type === 'text')?.text ?? '';
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return NextResponse.json({ error: 'AI_PARSE', message: 'AI nevrátila parsovatelný JSON.' }, { status: 502 });
      const builder = builderShape.safeParse(JSON.parse(m[0]));
      if (!builder.success) {
        return NextResponse.json({ error: 'AI_SHAPE', message: 'AI vrátila neočekávaný tvar.', issues: builder.error.issues }, { status: 502 });
      }
      const total = builder.data.sectors.reduce(
        (a, s) => a + s.groups.reduce((x, g) => x + Math.max(0, g.to - g.from + 1) * g.seats, 0),
        0,
      );
      return NextResponse.json({ builder: builder.data, totalSeats: total });
    } catch (e) {
      return NextResponse.json({ error: 'AI_EXCEPTION', message: e instanceof Error ? e.message.slice(0, 200) : 'unknown' }, { status: 502 });
    }
  });
}
