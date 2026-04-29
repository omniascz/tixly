# Health Check System - Quick Start Guide

## Testing Endpoints (Locally)

### Test main health endpoint
```bash
curl http://localhost:3000/api/health
```

### Test database health
```bash
curl http://localhost:3000/api/health/db
```

### Test Redis health
```bash
curl http://localhost:3000/api/health/redis
```

### Test external APIs
```bash
curl "http://localhost:3000/api/health/external?urls=https://api.stripe.com,https://google.com&timeout=5000"
```

## Basic Setup (5 minutes)

### 1. Set environment variables
```bash
# .env.local
DATABASE_URL=postgresql://user:password@localhost:5432/db
REDIS_URL=redis://localhost:6379
EXTERNAL_HEALTH_CHECK_APIS=https://api.stripe.com/health,https://api.example.com/status
```

### 2. Update /api/health route (optional - for real DB/Redis clients)

Current route works without clients. To connect real clients:

```typescript
// src/app/api/health/route.ts
import { getHealthCheckClients } from '@/lib/health-check/health.integration';
import { getSystemHealth } from '@/lib/health-check/health.service';

export async function GET(request: NextRequest) {
  const { db, redis, externalApis } = await getHealthCheckClients();
  
  try {
    const systemHealth = await getSystemHealth(db, redis, externalApis);
    return NextResponse.json(systemHealth, {
      status: systemHealth.status === 'unhealthy' ? 503 : 200
    });
  } finally {
    if (db) await db.end();
    if (redis?.disconnect) await redis.disconnect();
  }
}
```

### 3. Run tests
```bash
npm run test -- health.service.test.ts --run
```

## Integration with Uptime Monitoring

### BetterStack (Recommended)
1. Go to [BetterStack Monitoring](https://betterstack.com)
2. Create new monitor
3. URL: `https://your-domain.com/api/health`
4. Method: GET
5. Check frequency: 60 seconds
6. Expected status: 200

### UptimeRobot
1. Go to [UptimeRobot](https://uptimerobot.com)
2. Monitor Type: HTTP(s)
3. URL: `https://your-domain.com/api/health`
4. Interval: 5 minutes (free plan)

### Datadog
```yaml
# datadog-agent config
http_check:
  instances:
    - name: ticketing_platform
      url: https://your-domain.com/api/health
      timeout: 10
```

## Common Issues

### 503 status even when services are up
- Check database connectivity: `curl http://localhost:3000/api/health/db`
- Check Redis connectivity: `curl http://localhost:3000/api/health/redis`
- Check env variables are set correctly

### Health checks timeout (> 1 second)
- Increase `HEALTH_CHECK_EXTERNAL_TIMEOUT` in `.env.local`
- Check network connectivity to external APIs
- Check database query performance

### Redis/Database not initialized
- These are optional - the endpoint returns errors for missing clients
- Set env variables and update route to use `getHealthCheckClients()`

## Architecture

```
┌─ GET /api/health
│  ├─ Database check (12ms typical)
│  ├─ Redis check (8ms typical)
│  └─ External APIs (parallel, 145-1500ms)
│
├─ GET /api/health/db (12ms)
├─ GET /api/health/redis (8ms)
└─ GET /api/health/external (145-1500ms)
```

## What Gets Monitored

### Database
- Connection: Try `SELECT 1`
- Timeout: > 1000ms = slow
- Error: Connection refused = error

### Redis
- Connection: Try `PING`
- Timeout: > 100ms = slow
- Error: Connection refused = error

### External APIs
- Availability: HEAD/GET request
- Timeout: > 5000ms = error
- Response time: > 1000ms = slow
- HTTP 5xx = slow/error

## Response Examples

### Healthy (200 OK)
```json
{
  "status": "healthy",
  "timestamp": "2026-04-18T12:34:56.123Z",
  "totalResponseTime": 245,
  "services": [
    {"name": "database", "status": "healthy", "responseTime": 12, "checks": {...}}
  ]
}
```

### Degraded (200 OK with degraded indicator)
```json
{
  "status": "degraded",
  "timestamp": "2026-04-18T12:34:56.123Z",
  "totalResponseTime": 1200,
  "services": [
    {
      "name": "external_apis",
      "status": "degraded",
      "responseTime": 1200,
      "checks": {...}
    }
  ]
}
```

### Unhealthy (503 Service Unavailable)
```json
{
  "status": "unhealthy",
  "timestamp": "2026-04-18T12:34:56.123Z",
  "services": [
    {
      "name": "database",
      "status": "unhealthy",
      "responseTime": 0,
      "error": "Connection refused"
    }
  ]
}
```

## Files at a Glance

| File | Purpose |
|------|---------|
| `types.ts` | Type definitions |
| `health.service.ts` | Core health check logic (358 lines) |
| `health.integration.ts` | DB/Redis client setup helpers |
| `index.ts` | Exports all functionality |
| `route.ts` | Main `/api/health` endpoint |
| `db/route.ts` | Database-only check |
| `redis/route.ts` | Redis-only check |
| `external/route.ts` | External API checks |
| `health.service.test.ts` | 33 unit tests |

## Performance Targets

- Main endpoint: < 1s
- Database check: < 200ms
- Redis check: < 50ms
- External API: < 5s per API

## Extending the System

### Add a new service check
```typescript
import { getSystemHealth } from '@/lib/health-check';

// Custom check
async function checkMyService() {
  // Your check logic
  return { status: 'ok' | 'error' | 'slow', responseTime: number };
}
```

### Create a metrics endpoint (Prometheus)
```typescript
export async function GET() {
  const health = await getSystemHealth();
  
  const metrics = `
# HELP health_status System health (1=healthy, 0.5=degraded, 0=unhealthy)
# TYPE health_status gauge
health_status ${health.status === 'healthy' ? 1 : 0.5}
  `;
  
  return new Response(metrics, {
    headers: { 'content-type': 'text/plain' }
  });
}
```

## Support

See full documentation in:
- `INTEGRATION_GUIDE.md` - Comprehensive setup and monitoring integration
- `IMPLEMENTATION_SUMMARY.md` - Implementation details and architecture
- `health.service.test.ts` - Test examples and usage patterns
