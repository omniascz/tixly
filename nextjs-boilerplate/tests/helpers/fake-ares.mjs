// Simulátor ARES REST API (kolo 7) — podmnožina, kterou volá src/lib/compliance/ares.ts:
//   GET /ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/:ico
// NENÍ to reálný registr. Odpovědi kopírují tvar veřejného ARES (obchodniJmeno, sidlo.textovaAdresa,
// dic, datumVzniku, datumZaniku; 404 s {kod:'NENALEZENO'}).
//
// Scénáře podle IČO (všechna mají platný kontrolní součet mod 11):
//   27074358  úspěch — aktivní s.r.o., plátce DPH
//   27074366  zaniklý subjekt (datumZaniku vyplněné)
//   27074374  výpadek ARES — HTTP 503
//   27074382  timeout — server neodpoví (spojení visí, dokud ho klient nezruší)
//   jiné      neexistující IČO — HTTP 404
//
// Použití: import { startFakeAres } → { url, close, calls } (in-process, náhodný port),
// nebo samostatně `node tests/helpers/fake-ares.mjs` (port FAKE_ARES_PORT, výchozí 3997).
import http from 'node:http';
import { pathToFileURL } from 'node:url';

export const ARES_SCENARIOS = {
  found: '27074358',
  dissolved: '27074366',
  outage: '27074374',
  timeout: '27074382',
  notFound: '27074391',
};

const PATH = /^\/ekonomicke-subjekty-v-be\/rest\/ekonomicke-subjekty\/(\d{8})$/;

function handler(calls, hanging) {
  return (req, res) => {
    const m = PATH.exec(req.url ?? '');
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };
    if (req.method !== 'GET' || !m) return send(400, { kod: 'CHYBA_VSTUPU', popis: 'neznámá cesta simulátoru' });
    const ico = m[1];
    calls.push(ico);
    switch (ico) {
      case ARES_SCENARIOS.found:
        return send(200, {
          ico, obchodniJmeno: 'Divadlo Simulace s.r.o.', dic: `CZ${ico}`, datumVzniku: '2015-03-01', datumZaniku: null,
          sidlo: { textovaAdresa: 'Celetná 595/17, Staré Město, 11000 Praha 1', nazevObce: 'Praha', psc: 11000 },
          pravniForma: { nazev: 'Společnost s ručením omezeným' },
        });
      case ARES_SCENARIOS.dissolved:
        return send(200, {
          ico, obchodniJmeno: 'Zaniklá Agentura s.r.o.', datumVzniku: '2010-01-01', datumZaniku: '2020-06-30',
          sidlo: { textovaAdresa: 'Dlouhá 1, 11000 Praha 1' },
        });
      case ARES_SCENARIOS.outage:
        return send(503, { kod: 'CHYBA_SLUZBY', popis: 'Služba je dočasně nedostupná (simulace)' });
      case ARES_SCENARIOS.timeout:
        hanging.add(res); // neodpovídáme — klient musí sám vypršet
        return undefined;
      default:
        return send(404, { kod: 'NENALEZENO', popis: 'Ekonomický subjekt nebyl nalezen (simulace)' });
    }
  };
}

/** Spustí simulátor na náhodném portu. `url` = základ pro ARES_BASE_URL. */
export function startFakeAres(port = 0) {
  const calls = [];
  const hanging = new Set();
  const server = http.createServer(handler(calls, hanging));
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: p } = server.address();
      resolve({
        url: `http://127.0.0.1:${p}/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty`,
        calls,
        close: () => new Promise((r) => {
          for (const res of hanging) res.destroy();
          server.closeAllConnections?.();
          server.close(() => r(undefined));
        }),
      });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const s = await startFakeAres(Number(process.env.FAKE_ARES_PORT ?? 3997));
  console.log(`fake-ares: ${s.url}`);
}
