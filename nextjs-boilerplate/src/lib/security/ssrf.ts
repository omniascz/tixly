/**
 * SSRF guard pro outbound fetch na URL pocházející od uživatele (webhook
 * endpointy promotérů apod.).
 *
 * Bez téhle kontroly může promotér zaregistrovat `http://169.254.169.254/...`
 * (cloud metadata) nebo `http://localhost:<port>/...` a server mu interní
 * odpověď vrátí → exfiltrace metadat / útok na interní služby.
 *
 * Strategie: jen http(s); hostname resolvujeme na VŠECHNY adresy a každou
 * porovnáme s privátními/loopback/link-local/ULA rozsahy. Volající navíc musí
 * fetchovat s `redirect: 'manual'` (redirect na interní cíl by jinak guard obešel).
 *
 * Zbytkové riziko: DNS rebinding (záznam se změní mezi kontrolou a connectem).
 * Pro plnou ochranu by se musela připnout resolvnutá IP; pro test-ping endpoint
 * je tahle úroveň přiměřená a je to zásadní zlepšení proti „žádné kontrole".
 */
import { lookup } from 'node:dns/promises';
import net from 'node:net';

export class SsrfError extends Error {
  constructor(public reason: string) {
    super(`SSRF blocked: ${reason}`);
    this.name = 'SsrfError';
  }
}

function isPrivateIpv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true; // neznámé → blokuj
  const [a, b] = p;
  if (a === 0) return true; // "this" network
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (RFC 6598)
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true;
    if (low.startsWith('fc') || low.startsWith('fd')) return true; // ULA
    if (low.startsWith('fe80')) return true; // link-local
    const mapped = low.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return isPrivateIpv4(mapped[1]);
    return false;
  }
  return true; // nerozpoznané → blokuj
}

/**
 * Ověří, že URL ukazuje na veřejný http(s) cíl. Hodí SsrfError jinak.
 * Vrací rozparsovanou URL pro pohodlí volajícího.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError('invalid_url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError('protocol_not_allowed');
  }
  const host = url.hostname.replace(/^\[|\]$/g, ''); // strip [] z IPv6 literálu

  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new SsrfError('private_ip_literal');
    return url;
  }
  if (host.toLowerCase() === 'localhost' || host.toLowerCase().endsWith('.localhost')) {
    throw new SsrfError('localhost');
  }

  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new SsrfError('dns_resolution_failed');
  }
  if (addrs.length === 0) throw new SsrfError('no_dns_record');
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new SsrfError('resolves_to_private_ip');
  }
  return url;
}
