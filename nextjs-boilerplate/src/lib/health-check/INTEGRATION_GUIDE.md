# Health Check System Integration Guide

This guide explains how to integrate the health check system into your application and configure it with uptime monitoring services.

## Overview

The health check system provides:
- **Main endpoint** (`/api/health`): Complete system health with all services
- **Service endpoints**: Individual checks for database, Redis, and external APIs
- **Monitoring compatibility**: BetterStack, UptimeRobot, Datadog, Prometheus

## Files

- `types.ts` - TypeScript type definitions
- `health.service.ts` - Core health check service logic
- `health.integration.ts` - Database/Redis client initialization helpers
- `route.ts` - Main health endpoint
- `db/route.ts` - Database health check
- `redis/route.ts` - Redis health check
- `external/route.ts` - External API health checks

## Setup

### 1. Environment Configuration

Add to your `.env.local` or `.env`:

```bash
# Database (if using PostgreSQL)
DATABASE_URL=postgresql://user:password@localhost:5432/mydb

# Redis (if using Redis for caching)
REDIS_URL=redis://localhost:6379

# External APIs to monitor (comma-separated)
EXTERNAL_HEALTH_CHECK_APIS=https://api.stripe.com/health,https://api.gopay.example.com/status

# Timeouts (in milliseconds)
HEALTH_CHECK_DB_TIMEOUT=1000
HEALTH_CHECK_REDIS_TIMEOUT=100
HEALTH_CHECK_EXTERNAL_TIMEOUT=5000
```

### 2. Initialize Database Client in Your App

If you have a custom database client initialization, update your `/api/health/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSystemHealth } from '@/lib/health-check/health.service';
import { getHealthCheckClients } from '@/lib/health-check/health.integration';

export async function GET(request: NextRequest) {
  const { db, redis, externalApis } = await getHealthCheckClients();
  
  try {
    const externalApiUrls = request.nextUrl.searchParams.get('apis')
      ? request.nextUrl.searchParams.get('apis')!.split(',').filter(Boolean)
      : externalApis;

    const systemHealth = await getSystemHealth(db, redis, externalApiUrls);
    const statusCode = systemHealth.status === 'unhealthy' ? 503 : 200;

    return NextResponse.json(systemHealth, { status: statusCode });
  } catch (error) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        services: [],
        totalResponseTime: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 503 },
    );
  } finally {
    // Clean up database connections
    if (db) {
      try {
        await db.end();
      } catch {
        // Connection already closed
      }
    }

    // Clean up Redis connections
    if (redis) {
      try {
        if ('disconnect' in redis) {
          await redis.disconnect();
        }
      } catch {
        // Connection already closed
      }
    }
  }
}
```

### 3. Module-Level Health Endpoints

For each microservice/module (gopay-payments, stripe-payments, etc.), create your own `/health` endpoint:

```typescript
// gopay-payments/src/app/api/health/route.ts
import { NextResponse } from 'next/server';
import { checkExternalApi } from '@/lib/health-check/health.service';

export async function GET() {
  const goPayHealth = await checkExternalApi('https://api.gopay.example.com/status', 5000);

  return NextResponse.json(
    {
      status: goPayHealth.status === 'ok' ? 'healthy' : 'unhealthy',
      service: 'gopay_payments',
      responseTime: goPayHealth.responseTime,
      error: goPayHealth.error,
      timestamp: new Date().toISOString(),
    },
    { status: goPayHealth.status === 'ok' ? 200 : 503 },
  );
}
```

## API Usage

### Main Health Endpoint

**GET /api/health**

```bash
curl http://localhost:3000/api/health

# With external APIs to check
curl "http://localhost:3000/api/health?apis=https://api1.example.com,https://api2.example.com"
```

**Response (Healthy, 200 OK):**
```json
{
  "status": "healthy",
  "timestamp": "2026-04-18T12:34:56.123Z",
  "totalResponseTime": 245,
  "services": [
    {
      "name": "database",
      "status": "healthy",
      "responseTime": 12,
      "checks": {
        "db": {
          "status": "ok",
          "responseTime": 12
        }
      }
    },
    {
      "name": "redis",
      "status": "healthy",
      "responseTime": 8,
      "checks": {
        "redis": {
          "status": "ok",
          "responseTime": 8
        }
      }
    },
    {
      "name": "external_apis",
      "status": "degraded",
      "responseTime": 1500,
      "checks": {
        "external": [
          {
            "url": "https://api.stripe.com/health",
            "status": "ok",
            "responseTime": 145
          },
          {
            "url": "https://api.gopay.example.com/status",
            "status": "slow",
            "responseTime": 1500
          }
        ]
      }
    }
  ]
}
```

**Response (Unhealthy, 503 Service Unavailable):**
```json
{
  "status": "unhealthy",
  "timestamp": "2026-04-18T12:34:56.123Z",
  "totalResponseTime": 100,
  "services": [
    {
      "name": "database",
      "status": "unhealthy",
      "responseTime": 100,
      "checks": {
        "db": {
          "status": "error",
          "responseTime": 100,
          "error": "Connection refused"
        }
      },
      "error": "Connection refused"
    }
  ]
}
```

### Database Health Endpoint

**GET /api/health/db**

Fast endpoint for database connectivity check (target < 200ms).

```bash
curl http://localhost:3000/api/health/db
```

**Response:**
```json
{
  "status": "ok",
  "responseTime": 12
}
```

### Redis Health Endpoint

**GET /api/health/redis**

Fast endpoint for Redis connectivity check (target < 50ms).

```bash
curl http://localhost:3000/api/health/redis
```

**Response:**
```json
{
  "status": "ok",
  "responseTime": 8
}
```

