// Kolo 15 — diagnostika: ukončí proces po EXIT_AFTER_MS, aby --cpu-prof zapsal profil (Stop-Process -Force by ho nezapsal)
const ms = Number(process.env.EXIT_AFTER_MS || 45000);
setTimeout(() => process.exit(0), ms).unref();
