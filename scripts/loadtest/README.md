# Tixly load test scenarios

## Setup

Install k6:
```bash
# Windows (chocolatey)
choco install k6

# macOS
brew install k6

# Linux (apt)
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

## Pre-requisites pro `queue-onsale.js`

1. **Demo event s queue_enabled=true:**
   ```sql
   UPDATE catalog.events
   SET queue_enabled = true, queue_max_concurrent = 1000
   WHERE id = '<your-event-id>';
   ```
   `queue_max_concurrent` doporučuje při testu na 100k VUs nastavit na 1000-5000.

2. **Redis dostupný** (REDIS_URL nastaven). Bez Redisu queue běží jen na DB
   polling a 100k VUs ji rozbije.

3. **Postgres connection pool** zvýšit:
   ```env
   DATABASE_URL=postgresql://...?pool_max=100
   ```

4. **Local stack** pro malé testy: `docker compose up -d`

## Running

### Smoke test (50 VUs, ověří že script běží)
```bash
k6 run --vus 50 --duration 30s \
  -e EVENT_ID=<uuid> \
  -e TICKET_TYPE_ID=<uuid> \
  -e BASE_URL=http://localhost:3000 \
  scripts/loadtest/queue-onsale.js
```

### Realistický festival (10k VUs, 5 min)
```bash
k6 run --vus 10000 --duration 5m \
  -e EVENT_ID=<uuid> \
  -e TICKET_TYPE_ID=<uuid> \
  -e BASE_URL=https://staging.tixly.cz \
  scripts/loadtest/queue-onsale.js
```

### Tomorrowland-class (100k VUs s ramp)
```bash
k6 run \
  -e EVENT_ID=<uuid> \
  -e TICKET_TYPE_ID=<uuid> \
  -e BASE_URL=https://staging.tixly.cz \
  scripts/loadtest/queue-onsale.js
```
Výchozí `options.scenarios.onsale.stages` rampují 0 → 100k během 7 minut. Bez `--vus` flag.

## Cloud / k6 Cloud

Pro 100k+ VUs lokální stroj nezvládne. Použij k6 Cloud:
```bash
k6 cloud scripts/loadtest/queue-onsale.js
```
Vyžaduje k6 Cloud account ($$) — alternativa: spustit z 5-10 EC2 instancí
distribuovaně přes `k6 run` s každou hostující ~10k VUs.

## Acceptance criteria pro tier-1 readiness

| Metric | Target |
|--------|--------|
| http_req_duration p95 | < 2000 ms |
| http_req_duration p99 | < 5000 ms |
| queue_join_latency p95 | < 1500 ms |
| admit_latency p95 | < 60 s (with queue_max_concurrent=5000) |
| checkout_success_rate | > 70 % (ze admitted users) |
| http_req_failed | < 1 % |

Pokud kterékoli z těchto nesplníme při 100k VUs, je nutno:
- škálovat Postgres (more replicas / bigger instance)
- škálovat Redis (cluster mode)
- škálovat Next.js dev (více instances za load balancerem)
- přidat Cloudflare Waiting Room před `/api/queue/join` (offload waiting do CDN)

## Pre-prod checklist

- [ ] Run smoke test (50 VUs, < 30s)
- [ ] Run mid-scale (5k VUs, 2 min) — ověří happy path
- [ ] Run target (50-100k VUs, 5 min) — proves tier-1 readiness
- [ ] Capture latency curve in `loadtest-report.json`
- [ ] Compare to acceptance criteria
- [ ] Document any regressions / scaling notes
