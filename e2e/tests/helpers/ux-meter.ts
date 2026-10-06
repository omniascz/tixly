/**
 * Kolo 12 — měření UX průchodu: kliknutí, obrazovky, screenshoty (1440 / 390 px) a automatické nálezy na každé obrazovce.
 *
 * Nálezy (heuristiky, každý se ručně posuzuje nad screenshotem):
 *   - en      anglický text v rozhraní (slovník běžných UI slov, celé slovo, mimo vlastní jména),
 *   - tech    technický termín (ID, UUID, slug, layout, payload, token, API, JSON, null/undefined/NaN, kódy chyb VELKÝMI_PÍSMENY),
 *   - uuid    viditelné UUID (uživatel by musel znát / kopírovat ID),
 *   - idField vstupní pole, které po uživateli chce ID.
 * Závažnost dává ruční posouzení (UX_FINDINGS v reportu), ne tento helper.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';

export interface Finding { task: string; screen: string; kind: string; text: string; shot: string }
export interface TaskStat { task: string; clicks: number; screens: number; fills: number; shots: string[] }

// běžná anglická slova rozhraní; celé slovo, s velkým i malým písmenem
const EN_WORDS = [
  'Save', 'Cancel', 'Delete', 'Submit', 'Loading', 'Error', 'Settings', 'Dashboard', 'Events', 'Event', 'Orders', 'Order', 'Edit',
  'Add', 'Remove', 'Name', 'Email', 'Status', 'Actions', 'Search', 'Filter', 'Upload', 'Layout', 'Chart', 'Seating', 'Ticket',
  'Tickets', 'Venue', 'Venues', 'Checkout', 'Back', 'Next', 'Close', 'Confirm', 'Create', 'Update', 'Price', 'Total', 'Date',
  'Time', 'Description', 'Preview', 'Publish', 'Draft', 'Published', 'Success', 'Failed', 'Unknown', 'Select', 'Choose', 'Optional',
  'Required', 'Invalid', 'Reset', 'Undo', 'Redo', 'Export', 'Import', 'Download', 'Print', 'Scan', 'Scanner', 'Valid', 'Used',
  'Revoked', 'Pending', 'Paid', 'Refund', 'Refunded', 'Sold', 'Available', 'Hold', 'Reserved', 'Capacity', 'Section', 'Row', 'Seat',
  'Seats', 'Zone', 'Zones', 'Sector', 'Generate', 'Snap', 'Grid', 'Zoom', 'Underlay', 'Stage', 'Wheelchair', 'Companion', 'Mode',
  'Tool', 'Tools', 'Selected', 'Selection', 'Item', 'Items', 'More', 'Less', 'Show', 'Hide', 'View', 'Open', 'Done', 'Apply',
  'Discount', 'Code', 'Coupon', 'Report', 'Reports', 'Revenue', 'Sales', 'Overview', 'Profile', 'Logout', 'Login', 'Sign',
  'Team', 'Members', 'Role', 'Owner', 'Admin', 'Staff', 'Guest', 'Promoter', 'Buyer', 'Customer', 'Gate', 'Entry', 'Exit',
  'Online', 'Offline', 'Retry', 'Try', 'again', 'Something', 'went', 'wrong', 'Not', 'found', 'Forbidden', 'Unauthorized',
];
const EN_RE = new RegExp(`(?<![\\p{L}\\d_-])(${EN_WORDS.join('|')})(?![\\p{L}\\d_-])`, 'gu');
const TECH_RE = /(?<![\p{L}\d])(UUID|ID|slug|layout|payload|token|API|JSON|null|undefined|NaN|TOTP|webhook|endpoint|backend|frontend|query|SQL|RLS|cron|\[object Object\])(?![\p{L}\d])/gu;
const CODE_RE = /(?<![\p{L}\d])([A-Z]{2,}(?:_[A-Z0-9]{2,})+)(?![\p{L}\d])/gu; // NOT_FOUND, FEATURE_DISABLED…
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export class UxMeter {
  stats: TaskStat[] = [];
  findings: Finding[] = [];
  private cur: TaskStat | null = null;
  private lastUrl = '';
  private seen = new Set<string>();
  constructor(private dir: string, private page: Page) {
    mkdirSync(dir, { recursive: true });
    this.watch(page);
  }
  private watch(page: Page): void {
    page.on('framenavigated', (f) => {
      if (f !== page.mainFrame() || !this.cur || page !== this.page) return;
      const u = new URL(f.url());
      const key = u.pathname + u.search;
      if (key !== this.lastUrl) { this.cur.screens++; this.lastUrl = key; }
    });
  }
  setPage(page: Page): void { this.page = page; this.watch(page); }
  start(task: string): void {
    this.cur = { task, clicks: 0, screens: 0, fills: 0, shots: [] };
    this.stats.push(this.cur);
    this.lastUrl = '';
  }
  /** Uživatelské kliknutí (počítá se). */
  async click(l: Locator, opts?: Parameters<Locator['click']>[0]): Promise<void> {
    this.cur!.clicks++;
    await l.click(opts);
  }
  async fill(l: Locator, v: string): Promise<void> { this.cur!.fills++; await l.fill(v); }
  async select(l: Locator, v: string | { label: string }): Promise<void> { this.cur!.clicks++; await l.selectOption(v); }
  /** Navigace adresou (uživatel by ji musel znát) — počítá se jako obrazovka a hlásí se jako nález. */
  async gotoDirect(url: string, why: string): Promise<void> {
    this.findings.push({ task: this.cur!.task, screen: url, kind: 'nav', text: `přímá adresa — ${why}`, shot: '' });
    await this.page.goto(url);
  }
  /** Screenshot 1440 px (+ 390 px, pokud mobile) a automatické nálezy na obrazovce. */
  async screen(name: string, opts: { mobile?: boolean; skipAudit?: boolean } = {}): Promise<void> {
    const p = this.page;
    await p.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const file = `${name}.png`;
    await p.screenshot({ path: join(this.dir, file), fullPage: true });
    this.cur!.shots.push(file);
    if (opts.mobile) {
      const vp = p.viewportSize();
      await p.setViewportSize({ width: 390, height: 844 });
      await p.waitForTimeout(400);
      await p.screenshot({ path: join(this.dir, `${name}-390.png`), fullPage: true });
      this.cur!.shots.push(`${name}-390.png`);
      if (vp) await p.setViewportSize(vp);
    }
    if (!opts.skipAudit) await this.audit(name, file);
  }
  private add(screen: string, kind: string, text: string, shot: string): void {
    const key = `${kind}|${text}|${new URL(this.page.url()).pathname.replace(UUID_RE, ':id')}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.findings.push({ task: this.cur!.task, screen, kind, text, shot });
  }
  async audit(screen: string, shot: string): Promise<void> {
    const p = this.page;
    const data = await p.evaluate(() => {
      const visible = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); const s = getComputedStyle(el as HTMLElement); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const text = document.body.innerText;
      const fields = [...document.querySelectorAll('input, textarea, select')].filter(visible).map((el) => {
        const id = el.getAttribute('id');
        const lab = (id && document.querySelector(`label[for="${id}"]`)?.textContent) || el.closest('label')?.textContent || '';
        return `${lab} ${el.getAttribute('placeholder') ?? ''} ${el.getAttribute('aria-label') ?? ''}`.trim();
      });
      const attrs = [...document.querySelectorAll('[placeholder],[title],[aria-label],button,option')].filter((e) => e.tagName === 'OPTION' || visible(e))
        .map((e) => [e.getAttribute('placeholder'), e.getAttribute('title'), e.getAttribute('aria-label')].filter(Boolean).join(' ')).join('\n');
      return { text, fields, attrs };
    });
    const all = `${data.text}\n${data.attrs}`;
    for (const m of all.matchAll(EN_RE)) this.add(screen, 'en', context(all, m.index ?? 0, m[0]), shot);
    for (const m of all.matchAll(TECH_RE)) this.add(screen, 'tech', context(all, m.index ?? 0, m[0]), shot);
    for (const m of data.text.matchAll(CODE_RE)) this.add(screen, 'code', context(data.text, m.index ?? 0, m[0]), shot);
    for (const m of data.text.matchAll(UUID_RE)) this.add(screen, 'uuid', context(data.text, m.index ?? 0, m[0]).replace(UUID_RE, '<uuid>'), shot);
    for (const f of data.fields) if (/(?<![\p{L}])(ID|UUID)(?![\p{L}])/u.test(f)) this.add(screen, 'idField', f.slice(0, 80), shot);
  }
  note(kind: string, text: string, shot = ''): void { this.findings.push({ task: this.cur!.task, screen: '', kind, text, shot }); }
  save(file: string): void {
    writeFileSync(file, JSON.stringify({ stats: this.stats, findings: this.findings }, null, 1));
  }
}

function context(s: string, i: number, w: string): string {
  const line = s.slice(Math.max(0, s.lastIndexOf('\n', i) + 1), Math.min(s.length, (s.indexOf('\n', i) + 1 || s.length + 1) - 1));
  return `${w} ⟨${line.trim().slice(0, 90)}⟩`;
}
