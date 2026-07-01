/**
 * POST /api/platform/venues/[id]/seating-chart/from-text-stadium
 *
 * Vstup: { prompt } — popis stadionu ("stadion pro 50 000, 4 tribuny, 2 patra").
 * Výstup: { spec } — parametry pro generateStadium (tribuny N/S/E/W + rohy).
 *
 * Klient pak spec prožene generateStadium a rozmístí sedadla do mísy.
 * Fail-closed bez ANTHROPIC_API_KEY (503). Zrcadlí from-text, jen jiný output.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsPlatformAdmin } from '@/lib/platform-auth';

const standSchema = z.object({
  side: z.enum(['N', 'S', 'E', 'W']),
  name: z.string().min(1).max(60),
  rows: z.number().int().min(1).max(120),
  seatsPerRow: z.number().int().min(1).max(400),
  tiers: z.number().int().min(1).max(5).optional(),
});
const specSchema = z.object({
  pitchLabel: z.string().min(1).max(40).optional(),
  stands: z.array(standSchema).min(1).max(4),
  corners: z.boolean().optional(),
  cornerRows: z.number().int().min(1).max(60).optional(),
  cornerSeatsPerRow: z.number().int().min(1).max(120).optional(),
});

const bodySchema = z.object({ prompt: z.string().min(3).max(2000) });

const SYSTEM = `Jsi generátor parametrů velkého stadionu (fotbal/atletika) pro ticketing platformu.
Z textového popisu vrať JSON s tribunami kolem hřiště a volitelnými rohy.

Pravidla:
- Strany tribun: "N" = Sever, "S" = Jih, "E" = Východ, "W" = Západ. Když zadání říká
  "4 tribuny", udělej všechny čtyři (N, S, E, W).
- Každá tribuna: {side, name, rows (počet řad), seatsPerRow (míst v řadě), tiers (patra, default 1)}.
- Kapacita tribuny = rows × seatsPerRow × tiers. Rohy přidají 4 × cornerRows × cornerSeatsPerRow.
- Navrhni rozměry tak, aby CELKOVÁ kapacita zhruba odpovídala zadání (např. "pro 50 000"
  → součet všech tribun + rohů ≈ 50 000). Boční tribuny (E/W) bývají kratší než čelní (N/S).
- "corners": true/false. Když ano, nastav cornerRows a cornerSeatsPerRow.
- Když zadání mluví o patrech, nastav tiers.

Vrať POUZE JSON, nic jiného, např.:
{"pitchLabel":"HŘIŠTĚ","stands":[{"side":"N","name":"Sever","rows":42,"seatsPerRow":220,"tiers":2},{"side":"S","name":"Jih","rows":42,"seatsPerRow":220,"tiers":2},{"side":"E","name":"Východ","rows":30,"seatsPerRow":150,"tiers":1},{"side":"W","name":"Západ","rows":30,"seatsPerRow":150,"tiers":1}],"corners":true,"cornerRows":18,"cornerSeatsPerRow":20}`;

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsPlatformAdmin(req, async () => {
    void params;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error: 'AI_UNAVAILABLE',
          message: 'Generování stadionu z textu vyžaduje ANTHROPIC_API_KEY. Zatím vyplň tribuny ručně.',
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

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-opus-4-8',
          max_tokens: 1500,
          system: SYSTEM,
          messages: [{ role: 'user', content: [{ type: 'text', text: `Zadání stadionu: ${parsed.data.prompt}` }] }],
        }),
      });
      if (!res.ok) {
        return NextResponse.json({ error: 'AI_HTTP', message: `AI API selhalo (HTTP ${res.status}).` }, { status: 502 });
      }
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = data.content?.find((b) => b.type === 'text')?.text ?? '';
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return NextResponse.json({ error: 'AI_PARSE', message: 'AI nevrátila parsovatelný JSON.' }, { status: 502 });
      const spec = specSchema.safeParse(JSON.parse(m[0]));
      if (!spec.success) {
        return NextResponse.json({ error: 'AI_SHAPE', message: 'AI vrátila neočekávaný tvar.', issues: spec.error.issues }, { status: 502 });
      }
      const total = spec.data.stands.reduce((a, s) => a + s.rows * s.seatsPerRow * (s.tiers ?? 1), 0)
        + (spec.data.corners ? 4 * (spec.data.cornerRows ?? 12) * (spec.data.cornerSeatsPerRow ?? 14) : 0);
      return NextResponse.json({ spec: spec.data, totalSeats: total });
    } catch (e) {
      return NextResponse.json({ error: 'AI_EXCEPTION', message: e instanceof Error ? e.message.slice(0, 200) : 'unknown' }, { status: 502 });
    }
  });
}
