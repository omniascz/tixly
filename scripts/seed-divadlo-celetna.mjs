// scripts/seed-divadlo-celetna.mjs
//
// Seeduje Divadlo v Celetné (3 scény) + promotéra Divadlo Verze.
//
// Vkládá:
//   - 3× catalog.venues:
//       * Divadlo v Celetné — Hlavní sál (117 míst)
//       * Divadlo v Celetné — Studio (49 míst)
//       * Divadlo v Celetné — Kabaret Gogo Royal (80 míst)
//   - 3× catalog.venue_seating_charts (active=true) s amfiteatrálním layoutem
//   - 1× identity.users — verze@divadlovceletne.cz / Demo2026!
//   - 1× platform.promoters — Divadlo Verze, kyc_status='approved'
//   - 1× platform.promoter_members — user jako owner
//
// Idempotentní: fixní UUID, UPSERT (ON CONFLICT) ve všech tabulkách.
// Vrátí přehled co se vložilo / aktualizovalo.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const requireFromApp = createRequire(join(__dirname, '..', 'nextjs-boilerplate', 'noop.js'));
const pg = requireFromApp('pg');

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgresql://tixly:tixly_dev@localhost:5433/tixly',
});

// Bcrypt hash pro heslo "Demo2026!" — sdílený se zbytkem demo accounts
const DEMO_PASSWORD_HASH = '$2b$10$.GIsSaNWGnm/jz38S.x.9eFd5OFpWjxYLNfa1DRIBL2ZcNh3t056S';

const USER_ID = '00000000-0000-4000-a000-000000000115';
const PROMOTER_ID = '00000000-0000-4000-a000-000000000115';
const VENUE_IDS = {
  hlavni:  '00000000-0000-4000-a000-000000000500',
  studio:  '00000000-0000-4000-a000-000000000501',
  kabaret: '00000000-0000-4000-a000-000000000502',
};
const CHART_IDS = {
  hlavni:  '00000000-0000-4000-a000-000000000600',
  studio:  '00000000-0000-4000-a000-000000000601',
  kabaret: '00000000-0000-4000-a000-000000000602',
};

// ─── geometrické helpery ────────────────────────────────────────────────────

function autoFitViewBox(layout, margin = 60) {
  const xs = [];
  const ys = [];
  for (const sec of layout.sectors)
    for (const row of sec.rows)
      for (const s of row.seats) { xs.push(s.x); ys.push(s.y); }
  if (layout.stageBox) {
    xs.push(layout.stageBox.x, layout.stageBox.x + layout.stageBox.width);
    ys.push(layout.stageBox.y, layout.stageBox.y + layout.stageBox.height);
  }
  const minX = Math.floor(Math.min(...xs) - margin);
  const minY = Math.floor(Math.min(...ys) - margin);
  const w = Math.ceil(Math.max(...xs) - Math.min(...xs) + 2 * margin);
  const h = Math.ceil(Math.max(...ys) - Math.min(...ys) + 2 * margin);
  return `${minX} ${minY} ${w} ${h}`;
}

function totalSeats(layout) {
  return layout.sectors.reduce(
    (sum, s) => sum + s.rows.reduce((a, r) => a + r.seats.length, 0),
    0,
  );
}

// ─── 1) Hlavní sál — 117 míst, amfiteatrální 10 řad ─────────────────────────
//
// Stage nahoře. 10 řad, mírně amfiteatrální (vzadu o 1-2 sedadla širší).
// Pole sedadel: [11, 11, 12, 12, 12, 12, 12, 12, 12, 11] = 117.
// Číslování v řadě: zleva 1, doprava roste (standardní český model).
function buildHlavniSal() {
  const STAGE_X = 200, STAGE_Y = 80, STAGE_W = 700, STAGE_H = 80;
  const SEAT_PITCH = 34;
  const ROW_PITCH = 44;
  const ROW_Y0 = STAGE_Y + STAGE_H + 60;
  const CENTER_X = STAGE_X + STAGE_W / 2;

  const ROW_SEATS = [11, 11, 12, 12, 12, 12, 12, 12, 12, 11];
  const rows = [];
  for (let r = 0; r < ROW_SEATS.length; r++) {
    const count = ROW_SEATS[r];
    const rowWidth = (count - 1) * SEAT_PITCH;
    const x0 = CENTER_X - rowWidth / 2;
    const y = ROW_Y0 + r * ROW_PITCH;
    const seats = [];
    for (let i = 0; i < count; i++) {
      seats.push({ num: String(i + 1), x: Math.round(x0 + i * SEAT_PITCH), y });
    }
    rows.push({ label: String(r + 1), seats });
  }

  const lastRowY = ROW_Y0 + (ROW_SEATS.length - 1) * ROW_PITCH;
  return {
    viewBox: '',
    stage: { label: 'JEVIŠTĚ', position: 'top' },
    stageBox: { x: STAGE_X, y: STAGE_Y, width: STAGE_W, height: STAGE_H },
    sectors: [{
      name: 'HLEDIŠTĚ',
      color: '#B71C1C',
      rows,
      labelPosition: { x: CENTER_X, y: lastRowY + 70 },
    }],
  };
}

