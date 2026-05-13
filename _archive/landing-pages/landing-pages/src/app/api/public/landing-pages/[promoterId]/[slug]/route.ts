import { NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import { errorResponse } from '../../../../../../lib/route-helpers.js';
import { renderLandingPage } from '../../../../../../services/page-renderer.service.js';

export async function GET(
  _request: Request,
  { params }: { params: { promoterId: string; slug: string } },
) {
  try {
    const rendered = await renderLandingPage(
      params.promoterId,
      params.slug,
      getServiceDeps(),
    );
    if (!rendered) {
      return NextResponse.json(
        { error: { code: 'PAGE_NOT_FOUND', message: 'Stránka nebyla nalezena.' } },
        { status: 404 },
      );
    }
    return new NextResponse(rendered.html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Landing-Meta': JSON.stringify(rendered.meta),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
