/**
 * POST /api/platform/venues/[id]/seating-chart/from-image
 *
 * Vstup: { imageBase64, mediaType } — screenshot/foto plánu sálu.
 * Výstup: { builder: { stage, sectors:[{ name, groups:[{from,to,seats,aisleAfter?}] }] } }
 *
 * Claude vision přečte mapu sálu a vrátí strukturu pro jednoduchý builder (skupiny řad).
 * Master admin pak v UI ověří/doladí a uloží. Bez ANTHROPIC_API_KEY → 503 (nefejkujeme).
 */
import { NextRequest, NextResponse } from 'next/server';
import { runAsPlatformAdmin } from '@/lib/platform-auth';
import { z } from 'zod';

const bodySchema = z.object({
  imageBase64: z.string().min(100).max(8_000_000),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
});

const SYSTEM = `Jsi extraktor plánu hlediště (seating chart) pro ticketing platformu.
Z obrázku mapy sálu vyčti STRUKTURU sedadel a vrať ji jako JSON pro "skupiny řad".

Pravidla:
- Najdi jeviště/pódium: "top" (nahoře), "bottom" (dole), nebo "none" (není).
- Najdi sektory (např. Přízemí, Balkon, Parter, Lóže). Zachovej jejich názvy z obrázku.
- V každém sektoru seskup PO SOBĚ JDOUCÍ řady se STEJNÝM počtem sedadel do jedné skupiny
  {from, to, seats}. Řady čísluj tak, jak jsou na mapě (obvykle 1..N).
- Pokud má řada uprostřed uličku (mezeru mezi dvěma bloky), nastav "aisleAfter" = počet
  sedadel v levém bloku (tj. ulička je po tomto sedadle). Bez uličky pole vynech.
- Počítej sedadla co nejpřesněji podle mapy. Když si nejsi jistý počtem v řadě, odhadni
  z šířky bloku, ale drž konzistenci v rámci skupiny.

Vrať POUZE JSON, nic jiného, v tomto tvaru:
{"stage":"top|bottom|none","sectors":[{"name":"Přízemí","groups":[{"from":1,"to":15,"seats":16},{"from":16,"to":18,"seats":14}]},{"name":"Balkon","groups":[{"from":1,"to":6,"seats":18,"aisleAfter":9},{"from":7,"to":7,"seats":11,"aisleAfter":4}]}]}`;

const groupOut = z.object({
  from: z.number().int().min(1).max(500),
  to: z.number().int().min(1).max(500),
  seats: z.number().int().min(1).max(200),
  aisleAfter: z.number().int().min(0).max(200).optional(),
});
const builderOut = z.object({
  stage: z.enum(['top', 'bottom', 'none']),
  sectors: z.array(z.object({ name: z.string().min(1).max(100), groups: z.array(groupOut).min(1).max(100) })).min(1).max(50),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsPlatformAdmin(req, async () => {
    void params;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'VISION_UNAVAILABLE', message: 'Import z obrázku vyžaduje ANTHROPIC_API_KEY (sekce 2 launch checklistu). Zatím použij ruční builder nebo import dat.' },
        { status: 503 },
      );
    }

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 }); }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'BAD_INPUT', issues: parsed.error.issues }, { status: 422 });

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-opus-4-8',
          max_tokens: 2000,
          system: SYSTEM,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: parsed.data.mediaType, data: parsed.data.imageBase64 } },
                { type: 'text', text: 'Vyčti plán hlediště z této mapy a vrať JSON skupin řad.' },
              ],
            },
          ],
        }),
      });
      if (!res.ok) {
        return NextResponse.json({ error: 'VISION_HTTP', message: `Vision API selhalo (HTTP ${res.status}).` }, { status: 502 });
      }
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = data.content?.find((b) => b.type === 'text')?.text ?? '';
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return NextResponse.json({ error: 'VISION_PARSE', message: 'Vize nevrátila parsovatelný JSON.' }, { status: 502 });
      const builder = builderOut.safeParse(JSON.parse(m[0]));
      if (!builder.success) {
        return NextResponse.json({ error: 'VISION_SHAPE', message: 'Vize vrátila neočekávaný tvar.', issues: builder.error.issues }, { status: 502 });
      }
      const total = builder.data.sectors.reduce(
        (a, s) => a + s.groups.reduce((x, g) => x + Math.max(0, g.to - g.from + 1) * g.seats, 0), 0,
      );
      return NextResponse.json({ builder: builder.data, totalSeats: total });
    } catch (e) {
      return NextResponse.json({ error: 'VISION_EXCEPTION', message: e instanceof Error ? e.message.slice(0, 200) : 'unknown' }, { status: 502 });
    }
  });
}
