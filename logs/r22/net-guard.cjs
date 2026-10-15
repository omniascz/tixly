/**
 * Kolo 22 — pojistka pro lokální build a server (NODE_OPTIONS=--require): spojení na *.sentry.io se zablokuje dřív,
 * než odejde (DNS lookup i connect skončí chybou), a každé spojení mimo localhost se zapíše do R21_NET_LOG.
 * Důvod: webpack plugin Sentry (@sentry/bundler-plugins) posílá ve výchozím stavu vlastní telemetrii na sentry.io
 * (core/sentry/telemetry.js, i bez SENTRY_AUTH_TOKEN). Nic jiného neblokuje (písma next/font/google apod. projdou).
 */
const dns = require('node:dns');
const net = require('node:net');
const fs = require('node:fs');

const LOG = process.env.R21_NET_LOG;
const BLOCK = /(^|\.)sentry\.io\.?$/i;
const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|::1|0\.0\.0\.0)$/i;
const note = (s) => { if (LOG) { try { fs.appendFileSync(LOG, `${new Date().toISOString()} pid=${process.pid} ${s}\n`); } catch { /* */ } } };
const blocked = (host) => Object.assign(new Error(`r21 net-guard: spojení na ${host} zablokováno`), { code: 'ENOTFOUND' });

const origLookup = dns.lookup;
dns.lookup = function lookup(host, opts, cb) {
  const callback = typeof opts === 'function' ? opts : cb;
  if (typeof host === 'string' && BLOCK.test(host)) {
    note(`BLOCKED dns ${host}`);
    process.nextTick(() => callback(blocked(host)));
    return {};
  }
  return origLookup.apply(this, arguments);
};
const origPromisesLookup = dns.promises.lookup;
dns.promises.lookup = async function lookup(host, ...rest) {
  if (typeof host === 'string' && BLOCK.test(host)) { note(`BLOCKED dns.promises ${host}`); throw blocked(host); }
  return origPromisesLookup.call(this, host, ...rest);
};

const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  const o = args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) ? args[0] : { port: args[0], host: typeof args[1] === 'string' ? args[1] : undefined };
  const host = o.host ?? o.servername;
  if (typeof host === 'string' && BLOCK.test(host)) {
    note(`BLOCKED connect ${host}:${o.port}`);
    process.nextTick(() => this.destroy(blocked(host)));
    return this;
  }
  if (!o.path && typeof host === 'string' && !LOCAL.test(host)) note(`connect ${host}:${o.port}`);
  return origConnect.apply(this, args);
};
