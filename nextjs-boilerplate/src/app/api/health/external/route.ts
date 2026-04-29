import { NextRequest, NextResponse } from 'next/server';
import { checkExternalApis } from '@/lib/health-check/health.service';
import { type ExternalApiCheckResponse } from '@/lib/health-check/types';

/**
 * GET /api/health/external?urls=url1,url2,url3
 *
 * External APIs health check endpoint
 * Checks availability and response time of external services
 *
 * Query parameters:
 *   - urls (required): Comma-separated list of URLs to check
 *   - timeout (optional): Timeout in milliseconds (default 5000)
 *
 * @returns External API health checks
 */
export async function GET(request: NextRequest) {
  try {
    const urls = request.nextUrl.searchParams.get('urls');
    const timeoutStr = request.nextUrl.searchParams.get('timeout');

    if (!urls || !urls.trim()) {
      return NextResponse.json(
        {
          status: 'healthy',
          checks: [],
          totalResponseTime: 0,
        },
        { status: 200 },
      );
    }

    const urlList = urls
      .split(',')
      .map((u) => u.trim())
      .filter((u) => u.length > 0)
      .filter((u) => {
        try {
          new URL(u);
          return true;
        } catch {
          return false;
        }
      });

    if (urlList.length === 0) {
      return NextResponse.json(
        {
          status: 'unhealthy',
          checks: [],
          totalResponseTime: 0,
          error: 'No valid URLs provided',
        },
        { status: 400 },
      );
    }

    const timeout = timeoutStr ? parseInt(timeoutStr, 10) : 5000;
    if (isNaN(timeout) || timeout < 100 || timeout > 30000) {
      return NextResponse.json(
        {
          status: 'unhealthy',
          checks: [],
          totalResponseTime: 0,
          error: 'Invalid timeout. Must be between 100 and 30000 milliseconds',
        },
        { status: 400 },
      );
    }

    const startTime = performance.now();
    const checks = await checkExternalApis({ urls: urlList, timeout });
    const totalResponseTime = Math.round(performance.now() - startTime);

    // Determine overall status
    const hasError = checks.some((c) => c.status === 'error');
    const hasSlow = checks.some((c) => c.status === 'slow');
    const status = hasError ? 'degraded' : hasSlow ? 'degraded' : 'healthy';

    const response: ExternalApiCheckResponse = {
      status,
      checks,
      totalResponseTime,
    };

    const statusCode = status === 'degraded' ? 200 : 200; // Return 200 for both healthy and degraded

    return NextResponse.json(response, { status: statusCode });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'External API check failed';

    return NextResponse.json(
      {
        status: 'unhealthy',
        checks: [],
        totalResponseTime: 0,
        error: errorMessage,
      },
      { status: 503 },
    );
  }
}