// ─── 2) Studio — 49 míst, 7 řad × 7 sedadel (experimentální prostor) ───────
function buildStudio() {
  const STAGE_X = 180, STAGE_Y = 60, STAGE_W = 360, STAGE_H = 60;
  const SEAT_PITCH = 34;
  const ROW_PITCH = 42;
  const ROW_Y0 = STAGE_Y + STAGE_H + 50;
  const CENTER_X = STAGE_X + STAGE_W / 2;

  const ROW_COUNT = 7;
  const SEATS_PER_ROW = 7;
  const rows = [];
  for (let r = 0; r < ROW_COUNT; r++) {
    const rowWidth = (SEATS_PER_ROW - 1) * SEAT_PITCH;
    const x0 = CENTER_X - rowWidth / 2;
    const y = ROW_Y0 + r * ROW_PITCH;
    const seats = [];
    for (let i = 0; i < SEATS_PER_ROW; i++) {
      seats.push({ num: String(i + 1), x: Math.round(x0 + i * SEAT_PITCH), y });
    }
    rows.push({ label: String(r + 1), seats });
  }

  const lastRowY = ROW_Y0 + (ROW_COUNT - 1) * ROW_PITCH;
  return {
    viewBox: '',
    stage: { label: 'JEVIŠTĚ', position: 'top' },
    stageBox: { x: STAGE_X, y: STAGE_Y, width: STAGE_W, height: STAGE_H },
    sectors: [{
      name: 'STUDIO',
      color: '#1E5631',
      rows,
      labelPosition: { x: CENTER_X, y: lastRowY + 60 },
    }],
  };
}

// ─── 3) Kabaret Gogo Royal — 80 míst u 10 kabaretních stolů ────────────────
//
// Kabaretní uspořádání: 10 stolů, kolem každého 8 židlí (4 vpředu, 4 vzadu).
// Vykresleno jako 2 řady × 4 sedadla per stůl, s mezerou mezi stoly.
// Stage je vpravo (kabaret má bar na opačné straně).
// Sektory: 10× "STŮL 1" .. "STŮL 10".
function buildKabaret() {
  const STAGE_X = 1200, STAGE_Y = 200, STAGE_W = 80, STAGE_H = 500;
  const TABLE_W = 200, TABLE_H = 80;
  const TABLE_GAP_X = 40, TABLE_GAP_Y = 50;
  const SEAT_PITCH = 40;
  const ORIGIN_X = 100;
  const ORIGIN_Y = 200;

  const sectors = [];
  // 2 sloupce × 5 řad stolů = 10 stolů
  let tableNumber = 1;
  for (let col = 0; col < 2; col++) {
    for (let row = 0; row < 5; row++) {
      const baseX = ORIGIN_X + col * (TABLE_W + TABLE_GAP_X * 3);
      const baseY = ORIGIN_Y + row * (TABLE_H + TABLE_GAP_Y);
      // 2 řady (přední/zadní) × 4 sedadla
      const seatsFront = [];
      const seatsBack = [];
      for (let i = 0; i < 4; i++) {
        seatsFront.push({
          num: String(i + 1),
          x: baseX + 20 + i * SEAT_PITCH,
          y: baseY,
        });
        seatsBack.push({
          num: String(i + 5),
          x: baseX + 20 + i * SEAT_PITCH,
          y: baseY + TABLE_H,
        });
      }
      sectors.push({
        name: `STŮL ${tableNumber}`,
        color: tableNumber % 2 === 0 ? '#7B1FA2' : '#C2185B',
        rows: [
          { label: 'A', seats: seatsFront },
          { label: 'B', seats: seatsBack },
        ],
        labelPosition: { x: baseX + TABLE_W / 2, y: baseY + TABLE_H / 2 + 5 },
      });
      tableNumber++;
    }
  }

  return {
    viewBox: '',
    stage: { label: 'PÓDIUM', position: 'right' },
    stageBox: { x: STAGE_X, y: STAGE_Y, width: STAGE_W, height: STAGE_H },
    sectors,
  };
}

