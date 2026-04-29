import { Pool } from 'pg';

interface CheckResult {
  service: string;
  status: 'ok' | 'degraded' | 'down';
  responseTimeMs: number;
  detail?: string;
}

async function checkDb(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const db = new Pool({ connectionString: process.env.DATABASE_URL });
    await db.query('SELECT 1');
    await db.end();
    const ms = Date.now() - start;
    return {
      service: 'PostgreSQL',
      status: ms > 500 ? 'degraded' : 'ok',
      responseTimeMs: ms,
    };
  } catch (err) {
    return {
      service: 'PostgreSQL',
      status: 'down',
      responseTimeMs: Date.now() - start,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkRedis(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const { createClient } = await import('redis');
    const client = createClient({ url: process.env.REDIS_URL });
    await client.connect();
    await client.ping();
    await client.disconnect();
    const ms = Date.now() - start;
    return {
      service: 'Redis',
      status: ms > 200 ? 'degraded' : 'ok',
      responseTimeMs: ms,
    };
  } catch (err) {
    return {
      service: 'Redis',
      status: 'down',
      responseTimeMs: Date.now() - start,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkSmtp(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const net = await import('net');
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({
        host: process.env.SMTP_HOST ?? 'localhost',
        port: Number(process.env.SMTP_PORT ?? '1025'),
        timeout: 1500,
      });
      socket.on('connect', () => {
        socket.end();
        resolve();
      });
      socket.on('error', reject);
      socket.on('timeout', () => reject(new Error('SMTP timeout')));
    });
    return {
      service: 'SMTP (Mailhog)',
      status: 'ok',
      responseTimeMs: Date.now() - start,
    };
  } catch (err) {
    return {
      service: 'SMTP (Mailhog)',
      status: 'down',
      responseTimeMs: Date.now() - start,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export const dynamic = 'force-dynamic';

export default async function StatusPage() {
  const [dbR, redisR, smtpR] = await Promise.all([
    checkDb(),
    checkRedis(),
    checkSmtp(),
  ]);
  const checks = [dbR, redisR, smtpR];
  const overallStatus = checks.some((c) => c.status === 'down')
    ? 'down'
    : checks.some((c) => c.status === 'degraded')
      ? 'degraded'
      : 'ok';

  const banner = {
    ok: { color: 'bg-emerald-50 border-emerald-200 text-emerald-900', label: 'Vše funguje' },
    degraded: { color: 'bg-amber-50 border-amber-200 text-amber-900', label: 'Pomalá odezva' },
    down: { color: 'bg-rose-50 border-rose-200 text-rose-900', label: 'Výpadek' },
  }[overallStatus];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Status</h1>
        <p className="text-sm text-muted-foreground">
          Real-time stav Tixly služeb. Kontrolní bod každé sekundy.
        </p>
      </div>

      <div className={`rounded-lg border px-4 py-3 ${banner.color}`}>
        <p className="text-lg font-semibold">{banner.label}</p>
        <p className="text-xs">
          Poslední kontrola: {new Date().toLocaleString('cs-CZ')}
        </p>
      </div>

      <div className="rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-muted-foreground">
              <th className="px-4 py-2">Služba</th>
              <th>Stav</th>
              <th className="text-right">Odezva</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.service} className="border-b last:border-0">
                <td className="px-4 py-3 font-medium">{c.service}</td>
                <td>
                  <span
                    className={
                      c.status === 'ok'
                        ? 'inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800'
                        : c.status === 'degraded'
                          ? 'inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800'
                          : 'inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800'
                    }
                  >
                    <span
                      className={
                        'h-1.5 w-1.5 rounded-full ' +
                        (c.status === 'ok'
                          ? 'bg-emerald-500'
                          : c.status === 'degraded'
                            ? 'bg-amber-500'
                            : 'bg-rose-500')
                      }
                    />
                    {c.status === 'ok'
                      ? 'OK'
                      : c.status === 'degraded'
                        ? 'Pomalý'
                        : 'Down'}
                  </span>
                </td>
                <td className="px-4 text-right text-xs text-muted-foreground">
                  {c.responseTimeMs}ms
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        <p>
          <strong>Pro automatizovaný monitoring:</strong>{' '}
          <code>GET /api/health/ready</code> vrací 200 nebo 503.
        </p>
      </div>
    </div>
  );
}
