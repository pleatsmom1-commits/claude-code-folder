// 새 픽업요청 → 사입팀 알림 (셀러 접수 시 /api/pickup/notify 호출, 관리자 '사입팀 알림 받을 번호') E2E
// 실제 Supabase 대신 메모리 속 가짜 서버를 씁니다. 사용: cd tests && npm install && node e2e-pickup-notify.js
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
  couriers: [], address_book: [], pickup_requests: [], settlements: [], settle_contacts: [], stock_items: [], app_settings: [],
};
let aliasId = 1;
const requests = [];
const notifyCalls = [];

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
    if (url.protocol === 'file:' && url.pathname === '/api/pickup/notify') { notifyCalls.push(req.postDataJSON()); return route.fulfill({ contentType: 'application/json', body: '{"status":"sent"}' }); }
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
      if (table === 'pickup_requests' && method === 'POST') {
        const r = { id: '00000000-0000-0000-0000-0000000000f' + (tables.pickup_requests.length + 1), status: '접수', created_at: now(), seller_id: who.id, ...(Array.isArray(body) ? body[0] : body) };
        tables.pickup_requests.push(r); return json(201, [r]);
      }
      if (table === 'app_settings' && method === 'POST') {
        if (!isAdmin) return json(403, { code: '42501', message: 'no' });
        tables.app_settings = tables.app_settings.filter(s => s.key !== body.key); tables.app_settings.push(body); return json(201, [body]);
      }
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

  await context.exposeBinding('__recordNotify', (_, b) => { notifyCalls.push(JSON.parse(b)); });
  await context.addInitScript(() => {
    const orig = window.fetch;
    window.fetch = (u, init) => String(u).startsWith('/api/pickup/notify') ? (window.__recordNotify(init.body), Promise.resolve(new Response('{}'))) : orig(u, init);
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => { pageErrors.push(e.message); console.log('PAGE ERROR:', e.message); });
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  const lastDialog = () => dialogs[dialogs.length - 1] || '';
  const results = [];
  const check = (name, cond, extra = '') => { const l = `${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`; results.push(l); console.log(l); };

  // ---------- 셀러: 픽업요청 접수 → 알림 호출 ----------
  await page.goto(INDEX); await page.waitForTimeout(800);
  await page.fill('#login-email', 'seller@x.com'); await page.fill('#login-pw', 'password1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  check('seller order screen shown', await page.isVisible('#nav-pickup-btn'));
  await page.click('#nav-pickup-btn'); await page.waitForTimeout(500);
  await page.fill('#pk-orderer-name', '가나샵'); await page.fill('#pk-orderer-phone', '010-1234-5678');
  await page.fill('#pk-store-name', '청평화 누보'); await page.fill('#pk-store-location', '청평화 2층 B-12'); await page.fill('#pk-store-phone', '02-111-2222');
  await page.check('input[name="pk-prepay"][value="no"]'); await page.check('input[name="pk-misong"][value="no"]');
  await page.fill('#pk-memo', '검정 2장');
  await page.click('#btn-pickup-submit'); await page.waitForTimeout(1500);
  check('pickup saved', tables.pickup_requests.length === 1 && tables.pickup_requests[0].store_name === '청평화 누보');
  check('notify called once with new id', notifyCalls.length === 1 && notifyCalls[0].id === tables.pickup_requests[0].id, JSON.stringify(notifyCalls));
  check('seller sees done message', lastDialog().includes('접수되었습니다'));

  // ---------- 관리자: 사입팀 알림 받을 번호 ----------
  await page.evaluate(() => localStorage.clear()); await page.goto(INDEX); await page.waitForTimeout(800);
  await page.click('#tab-btn-admin');
  await page.fill('#login-email', 'admin@x.com'); await page.fill('#login-pw', 'adminpass1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  check('admin order list visible', await page.isVisible('#admin-dashboard'));
  await page.click('#admin-tab-pickup'); await page.waitForTimeout(1000);
  check('phone box shown', await page.isVisible('#pickup-notify-phones'));
  check('empty -> no-alert hint', (await page.innerText('#pickup-notify-status')).includes('알림이 가지 않습니다'));
  await page.fill('#pickup-notify-phones', '010-1111-2222, 0101'); await page.locator('#admin-pickup-panel button', { hasText: '저장' }).first().click(); await page.waitForTimeout(500);
  check('bad number blocked', lastDialog().includes('올바르지 않습니다') && tables.app_settings.length === 0);
  await page.fill('#pickup-notify-phones', '010-1111-2222,010 3333 4444'); await page.waitForTimeout(200);
  await page.locator('#admin-pickup-panel button', { hasText: '저장' }).first().click(); await page.waitForTimeout(800);
  check('saved', tables.app_settings[0] && tables.app_settings[0].value === '010-1111-2222, 010 3333 4444', JSON.stringify(tables.app_settings));
  check('count hint 2명', (await page.innerText('#pickup-notify-status')).includes('2명'));
  check('pickup list shows request', (await page.innerText('#pickup-admin-list')).includes('청평화 누보'));
  await page.screenshot({ path: path.join(__dirname, 'out', 'shot-pickup-notify.png'), clip: { x: 0, y: 0, width: 1400, height: 560 } });
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
  const fails = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - fails}/${results.length} passed`);
  process.exit(fails ? 1 : 0);
})();