### External APIs Health Endpoint

**GET /api/health/external?urls=url1,url2&timeout=5000**

Check multiple external APIs with custom timeout.

```bash
curl "http://localhost:3000/api/health/external?urls=https://api.stripe.com,https://api.gopay.example.com&timeout=3000"
```

**Response:**
```json
{
  "status": "degraded",
  "checks": [
    {
      "url": "https://api.stripe.com",
      "status": "ok",
      "responseTime": 145
    },
    {
      "url": "https://api.gopay.example.com",
      "status": "slow",
      "responseTime": 1500
    }
  ],
  "totalResponseTime": 1645
}
```

## Uptime Monitoring Integration

### BetterStack

1. Go to **BetterStack Monitoring** → **New Monitor**
2. Configure:
   - **URL**: `https://your-domain.com/api/health`
   - **Check frequency**: Every 60 seconds (or customize)
   - **HTTP method**: GET
   - **Expected status code**: 200

Optional: Set up status page webhook for real-time status:

```
POST https://uptime.betterstack.com/api/v2/monitors/{monitor_id}/escalation_policies
```

### UptimeRobot

1. Go to **UptimeRobot Dashboard** → **Add Monitor**
2. Configure:
   - **Monitor type**: HTTP(s)
   - **URL**: `https://your-domain.com/api/health`
   - **Monitoring interval**: Every 5 minutes (free plan)
   - **HTTP method**: GET

Custom alerts:
- Alert when status changes to 503
- Alert when response time exceeds threshold

### Datadog

1. Set up in Datadog Agent configuration:

```yaml
# datadog.yaml
api_key: <YOUR_API_KEY>

# In custom checks directory
http_checks:
  instances:
    - name: ticketing_platform_health
      url: https://your-domain.com/api/health
      method: GET
      timeout: 10
```

2. Or use Datadog Synthetics:
   - **Create Test** → **API Test**
   - **HTTP method**: GET
   - **URL**: `https://your-domain.com/api/health`
   - **Assertions**:
     - Status code equals 200 or 503
     - Response time is less than 1000ms
     - JSON contains `status` field

### Prometheus Metrics (Future Enhancement)

Add Prometheus `/metrics` endpoint:

```typescript
// /api/metrics
export async function GET() {
  const health = await getSystemHealth();
  
  const prometheusMetrics = `
# HELP ticketing_platform_health_status System health status (1=healthy, 0.5=degraded, 0=unhealthy)
# TYPE ticketing_platform_health_status gauge
ticketing_platform_health_status {status="${health.status}"} ${getStatusValue(health.status)}

# HELP ticketing_platform_response_time_ms Total health check response time in milliseconds
# TYPE ticketing_platform_response_time_ms gauge
ticketing_platform_response_time_ms ${health.totalResponseTime}

# HELP ticketing_platform_service_status Individual service status
# TYPE ticketing_platform_service_status gauge
${health.services.map((s) => 
  `ticketing_platform_service_status{service="${s.name}",status="${s.status}"} ${getStatusValue(s.status)}`
).join('\n')}
  `.trim();

  return new Response(prometheusMetrics, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
```

## Health Status Thresholds

The system uses these thresholds to determine health:

### Database
- **Healthy (ok)**: Response time < 1000ms
- **Degraded (slow)**: Response time >= 1000ms
- **Unhealthy (error)**: Connection failed

### Redis
- **Healthy (ok)**: Response time < 100ms
- **Degraded (slow)**: Response time >= 100ms
- **Unhealthy (error)**: PING failed

### External APIs
- **Healthy (ok)**: Response time < 1000ms and HTTP 2xx
- **Degraded (slow)**: Response time >= 1000ms or HTTP 4xx/5xx
- **Unhealthy (error)**: Timeout or critical error

### System Overall
- **Healthy**: All services are healthy
- **Degraded**: Any service is slow or has non-critical errors
- **Unhealthy**: Any service is down (connection error)

## Performance Targets

- **Main endpoint**: < 1 second total
- **Database check**: < 200ms
- **Redis check**: < 50ms
- **External API check**: < 5 seconds (configurable per API)

## Testing

Run tests with:

```bash
npm run test -- health.service.test.ts
npm run test -- api/health.test.ts
```

## Troubleshooting

### Health check returning 503 when service is up

1. Check database connectivity:
   ```bash
   curl http://localhost:3000/api/health/db
   ```

2. Check Redis connectivity:
   ```bash
   curl http://localhost:3000/api/health/redis
   ```

3. Check external APIs:
   ```bash
   curl "http://localhost:3000/api/health/external?urls=https://api.example.com"
   ```

### External APIs timing out

Increase timeout:

```bash
curl "http://localhost:3000/api/health/external?urls=https://api.example.com&timeout=10000"
```

### Health checks are slow

Monitor individual components:
- Database is slow: Optimize queries or add indexes
- Redis is slow: Check Redis memory usage or network latency
- External APIs are slow: Contact provider or add circuit breaker

## Migration Path

### Phase 1: Deploy health endpoints
- Deploy code without connecting real DB/Redis clients
- Verify endpoints are accessible

### Phase 2: Connect database
- Update `getHealthCheckClients()` to initialize real DB client
- Test database health checks

### Phase 3: Connect Redis
- Update environment with REDIS_URL
- Test Redis health checks

### Phase 4: Add external API monitoring
- Configure EXTERNAL_HEALTH_CHECK_APIS environment variable
- Test external API health checks

### Phase 5: Configure uptime monitoring
- Set up BetterStack or UptimeRobot monitor
- Verify alerts are triggered

## Support

For issues or questions:
1. Check test files for usage examples
2. Review integration guide
3. Check application logs for error messages