// ─── render ASCII pro vizuální sanity check ────────────────────────────────

function renderAscii(layout, name, width = 80, height = 24) {
  const vb = layout.viewBox.split(/\s+/).map(Number);
  const [vx, vy, vw, vh] = vb;
  const grid = Array.from({ length: height }, () => Array(width).fill(' '));

  if (layout.stageBox) {
    const sb = layout.stageBox;
    const x1 = Math.round(((sb.x - vx) / vw) * width);
    const y1 = Math.round(((sb.y - vy) / vh) * height);
    const x2 = Math.round(((sb.x + sb.width - vx) / vw) * width);
    const y2 = Math.round(((sb.y + sb.height - vy) / vh) * height);
    for (let y = Math.max(0, y1); y <= Math.min(height - 1, y2); y++) {
      for (let x = Math.max(0, x1); x <= Math.min(width - 1, x2); x++) {
        if (y >= 0 && y < height && x >= 0 && x < width) {
          grid[y][x] = (y === y1 || y === y2) ? '=' : (x === x1 || x === x2) ? '|' : '#';
        }
      }
    }
  }

  for (const sec of layout.sectors) {
    for (const row of sec.rows) {
      for (const s of row.seats) {
        const gx = Math.round(((s.x - vx) / vw) * width);
        const gy = Math.round(((s.y - vy) / vh) * height);
        if (gy >= 0 && gy < height && gx >= 0 && gx < width) {
          grid[gy][gx] = '.';
        }
      }
    }
  }
  console.log(`\n── ${name} ── (${totalSeats(layout)} míst, viewBox ${layout.viewBox})`);
  console.log('┌' + '─'.repeat(width) + '┐');
  for (const r of grid) console.log('│' + r.join('') + '│');
  console.log('└' + '─'.repeat(width) + '┘');
}

// ─── DB ops ────────────────────────────────────────────────────────────────

async function upsertUser(client) {
  await client.query(
    `INSERT INTO identity.users (id, email, name, password_hash, email_verified_at, gdpr_consent_at, is_platform_admin)
     VALUES ($1, $2, $3, $4, now(), now(), false)
     ON CONFLICT (id) DO UPDATE
       SET email = EXCLUDED.email,
           name = EXCLUDED.name,
           password_hash = EXCLUDED.password_hash`,
    [USER_ID, 'verze@divadlovceletne.cz', 'Divadlo Verze (admin)', DEMO_PASSWORD_HASH],
  );
}

async function upsertPromoter(client) {
  await client.query(
    `INSERT INTO platform.promoters
       (id, email, name, contact_email, slug, locale, status, kyc_status, kyc_submitted_at, kyc_reviewed_at,
        vat_rate_pct, vat_payer, company_ico, company_dic, company_address, brand_color_hex, brand_tagline)
     VALUES ($1, $2, $3, $4, $5, 'cs', 'active', 'approved', now(), now(),
             21, true, '26173050', 'CZ26173050',
             'Celetná 595/17, 110 00 Praha 1', '#B71C1C',
             'Pražské divadlo s kabaretním přesahem')
     ON CONFLICT (id) DO UPDATE
       SET email = EXCLUDED.email,
           name = EXCLUDED.name,
           contact_email = EXCLUDED.contact_email,
           slug = EXCLUDED.slug,
           kyc_status = 'approved',
           status = 'active'`,
    [PROMOTER_ID, 'verze@divadlovceletne.cz', 'Divadlo Verze', 'verze@divadlovceletne.cz', 'divadlo-verze'],
  );
}

async function upsertPromoterMember(client) {
  await client.query(
    `INSERT INTO platform.promoter_members (promoter_id, user_id, role, status)
     VALUES ($1, $2, 'owner', 'active')
     ON CONFLICT (promoter_id, user_id) DO UPDATE
       SET role = EXCLUDED.role, status = EXCLUDED.status`,
    [PROMOTER_ID, USER_ID],
  );
}

