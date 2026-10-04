/**
 * Generovaný test „routy bez ochrany" (kolo 8): každá routa pod api/admin a api/platform musí mít ověření
 * přístupu přes sdílené wrappery (runAsPromoter…, runAsPlatformAdmin, requirePlatformAdmin, …). Starší routy s vlastní (ruční) kontrolou
 * jsou výslovně vyjmenované i s tím, čím se chrání — nová routa bez wrapperu test shodí.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const API = path.resolve(__dirname, '../src/app/api');
const GUARD = /runAsPromoter\w*|runAsActivePromoter\w*|runAsPlatformAdmin|requirePlatformAdmin|requirePromoter\w*|runAsUser|verifyInternalToken|isCronAuthorized|isInternalTokenAuthorized/;

/** Starší routy s vlastní kontrolou (ověřeno ručně, kolo 8) — cesta → čím se chrání. */
const LEGACY: Record<string, RegExp> = {
  'admin/bank-credentials/psd2/callback/route.ts': /oauth_state = \$1/,
  'admin/facebook/oauth/start/route.ts': /x-user-id[\s\S]*status: 401/,
  'admin/gift-cards/route.ts': /status: 403/,
  'admin/kyc/aml-check/route.ts': /x-user-id[\s\S]*status: 401[\s\S]*status: 403/,
  'admin/orders/export/route.ts': /x-user-id[\s\S]*status: 401[\s\S]*Not a promoter member/,
  'admin/orders/route.ts': /x-user-id[\s\S]*status: 401[\s\S]*Not a promoter member/,
  'admin/payouts/execute/route.ts': /x-user-id[\s\S]*is_platform_admin[\s\S]*status: 403/,
  'platform/editorial/route.ts': /if \(!isAdmin\(req\)\)/,
  'platform/partners/route.ts': /status: 401/,
};

function routes(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...routes(p));
    else if (n === 'route.ts') out.push(path.relative(API, p).split(path.sep).join('/'));
  }
  return out;
}

describe('inventura ochrany admin/platform rout', () => {
  const all = [...routes(path.join(API, 'admin')), ...routes(path.join(API, 'platform'))];

  it('každá routa má sdílený wrapper nebo vyjmenovanou starší kontrolu', () => {
    const bad = all.filter((r) => {
      const src = readFileSync(path.join(API, r), 'utf8');
      if (GUARD.test(src)) return false;
      const legacy = LEGACY[r];
      return !(legacy && legacy.test(src));
    });
    expect(bad).toEqual([]);
    expect(all.length).toBeGreaterThan(300);
  });

  it('nové routy kola 8 (inscenace, termíny) používají wrapper pořadatele', () => {
    for (const r of ['admin/productions/route.ts', 'admin/productions/[id]/route.ts', 'admin/productions/[id]/terms/route.ts']) {
      expect(readFileSync(path.join(API, r), 'utf8'), r).toMatch(/runAsActivePromoter/);
    }
  });
});
