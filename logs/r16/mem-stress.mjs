// Kolo 16 / krok 4 — dočasně obsadí MEM_MB paměti (stránky skutečně zapsané) na STRESS_MS; reprodukce při nedostatku RAM
const mb = Number(process.env.MEM_MB ?? 1200); const ms = Number(process.env.STRESS_MS ?? 150000);
const blocks = []; for (let i = 0; i < mb / 50; i++) { const b = Buffer.alloc(50 * 1024 * 1024); for (let j = 0; j < b.length; j += 4096) b[j] = 1; blocks.push(b); }
setInterval(() => { for (const b of blocks) for (let j = 0; j < b.length; j += 4096 * 64) b[j]++; }, 2000); // udržet stránky „živé"
setTimeout(() => process.exit(0), ms);
