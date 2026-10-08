// Kolo 16 / krok 4 — umělé vytížení CPU (všechna logická jádra) po dobu STRESS_MS; jen pro reprodukci kolísavého testu
import { Worker, isMainThread } from 'node:worker_threads';
import os from 'node:os';
const ms = Number(process.env.STRESS_MS ?? 120000);
if (isMainThread) {
  const n = os.cpus().length;
  for (let i = 0; i < n; i++) new Worker(new URL(import.meta.url), { env: process.env });
  setTimeout(() => process.exit(0), ms);
} else {
  const end = Date.now() + ms; let x = 0;
  while (Date.now() < end) { x = (x + Math.sqrt(x + 1)) % 1e9; }
}