async function upsertVenue(client, { id, name, capacity, venueType, address }) {
  await client.query(
    `INSERT INTO catalog.venues
       (id, name, address, city, country, capacity, venue_type, status, description, last_modified_by_user_id)
     VALUES ($1, $2, $3, 'Praha', 'CZ', $4, $5, 'published', $6, $7)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           address = EXCLUDED.address,
           capacity = EXCLUDED.capacity,
           venue_type = EXCLUDED.venue_type,
           status = 'published',
           description = EXCLUDED.description,
           last_modified_by_user_id = EXCLUDED.last_modified_by_user_id,
           last_modified_at = now()`,
    [
      id, name, address, capacity, venueType,
      'Divadlo v Celetné — pražská divadelní scéna na Starém Městě. Tři sály: Hlavní sál (117 míst), Studio (49 míst), Kabaret Gogo Royal (80 míst).',
      USER_ID,
    ],
  );
}

async function upsertChart(client, { chartId, venueId, name, layout }) {
  // Deaktivuj případné starší charty této venue, aby active=true byl jen 1
  await client.query(
    `UPDATE catalog.venue_seating_charts SET active = false WHERE venue_id = $1 AND id <> $2`,
    [venueId, chartId],
  );
  await client.query(
    `INSERT INTO catalog.venue_seating_charts
       (id, venue_id, name, layout, total_seats, active, source, notes, created_by_user_id)
     VALUES ($1, $2, $3, $4::jsonb, $5, true, 'seed', $6, $7)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           layout = EXCLUDED.layout,
           total_seats = EXCLUDED.total_seats,
           active = true,
           notes = EXCLUDED.notes`,
    [
      chartId, venueId, name,
      JSON.stringify(layout), totalSeats(layout),
      `Seeded ${new Date().toISOString().slice(0, 10)} — Divadlo v Celetné scénografie`,
      USER_ID,
    ],
  );
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  const layouts = {
    hlavni:  buildHlavniSal(),
    studio:  buildStudio(),
    kabaret: buildKabaret(),
  };
  for (const l of Object.values(layouts)) {
    l.viewBox = autoFitViewBox(l, 60);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await upsertUser(client);
    console.log('✓ user verze@divadlovceletne.cz');

    await upsertPromoter(client);
    console.log('✓ promoter Divadlo Verze (kyc=approved)');

    await upsertPromoterMember(client);
    console.log('✓ promoter_members (owner)');

    await upsertVenue(client, {
      id: VENUE_IDS.hlavni,
      name: 'Divadlo v Celetné — Hlavní sál',
      capacity: totalSeats(layouts.hlavni),
      venueType: 'theatre_hall',
      address: 'Celetná 595/17, 110 00 Praha 1',
    });
    await upsertChart(client, {
      chartId: CHART_IDS.hlavni, venueId: VENUE_IDS.hlavni,
      name: 'Hlavní sál — amfiteatrální hlediště', layout: layouts.hlavni,
    });
    console.log(`✓ Hlavní sál (${totalSeats(layouts.hlavni)} míst)`);

    await upsertVenue(client, {
      id: VENUE_IDS.studio,
      name: 'Divadlo v Celetné — Studio',
      capacity: totalSeats(layouts.studio),
      venueType: 'theatre_hall',
      address: 'Celetná 595/17, 110 00 Praha 1',
    });
    await upsertChart(client, {
      chartId: CHART_IDS.studio, venueId: VENUE_IDS.studio,
      name: 'Studio — experimentální prostor', layout: layouts.studio,
    });
    console.log(`✓ Studio (${totalSeats(layouts.studio)} míst)`);

    await upsertVenue(client, {
      id: VENUE_IDS.kabaret,
      name: 'Divadlo v Celetné — Kabaret Gogo Royal',
      capacity: totalSeats(layouts.kabaret),
      venueType: 'restaurant',
      address: 'Celetná 595/17, 110 00 Praha 1 (suterén)',
    });
    await upsertChart(client, {
      chartId: CHART_IDS.kabaret, venueId: VENUE_IDS.kabaret,
      name: 'Kabaret Gogo Royal — kabaretní stoly', layout: layouts.kabaret,
    });
    console.log(`✓ Kabaret Gogo Royal (${totalSeats(layouts.kabaret)} míst)`);

    await client.query('COMMIT');

    // ASCII render pro vizuální sanity check
    renderAscii(layouts.hlavni,  'HLAVNÍ SÁL');
    renderAscii(layouts.studio,  'STUDIO');
    renderAscii(layouts.kabaret, 'KABARET GOGO ROYAL');

    console.log('\n✅ Seed dokončen.');
    console.log('   Login: verze@divadlovceletne.cz / Demo2026!');
    console.log(`   Promotér: Divadlo Verze (ID ${PROMOTER_ID})`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Seed selhal — rollback:', e.message);
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
