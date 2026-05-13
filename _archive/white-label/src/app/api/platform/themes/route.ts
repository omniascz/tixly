import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { getTenantTheme, saveTenantTheme } from '../../../../services/theme.service';
import { isWhiteLabelError } from '../../../../lib/plan-enforcement';
import type { ThemeDeps } from '../../../../services/theme.service';

const UpdateThemeSchema = z.object({
  logoUrl:         z.string().url().optional(),
  faviconUrl:      z.string().url().optional(),
  heroImageUrl:    z.string().url().optional(),
  primaryColor:    z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  secondaryColor:  z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  accentColor:     z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  fontFamily:      z.string().max(100).optional(),
  footerText:      z.string().max(500).optional(),
  poweredByHidden: z.boolean().optional(),
  customCss:       z.string().max(51200).optional(),
});

export async function GET(
  request: NextRequest,
  { deps }: { deps?: ThemeDeps } = {},
): Promise<NextResponse> {
  const resolvedDeps = deps ?? getProductionDeps();
  const promoterId = request.headers.get('x-promoter-id');
  if (!promoterId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  try {
    const theme = await getTenantTheme(promoterId, resolvedDeps);
    return NextResponse.json(theme);
  } catch (err) {
    if (isWhiteLabelError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

export async function PUT(
  request: NextRequest,
  { deps }: { deps?: ThemeDeps } = {},
): Promise<NextResponse> {
  const resolvedDeps = deps ?? getProductionDeps();
  const promoterId = request.headers.get('x-promoter-id');
  if (!promoterId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  let input: z.infer<typeof UpdateThemeSchema>;
  try {
    input = UpdateThemeSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', details: err.errors }, { status: 400 });
    }
    throw err;
  }

  try {
    const theme = await saveTenantTheme(promoterId, input, resolvedDeps);
    return NextResponse.json(theme);
  } catch (err) {
    if (isWhiteLabelError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

function getProductionDeps(): ThemeDeps {
  throw new Error('Production deps not configured');
}
