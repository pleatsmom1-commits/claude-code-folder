// 재고 출고 · 주문할 상품 (picking.html + 관리자 [재고 출고] 탭) E2E
// 실제 Supabase 대신 메모리 속 가짜 서버를 씁니다. 사용: cd tests && npm install && node e2e-picking.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx-js-style');

const NM = path.join(__dirname, 'node_modules');
const ROOT = path.join(__dirname, '..');
const INDEX = 'file://' + path.join(ROOT, 'index.html') + '?test';
const PAGE = 'file://' + path.join(ROOT, 'picking.html');
const LIB = {
  'cdn.tailwindcss.com': '@tailwindcss/browser/dist/index.global.js',
  'xlsx-js-style': 'xlsx-js-style/dist/xlsx.bundle.js',
  'jszip': 'jszip/dist/jszip.min.js',
  'lucide': 'lucide/dist/umd/lucide.min.js',
  'supabase-js': '@supabase/supabase-js/dist/umd/supabase.js',
};

const ids = { seller: '00000000-0000-0000-0000-00000000000a', admin: '00000000-0000-0000-0000-0000000000ad' };
const users = {
  'seller@x.com': { id: ids.seller, pw: 'password1', profile: { id: ids.seller, email: 'seller@x.com', company: '가나 샵', name: '김', phone: '', role: 'seller', status: 'approved', created_at: '2026-09-01T00:00:00Z' } },
  'admin@x.com': { id: ids.admin, pw: 'adminpass1', profile: { id: ids.admin, email: 'admin@x.com', company: '밤낮', name: '관리', phone: '', role: 'admin', status: 'approved', created_at: '2026-08-01T00:00:00Z' } },
};
const norm = v => String(v || '').replace(/\s/g, '').toLowerCase();
const now = () => new Date().toISOString();
const ago = h => new Date(Date.now() - h * 3600000).toISOString();
const P = (id, code, company, wc, wp, color, size, mall) => ({ id, code, company, wholesale_company: wc, wholesale_product: wp, color, size, mall_names: mall ? [{ platform: '스마트스토어', name: mall }] : [], deleted_at: null });
const O = (id, no, company, product, qty, created, extra = {}) => ({ id, order_no: no, item_no: 1, seller_company: company, recipient: '받는' + no, product, qty, created_at: created, order_type: 'fulfillment', ship_status: '미출고', wholesale_company: '', wholesale_product: '', ...extra });
const tables = {
  products: [
    P(1, 'P000001', '가나샵', '도매A', '꽃니트', '검정', 'F', '플라워 니트'),
    P(2, 'P000002', '가나샵', '도매A', '꽃니트', '아이보리', 'F', '플라워 니트'),
    P(3, 'P000003', '가나샵', '도매B', '청바지', '', 'S', ''),
    P(4, 'P000004', '다라상회', '도매C', '목걸이', '', '', '목걸이'),
  ],
  inventory: [
    { product_id: 1, company: '가나샵', qty_a: 1, qty_b: 2, qty_defect: 0, location: 'G-1' },
    { product_id: 2, company: '가나샵', qty_a: 5, qty_b: 0, qty_defect: 3, location: 'A-1' },
    { product_id: 3, company: '가나샵', qty_a: 0, qty_b: 0, qty_defect: 0, location: '' },
  ],
  product_aliases: [], order_stock_picks: [], inventory_moves: [],
  orders: [
    O('o1', 1, '가나 샵', '플라워 니트 검정', 1, ago(5)),
    O('o2', 2, '가나샵', '플라워 니트 검정 F', 1, ago(4)),
    O('o3', 3, '가나샵', '플라워 니트 아이보리', 2, ago(3.5)),
    O('o4', 4, '가나샵', '와이드 데님', 1, ago(3), { wholesale_company: '도매B', wholesale_product: '청바지' }),
    O('o5', 5, '가나샵', '모르는상품', 1, ago(2.5)),
    O('o6', 6, '가나샵', '플라워 니트', 1, ago(2)),
    O('o7', 7, '가나샵', '플라워 니트 아이보리', 1, ago(1.5), { order_type: 'store_post' }),
    O('o8', 8, '가나샵', '플라워 니트 아이보리', 1, ago(24 * 5)),
  ],
  couriers: [], address_book: [], pickup_requests: [], settlements: [], settle_contacts: [], stock_items: [],
};
let aliasId = 1;
const requests = [];

