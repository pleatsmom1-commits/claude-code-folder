// 택배출고 작업 시간(07~15시) 셀러 접수 막기 + 안내. 사용: cd tests && node e2e-ship-closed.js   (SHOT_DIR 를 주면 전후 그림 저장)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const NM = path.join(__dirname, 'node_modules');
const ROOT = path.join(__dirname, '..');
const PAGE = 'file://' + path.join(ROOT, process.env.PAGE_FILE || 'index.html') + '?test';
const SHIP_PAGE = 'file://' + path.join(ROOT, 'ship.html');
const LIB = {
  'cdn.tailwindcss.com': '@tailwindcss/browser/dist/index.global.js',
  'xlsx-js-style': 'xlsx-js-style/dist/xlsx.bundle.js',
  'jszip': 'jszip/dist/jszip.min.js',
  'lucide': 'lucide/dist/umd/lucide.min.js',
  'supabase-js': '@supabase/supabase-js/dist/umd/supabase.js',
};

const ids = { seller: '00000000-0000-0000-0000-00000000000a', admin: '00000000-0000-0000-0000-0000000000ad' };
const users = {
  'seller@x.com': { id: ids.seller, pw: 'password1', profile: { id: ids.seller, email: 'seller@x.com', company: '가나 샵', name: '김', phone: '010-1111-2222', role: 'seller', status: 'approved', created_at: '2026-09-01T00:00:00Z' } },
  'admin@x.com': { id: ids.admin, pw: 'adminpass1', profile: { id: ids.admin, email: 'admin@x.com', company: '밤낮', name: '관리', phone: '', role: 'admin', status: 'approved', created_at: '2026-08-01T00:00:00Z' } },
};
const tables = {
  orders: [{ id: 'ORD-1', seller_id: ids.seller, seller_company: '가나 샵', sender_name: '밤낮딜리버리(가나 샵)', recipient: '홍길동', phone: '010-2222-3333', address: '서울', product: '티셔츠', status: '접수대기', ship_status: '미출고', order_type: 'fulfillment', order_no: 1, item_no: 1, seller_order_no: 1, created_at: new Date().toISOString() },
    { id: 'ORD-2', seller_id: ids.seller, seller_company: '가나 샵', sender_name: '밤낮딜리버리(가나 샵)', recipient: '테스트고객', phone: '010-4444-5555', address: '부산', product: '테스트상품', status: '접수대기', ship_status: '미출고', order_type: 'fulfillment', order_no: 2, item_no: 1, seller_order_no: 2, created_at: '2026-11-11T03:42:00Z', origin_created_at: '2026-11-08T06:45:00Z' }],
  couriers: [{ id: 'c1', name: '우체국택배', sort_order: 1 }],
  address_book: [], pickup_requests: [{ id: 'p1', seller_id: ids.admin, seller_company: '에이치제이', orderer_name: '에이치제이', orderer_phone: '01068626822', store_name: '엑시토', store_location: '벨포스트 3층 12호', store_phone: '01075049991', prepay: true, prepay_misong: false, agreed: true, memo: '비회원 간단접수 #5 오늘 픽업 부탁드립니다', status: '확인', created_at: new Date().toISOString(), origin_created_at: '2026-11-08T06:45:00Z', handled_at: '2026-11-11T09:00:00Z' }], settlements: [], settle_contacts: [{ company: '럭스걸', phone: '01077778888' }, { company: '유어피치', phone: '' }],
  shipments: [], admin_hidden_orders: [], admin_separate_orders: [],
};
let nextShipId = 1;
const requests = [];
const norm = v => String(v || '').replace(/\s/g, '').toLowerCase();

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
    else if (v.startsWith('in.(')) { const list = v.slice(4, -1).split(',').map(x => x.replace(/^"|"$/g, '')); rows = rows.filter(r => list.includes(String(r[k]))); }
  }
  return rows;
}


fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const dialogs = [];
  await context.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.protocol === 'file:') return route.continue();
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

    if (url.pathname === '/auth/v1/token') {
      const u = users[body.email];
      if (!u || u.pw !== body.password) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
      return json(200, { access_token: tokenFor(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: userObj(u) });
    }
    if (url.pathname === '/auth/v1/user') return who ? json(200, userObj(who)) : json(401, { msg: 'no' });
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/rest/v1/profiles') {
      const isAdmin = who && who.profile.role === 'admin';
      let rows = Object.values(users).map(u => u.profile).filter(p => isAdmin || (who && p.id === who.id));
      rows = applyFilters(rows, url);
      if ((headers['accept'] || '').includes('vnd.pgrst.object')) return rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' });
      return json(200, rows);
    }
    if (url.pathname === '/rest/v1/rpc/get_shipment') {
      const s = tables.shipments.find(x => x.token === body.p_token);
      return json(200, s ? { company: s.company, ship_date: s.ship_date, items: s.items, parcel_count: s.parcel_count, unshipped_count: s.unshipped_count, extra_fee: s.extra_fee } : null);
    }
    if (url.pathname === '/rest/v1/shipments') {
      const isAdmin = who && who.profile.role === 'admin';
      if (!isAdmin) return json(401, { message: 'permission denied' });
      if (method === 'GET') return json(200, applyFilters(tables.shipments, url));
      if (method === 'POST') {
        const list = Array.isArray(body) ? body : [body];
        for (const r of list) {
          const old = tables.shipments.find(x => x.company === r.company && x.ship_date === r.ship_date);
          if (old) Object.assign(old, r); else tables.shipments.push({ id: nextShipId++, sent_at: null, send_status: null, send_error: null, ...r });
        }
        return json(201, list);
      }
      if (method === 'PATCH') { const rows = applyFilters(tables.shipments, url); rows.forEach(r => Object.assign(r, body)); return json(200, rows); }
      if (method === 'DELETE') { const rows = applyFilters(tables.shipments, url); tables.shipments = tables.shipments.filter(r => !rows.includes(r)); return json(200, rows); }
    }
    const table = url.pathname.replace('/rest/v1/', '');
    if (['admin_hidden_orders', 'admin_separate_orders'].includes(table) && !(who && who.profile.role === 'admin')) return json(401, { message: 'permission denied' });
    if (tables[table]) {
      if (method === 'GET') return json(200, applyFilters(tables[table], url));
      if (method === 'POST') { const list = Array.isArray(body) ? body : [body]; list.forEach(r => { if (!tables[table].some(x => x.order_id === r.order_id)) tables[table].push(r); }); return json(201, list); }
      if (method === 'PATCH') { const rows = applyFilters(tables[table], url); rows.forEach(r => Object.assign(r, body)); return json(200, rows); }
      if (method === 'DELETE') { const rows = applyFilters(tables[table], url); tables[table] = tables[table].filter(r => !rows.includes(r)); return json(200, rows); }
    }
    return json(404, { message: 'unmocked ' + url.pathname });
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => { pageErrors.push(e.message); console.log('PAGE ERROR:', e.message); });
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  const results = [];
  const check = (name, cond, extra = '') => { const l = `${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`; results.push(l); console.log(l); };
  const OUT = process.env.SHOT_DIR || path.join(__dirname, 'out');
  const vis = sel => page.locator(sel).isVisible();
  const dis = id => page.evaluate(i => document.getElementById(i).disabled, id);
  const insertCount = () => requests.filter(r => r.method === 'POST' && r.path === '/rest/v1/orders').length;
  const W = Number(process.env.SHOT_W || 1400);
  await page.setViewportSize({ width: W, height: 900 });
  await page.goto(PAGE); await page.waitForTimeout(800);
  await page.fill('#login-email', 'seller@x.com'); await page.fill('#login-pw', 'password1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  check('셀러 화면', await vis('#seller-dashboard'));
  await page.evaluate(() => { document.getElementById('time-simulator-bar').style.display = 'none'; });
  const shot = async n => { if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(OUT, n), fullPage: false }); };
  if (process.env.ONLY_SHOT) { // 전후 그림만: 오전 9시 모습
    await page.evaluate(() => switchSellerMode('fulfillment'));
    await page.evaluate(() => setSimulatedTime(9 * 60)); await page.waitForTimeout(400);
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200);
    await shot(process.env.ONLY_SHOT);
    const foot = page.locator('#btn-submit-order').locator('xpath=..');
    await foot.scrollIntoViewIfNeeded(); await foot.screenshot({ path: path.join(OUT, 'btn_' + process.env.ONLY_SHOT) });
    await browser.close(); return;
  }

  // 15:00 (열림)
  await page.evaluate(() => setSimulatedTime(15 * 60)); await page.waitForTimeout(300);
  check('15:00 안내 상자 숨김', !(await vis('#ship-closed-notice')));
  check('15:00 버튼 열림', !(await dis('btn-store-submit')));
  check('15:00 초록 띠 문구', (await page.textContent('#status-text')).includes('오후 3시 ~ 다음날 오전 7시'));
  await page.evaluate(() => switchSellerMode('fulfillment')); await page.waitForTimeout(300);
  await shot('open.png');

  // 06:59 열림, 07:00 막힘
  await page.evaluate(() => setSimulatedTime(6 * 60 + 59)); await page.waitForTimeout(200);
  check('06:59 버튼 열림', !(await dis('btn-submit-order')));
  await page.evaluate(() => setSimulatedTime(7 * 60)); await page.waitForTimeout(300);
  check('07:00 안내 상자 보임', await vis('#ship-closed-notice'));
  check('07:00 버튼 4개 잠김', (await Promise.all(['btn-submit-order', 'btn-excel-upload', 'btn-store-submit', 'btn-ai-upload'].map(dis))).every(Boolean));
  check('07:00 빨간 띠', (await page.getAttribute('#status-banner', 'class')).includes('bg-rose-600'));
  check('보관요청 버튼은 열림', !(await dis('btn-keep-submit')));
  await shot('closed.png');
  // 버튼이 잠겨도 억지로 접수 함수를 부르면(7시 전에 열어 둔 화면) 막히는지
  const before = insertCount();
  await page.evaluate(() => handleSingleOrderSubmit({ preventDefault() {} }));
  await page.evaluate(() => handleStoreOrderSubmit({ preventDefault() {} }));
  await page.waitForTimeout(300);
  check('막힌 시간 접수 함수 → 저장 안 됨 + 안내창', insertCount() === before && dialogs.some(d => d.includes('오후 1시전까지 카톡')));
  await page.evaluate(() => setSimulatedTime(14 * 60 + 59)); await page.waitForTimeout(200);
  check('14:59 아직 막힘', await dis('btn-submit-order'));
  await page.evaluate(() => setSimulatedTime(15 * 60)); await page.waitForTimeout(200);
  check('15:00 다시 열림', !(await dis('btn-submit-order')) && !(await vis('#ship-closed-notice')));

  // 관리자는 막지 않음
  await page.evaluate(() => logout()); await page.waitForTimeout(800);
  await page.click('#tab-btn-admin');
  await page.fill('#login-email', 'admin@x.com'); await page.fill('#login-pw', 'adminpass1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  await page.evaluate(() => setSimulatedTime(9 * 60)); await page.waitForTimeout(200);
  check('관리자 화면 + 09시 isShipClosed=false', await vis('#admin-dashboard') && !(await page.evaluate(() => isShipClosed())));
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
  console.log(results.filter(r => r.startsWith('FAIL')).length ? 'SOME FAILED' : 'ALL PASS');
})();
