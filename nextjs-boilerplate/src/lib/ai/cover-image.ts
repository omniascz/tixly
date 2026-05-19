/**
 * AI cover image generation.
 *
 * Production: volá DALL-E 3 / FAL.ai / Stable Diffusion API.
 * Demo (AI_IMAGE_MODE=stub nebo missing API key): vrátí 4 deterministické
 * gradient-based placeholder URL pomocí naší existing /api/og route.
 *
 * Pro real production:
 *   - process.env.OPENAI_API_KEY → DALL-E 3 endpoint
 *   - response.data[0].url → upload do S3/Cloudinary → vrátí permanent URL
 */

import { createHash } from 'crypto';

export interface CoverImageRequest {
  title: string;
  category: string;
  vibe?: string; // např. 'energetic', 'elegant', 'underground'
  primaryColor?: string;
}

export interface CoverImageVariant {
  url: string;
  prompt: string;
  provider: 'stub' | 'dalle3' | 'fal' | 'sd';
}

const VIBE_PALETTES: Record<string, string[]> = {
  energetic: ['#ef4444', '#f59e0b', '#ec4899'],
  elegant: ['#1e293b', '#475569', '#7c3aed'],
  underground: ['#0f172a', '#7f1d1d', '#a3e635'],
  family: ['#06b6d4', '#84cc16', '#fbbf24'],
  classical: ['#7c2d12', '#a16207', '#c2410c'],
  default: ['#6C47FF', '#8b5cf6', '#3b82f6'],
};

function deterministicHue(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) hash = (hash * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

export async function generateCoverImage(
  req: CoverImageRequest,
): Promise<CoverImageVariant[]> {
  const mode = process.env.AI_IMAGE_MODE ?? 'stub';
  if (mode !== 'stub' && process.env.OPENAI_API_KEY) {
    return generateWithDalle(req);
  }
  return generateStubVariants(req);
}

async function generateWithDalle(req: CoverImageRequest): Promise<CoverImageVariant[]> {
  const apiKey = process.env.OPENAI_API_KEY!;
  const prompts = buildPrompts(req);
  const out: CoverImageVariant[] = [];
  for (const prompt of prompts) {
    try {
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt,
          size: '1792x1024',
          quality: 'standard',
          n: 1,
        }),
      });
      if (!res.ok) continue;
      const j = (await res.json()) as { data?: { url: string }[] };
      if (j.data?.[0]?.url) {
        out.push({ url: j.data[0].url, prompt, provider: 'dalle3' });
      }
    } catch (err) {
      console.error('[ai cover dalle]', err);
    }
  }
  return out.length > 0 ? out : generateStubVariants(req);
}

function buildPrompts(req: CoverImageRequest): string[] {
  const base = `Promotional event cover image, 16:9 widescreen, professional photography style. Event: "${req.title}". Category: ${req.category}.`;
  const styles = [
    'Cinematic dramatic lighting, vibrant colors, dynamic composition',
    'Minimalist modern design, abstract geometric shapes, bold typography placeholder',
    'Atmospheric mood photography, soft bokeh, warm tones',
    'Bold graphic design, high contrast, pop art aesthetic',
  ];
  return styles.map((s) => `${base} Style: ${s}. No text, no logos, no watermarks.`);
}

function generateStubVariants(req: CoverImageRequest): CoverImageVariant[] {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const palette = VIBE_PALETTES[req.vibe ?? 'default'] ?? VIBE_PALETTES.default;
  // 4 variants — různé hue offsets
  const baseHue = deterministicHue(req.title);
  const variants: CoverImageVariant[] = [];
  for (let i = 0; i < 4; i++) {
    const hue = (baseHue + i * 47) % 360;
    const seed = createHash('sha256').update(`${req.title}|${i}`).digest('hex').slice(0, 8);
    variants.push({
      url: `${baseUrl}/api/ai/cover-stub?seed=${seed}&hue=${hue}&palette=${palette[i % palette.length].replace('#', '')}&title=${encodeURIComponent(req.title)}`,
      prompt: `Stub variant ${i + 1}: hue=${hue}, palette=${palette[i % palette.length]}`,
      provider: 'stub',
    });
  }
  return variants;
}