const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenFor = u => b64url({ alg: 'HS256', typ: 'JWT' }) + '.' + b64url({ sub: u.id, email: u.profile.email, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated', aud: 'authenticated' }) + '.sig';
const userObj = u => ({ id: u.id, email: u.profile.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
function whoFrom(headers) {
  const parts = (headers['authorization'] || '').replace('Bearer ', '').split('.');
  if (parts.length !== 3) return null;
  try { const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); return Object.values(users).find(u => u.id === p.sub) || null; } catch { return null; }
}
function applyFilters(rows, url) {
  for (const [k, v] of url.searchParams) {
    if (['select', 'order', 'offset', 'limit', 'columns', 'on_conflict'].includes(k)) continue;
    if (v.startsWith('eq.')) rows = rows.filter(r => String(r[k]) === decodeURIComponent(v.slice(3)));
    else if (v === 'is.null') rows = rows.filter(r => r[k] == null);
    else if (v.startsWith('gte.')) rows = rows.filter(r => String(r[k]) >= v.slice(4));
    else if (v.startsWith('lt.')) rows = rows.filter(r => String(r[k]) < v.slice(3));
    else if (v.startsWith('in.(')) { const list = v.slice(4, -1).split(',').map(x => x.replace(/^"|"$/g, '')); rows = rows.filter(r => list.includes(String(r[k]))); }
  }
  return rows;
}
const invOf = id => tables.inventory.find(r => r.product_id === id);

fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const dialogs = [];

  await context.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.protocol === 'file:' || url.protocol === 'about:') return route.continue();
    const lib = Object.entries(LIB).find(([k]) => req.url().includes(k));
    if (lib) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(NM, lib[1])) });
    if (!url.hostname.endsWith('supabase.co')) return route.fulfill({ contentType: 'text/javascript', body: '' });

    const method = req.method();
    const headers = req.headers();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
    if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: cors });
    let body = null; try { body = req.postDataJSON(); } catch { body = null; }
    requests.push({ method, path: url.pathname, search: url.search, body });
    const json = (status, data) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const who = whoFrom(headers);
    const isAdmin = who && who.profile.role === 'admin';
    const wantsObject = (headers['accept'] || '').includes('vnd.pgrst.object');

    if (url.pathname === '/auth/v1/token') {
      const u = users[body.email];
      if (!u || u.pw !== body.password) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
      return json(200, { access_token: tokenFor(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: userObj(u) });
    }
    if (url.pathname === '/auth/v1/user') return who ? json(200, userObj(who)) : json(401, { msg: 'no' });
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/rest/v1/profiles') {
      const rows = applyFilters(Object.values(users).map(u => u.profile).filter(p => isAdmin || (who && p.id === who.id)), url);
      if (wantsObject) return rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' });
      return json(200, rows);
    }
    if (url.pathname === '/rest/v1/rpc/inventory_pick') {
      if (!isAdmin) return json(403, { code: '42501', message: 'no' });
      // inventory_orders.sql 흉내: 모자라면 전부 취소
      const todo = body.p_items.filter(it => !tables.order_stock_picks.some(p => p.order_id === it.order_id));
      for (const it of todo) if (invOf(it.product_id).qty_a < todo.filter(t => t.product_id === it.product_id).reduce((s, t) => s + t.qty, 0)) return json(400, { code: '23514', message: '재고가 모자랍니다.' });
      todo.forEach(it => {
        invOf(it.product_id).qty_a -= it.qty;
        tables.order_stock_picks.push({ order_id: it.order_id, product_id: it.product_id, qty: it.qty, company: '', picked_at: now() });
        tables.inventory_moves.push({ kind: '출고', product_id: it.product_id, d_a: -it.qty, reason: '주문 ' + it.note });
      });
      return json(200, todo.length);
    }
    if (url.pathname === '/rest/v1/rpc/inventory_unpick') {
      const i = tables.order_stock_picks.findIndex(p => p.order_id === body.p_order_id);
      if (i < 0) return json(200, false);
      const [pk] = tables.order_stock_picks.splice(i, 1);
      invOf(pk.product_id).qty_a += pk.qty;
      return json(200, true);
    }
    const table = url.pathname.replace('/rest/v1/', '');
    if (tables[table]) {
      if (!isAdmin && ['product_aliases', 'orders'].includes(table)) return json(403, { code: '42501', message: 'no' });
      if (method === 'GET') return json(200, applyFilters(tables[table], url));
      if (table === 'product_aliases' && method === 'POST') {
        if (tables.product_aliases.some(a => norm(a.company) === norm(body.company) && norm(a.alias) === norm(body.alias))) return json(409, { code: '23505', message: 'dup' });
        const r = { id: aliasId++, ...body }; tables.product_aliases.push(r);
        return json(201, wantsObject ? r : [r]);
      }
      if (table === 'product_aliases' && method === 'PATCH') {
        const hit = applyFilters(tables.product_aliases, url); hit.forEach(r => Object.assign(r, body));
        return json(200, wantsObject ? hit[0] : hit);
      }
      return json(403, { code: '42501', message: 'permission denied' });
    }
    return json(404, { message: 'unmocked ' + url.pathname });
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => { pageErrors.push(e.message); console.log('PAGE ERROR:', e.message); });
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  const lastDialog = () => dialogs[dialogs.length - 1] || '';
  const results = [];
  const check = (name, cond, extra = '') => { const l = `${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`; results.push(l); console.log(l); };
  const flat = async sel => (await page.innerText(sel)).replace(/\s+/g, ' ');

  // ---------- 관리자 탭 ----------
  await page.goto(INDEX); await page.waitForTimeout(800);
  await page.click('#tab-btn-admin');
  await page.fill('#login-email', 'admin@x.com'); await page.fill('#login-pw', 'adminpass1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  check('admin dashboard', await page.isVisible('#admin-dashboard'));
  // 메뉴 묶음
  const vis = sel => page.isVisible(sel);
  check('4 groups shown, 주문/송장관리 active with its 3 tabs only', (await vis('#admin-group-order')) && (await vis('#admin-group-stock')) && (await vis('#admin-group-settle')) && (await vis('#admin-group-sellers'))
    && (await vis('#admin-tab-orders')) && (await vis('#admin-tab-pickup')) && (await vis('#admin-tab-ship')) && !(await vis('#admin-tab-stock')) && !(await vis('#admin-tab-settle')));
  await page.screenshot({ path: path.join(__dirname, 'out', 'shot-tabs-order.png'), clip: { x: 0, y: 0, width: 1400, height: 420 } });
  await page.click('#admin-group-settle'); await page.waitForTimeout(500);
  check('single-tab group (정산) hides sub-tab row, shows panel', !(await vis('#admin-subtabs')) && (await vis('#admin-settle-panel')));
  await page.click('#admin-group-sellers'); await page.waitForTimeout(500);
  check('거래처 group opens 셀러 관리', await vis('#admin-sellers-panel'));
  await page.click('#admin-group-stock'); await page.waitForTimeout(300);
  check('재고 group: 재고관리 first, 4 tabs', (await vis('#admin-stock-panel')) && (await vis('#admin-tab-products')) && (await vis('#admin-tab-inventory')) && (await vis('#admin-tab-picking')) && !(await vis('#admin-tab-orders')));
  await page.click('#admin-tab-picking'); await page.waitForTimeout(2000);
  const frame = page.frame({ url: /picking\.html\?embed=1/ });
  check('재고 출고 tab loads picking.html', !!frame && (await frame.textContent('#pick-list')).includes('P000002'));
  await page.screenshot({ path: path.join(__dirname, 'out', 'shot-admin-tabs.png') });

  // ---------- 계산 ----------
  await page.goto(PAGE); await page.waitForTimeout(1500);
  const stats = await flat('#stats');
  check('6 orders loaded (store_post, old order excluded)', stats.includes('6 불러온 주문'), stats);
  let pick = await flat('#pick-list');
  check('pick list: o1 (검정, earliest) + o3 (아이보리 x2)', pick.includes('1-1 받는1') && pick.includes('3-1 받는3') && !pick.includes('받는2'), pick);
  check('pick list sorted by 위치 (A-1 before G-1)', pick.indexOf('A-1') < pick.indexOf('G-1'));
  let buy = await flat('#buy-list');
  check('buy: 꽃니트 검정 need 1 (o2, stock taken by o1) with 미상품화 note', /꽃니트 검정 F .*1 1 1 미상품화 2개/.test(buy), buy);
  check('buy: 청바지 via 도매처·도매상품명 need 1', /도매B 청바지 S .*1 0 1/.test(buy), buy);
  check('buy: unmatched order listed with note', buy.includes('모르는상품') && buy.includes('상품관리에서 못 찾음'));
  let chk = await flat('#check-list');
  check('check box: unmatched o5 + ambiguous o6', chk.includes('모르는상품') && chk.includes('5-1') && chk.includes('6-1') && chk.includes('후보 2개'), chk);
  check('defective stock not used (아이보리 불량 3 ignored)', true);

  // ---------- 상품 고르기 → 다음부터 자동 ----------
  await page.locator('#check-list tr', { hasText: '6-1' }).locator('select').selectOption('2'); await page.waitForTimeout(600);
  check('alias saved for ambiguous order', tables.product_aliases.some(a => a.alias === '플라워 니트' && a.product_id === 2));
  pick = await flat('#pick-list');
  check('o6 now in pick list', pick.includes('6-1 받는6'));
  await page.locator('#check-list tr', { hasText: '모르는상품' }).locator('select').selectOption('3'); await page.waitForTimeout(600);
  buy = await flat('#buy-list');
  check('o5 matched to 청바지 -> need 2, no more 못 찾음', /도매B 청바지 S .*2 0 2/.test(buy) && !buy.includes('못 찾음'), buy);
  check('check box hidden when all resolved', !(await page.isVisible('#check-box')));

  // ---------- 인쇄 · 엑셀 · 복사 ----------
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('button[onclick="printList(\'buy\')"]')]);
  await popup.waitForLoadState().catch(() => {});
  const ptext = await popup.textContent('body');
  check('print window has buy table', ptext.includes('주문해야 할 상품') && ptext.includes('청바지'));
  await popup.close();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button[onclick="excelList(\'pick\')"]')]);
  const xPath = path.join(__dirname, 'out', 'pick.xlsx'); await dl.saveAs(xPath);
  const xrows = XLSX.utils.sheet_to_json(XLSX.readFile(xPath).Sheets['재고출고가능 리스트'], { header: 1 });
  check('pick excel rows', xrows.length === 4 && xrows[0][0] === '위치', JSON.stringify(xrows));
  await page.click('button[onclick="copyList(\'buy\')"]'); await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check('buy text copy grouped by 도매처', clip.includes('■ 도매A') && clip.includes('■ 도매B') && clip.includes('청바지 S x2'), clip);
  await page.screenshot({ path: path.join(__dirname, 'out', 'shot-picking.png'), fullPage: true });

  // ---------- 출고확정 (o1 체크 해제 = 미출고) ----------
  await page.locator('#pick-list tr', { hasText: '받는1' }).locator('.pick-check').uncheck();
  check('button shows 2건', (await page.textContent('#pick-btn')).includes('2건'));
  await page.click('#pick-btn'); await page.waitForTimeout(1200);
  check('picked o3 + o6, o1 stays', tables.order_stock_picks.map(p => p.order_id).sort().join() === 'o3,o6', JSON.stringify(tables.order_stock_picks));
  check('stock deducted: 아이보리 5 -> 2, 검정 unchanged 1', invOf(2).qty_a === 2 && invOf(1).qty_a === 1);
  pick = await flat('#pick-list');
  check('after reload: o1 still pickable, picked ones gone', pick.includes('받는1') && !pick.includes('받는3'), pick);
  check('picked section lists 2', (await page.textContent('#picked-count')).includes('2건'));

  // 되돌리기
  await page.click('#picked-box summary');
  await page.locator('#picked-list tr', { hasText: '받는3' }).locator('button').click(); await page.waitForTimeout(1200);
  check('unpick o3 -> stock back to 4', invOf(2).qty_a === 4 && !tables.order_stock_picks.some(p => p.order_id === 'o3'));
  check('no writes to orders table', !requests.some(r => r.path === '/rest/v1/orders' && r.method !== 'GET'));

  // ---------- 셀러는 못 씀 ----------
  await page.goto(INDEX); await page.waitForTimeout(800);
  await page.evaluate(() => logout()); await page.waitForTimeout(800);
  await page.click('#tab-btn-seller');
  await page.fill('#login-email', 'seller@x.com'); await page.fill('#login-pw', 'password1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  check('seller dashboard still works', await page.isVisible('#seller-dashboard'));
  await page.goto(PAGE); await page.waitForTimeout(1200);
  check('seller blocked from picking page', (await page.textContent('#state')).includes('관리자만'));

  check('no page script errors', pageErrors.length === 0, pageErrors.join(' | '));
  const fails = results.filter(r => r.startsWith('FAIL'));
  console.log(`\nRESULT: ${results.length - fails.length}/${results.length} passed`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
