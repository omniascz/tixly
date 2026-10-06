/**
 * Kolo 11 / krok 2 — pojistka: `next build` nesmí z kódu aplikace otevřít síťové spojení.
 *
 * Načítá se přes NODE_OPTIONS="--require …/no-network-preload.cjs" (dědí ho i build workery Next.js). Obalí
 * net.Socket.prototype.connect (jím projde každé TCP spojení — net.connect, tls.connect, fetch/undici, pg, redis)
 * a navíc net.connect / net.createConnection / tls.connect. Při pokusu o spojení vypíše cíl, stacktrace (z cest
 * `.next/server/app/<routa>/…` je vidět, která routa nebo stránka se připojuje) a proces ukončí kódem 97 →
 * build selže. Unixové sockety / named pipes (IPC) projdou.
 *
 * Výjimky: BUILD_NET_ALLOW (čárkou oddělené hostitele), výchozí jen písma next/font/google, která stahuje
 * sám Next při buildu (fonts.googleapis.com, fonts.gstatic.com).
 */
'use strict';
const net = require('net');
const tls = require('tls');
const fs = require('fs');

const ALLOW = new Set(
  (process.env.BUILD_NET_ALLOW ?? 'fonts.googleapis.com,fonts.gstatic.com')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
);
const MARK = '[no-network-build]';

function target(args) {
  let a = args[0];
  if (Array.isArray(a)) a = a[0]; // interní normalizované argumenty (net.connect → socket.connect)
  if (typeof a === 'string') return { path: a };
  if (typeof a === 'number') return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: a };
  if (a && typeof a === 'object') {
    if (a.path) return { path: a.path };
    return { host: a.host || a.hostname || 'localhost', port: a.port };
  }
  return { host: '?', port: '?' };
}

function guard(kind, args) {
  const t = target(args);
  if (t.path) return; // IPC
  const host = String(t.host).toLowerCase();
  if (ALLOW.has(host)) return;
  const stack = (new Error().stack || '').split('\n').slice(2, 30).join('\n');
  const route = (/[\\/]\.next[\\/]server[\\/](app|pages)[\\/]([^\s:)]+)/.exec(stack) || [])[2];
  const msg = [
    '',
    `${MARK} ZAKÁZANÉ SÍŤOVÉ SPOJENÍ BĚHEM BUILDU: ${kind} → ${host}:${t.port}`,
    `${MARK} routa/stránka: ${route ? route.replace(/\\/g, '/') : '(neurčeno — viz stacktrace)'}`,
    `${MARK} Oprava: export const dynamic = 'force-dynamic' (routa/stránka se nesmí předgenerovat), viz ROUND11_REPORT.md`,
    stack,
    '',
  ].join('\n');
  try { process.stderr.write(msg); } catch { /* ignore */ }
  if (process.env.BUILD_NET_LOG) {
    try { fs.appendFileSync(process.env.BUILD_NET_LOG, msg); } catch { /* ignore */ }
  }
  process.exit(97);
}

const origSocketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function patchedConnect(...args) {
  guard('net.Socket.connect', args);
  return origSocketConnect.apply(this, args);
};
for (const [mod, name] of [[net, 'connect'], [net, 'createConnection'], [tls, 'connect']]) {
  const orig = mod[name];
  mod[name] = function patched(...args) {
    guard(`${mod === tls ? 'tls' : 'net'}.${name}`, args);
    return orig.apply(this, args);
  };
}
