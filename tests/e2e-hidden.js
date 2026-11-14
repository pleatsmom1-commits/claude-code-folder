// 관리자 주문관리 [선택 숨기기] / [숨긴 접수건도 보기] / [선택 숨김해제] E2E (supabase/order_hidden.sql)
// 실제 Supabase 대신 메모리 속 가짜 서버를 씁니다. 사용: cd tests && npm install && node e2e-hidden.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const NM = path.join(__dirname, 'node_modules');
const ROOT = path.join(__dirname, '..');
const PAGE = 'file://' + path.join(ROOT, 'index.html') + '?test';
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
  const listText = async () => (await page.textContent('#admin-order-list')).replace(/\s+/g, ' ');

  await page.goto(PAGE); await page.waitForTimeout(800);
  await page.click('#tab-btn-admin');
  await page.fill('#login-email', 'admin@x.com'); await page.fill('#login-pw', 'adminpass1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  const t2 = (await page.locator('#admin-order-list tr', { hasText: '테스트고객' }).textContent()).replace(/\s+/g, ' ');
  check('order time cell: 셀러 접수 = 손님 접수(11/08 15:45) + 넘김 표시', t2.includes('셀러 접수2026-11-08 15:45') && t2.includes('관리자 접수-') && t2.includes('간단접수에서 넘김 2026-11-11 12:42'), t2);
  await page.click('#admin-tab-pickup'); await page.waitForTimeout(600);
  await page.evaluate(() => { pickupQuery.status = 'ALL'; renderAdminPickupTable(); });
  const tp = (await page.textContent('#pickup-admin-list')).replace(/\s+/g, ' ');
  check('pickup time cell: 셀러 접수 + 관리자 처리', tp.includes('셀러 접수11/8 15:45') && tp.includes('관리자 처리11/11 18:00'), tp.slice(0, 200));
  const opts = await page.locator('#pickup-admin-list select option').allTextContents();
  check('pickup status names', opts.join(',') === '접수,사입팀접수확인,픽업완료,픽업실패,접수취소', opts.join(','));
  await page.screenshot({ path: path.join(__dirname, 'out', 'times-pickup.png') });
  await page.click('#admin-tab-orders'); await page.waitForTimeout(400);
  check('admin order list shows both orders', (await listText()).includes('홍길동') && (await listText()).includes('테스트고객'));

  await page.check('.admin-chk-item[value="ORD-2"]');
  await page.click('button:has-text("선택 숨기기")'); await page.waitForTimeout(500);
  check('hide saved to DB', tables.admin_hidden_orders.length === 1 && tables.admin_hidden_orders[0].order_id === 'ORD-2', JSON.stringify(tables.admin_hidden_orders));
  check('hidden order disappears from list', !(await listText()).includes('테스트고객') && (await listText()).includes('홍길동'));
  check('count + hidden count label', (await page.textContent('#admin-order-count')).includes('주문 1건') && (await page.textContent('#admin-hidden-count')).includes('1개'));
  await page.screenshot({ path: path.join(__dirname, 'out', 'hidden-1.png') });
  await page.evaluate(() => confirmAdminBatch()); await page.waitForTimeout(400);
  check('green button with nothing checked asks to select', dialogs[dialogs.length - 1].includes('체크박스로 선택'));
  await page.check('#chk-all-admin'); await page.dispatchEvent('#chk-all-admin', 'change');
  await page.evaluate(() => confirmAdminBatch()); await page.waitForTimeout(800);
  const o = id => tables.orders.find(x => x.id === id).status;
  check('green button: only checked (visible) orders, hidden untouched', o('ORD-1') === '접수완료' && o('ORD-2') === '접수대기', o('ORD-1') + '/' + o('ORD-2'));
  await page.check('#admin-show-hidden'); await page.waitForTimeout(300);
  check('[숨긴 접수건도 보기] shows it with 숨김 badge', (await listText()).includes('테스트고객') && (await listText()).includes('숨김') && (await page.isVisible('#btn-admin-unhide')));
  await page.screenshot({ path: path.join(__dirname, 'out', 'hidden-2.png') });

  await page.check('.admin-chk-item[value="ORD-2"]');
  await page.click('#btn-admin-unhide'); await page.waitForTimeout(500);
  check('unhide removes from DB', tables.admin_hidden_orders.length === 0);
  await page.uncheck('#admin-show-hidden'); await page.waitForTimeout(300);
  check('unhidden order visible again', (await listText()).includes('테스트고객'));

  await page.check('#admin-show-hidden'); await page.evaluate(() => resetAdminSearch()); await page.waitForTimeout(300);
  // 따로 처리됨
  await page.check('.admin-chk-item[value="ORD-2"]');
  await page.click('button:has-text("따로 처리됨")'); await page.waitForTimeout(800);
  check('따로 처리됨 saved + order becomes 접수완료', tables.admin_separate_orders.some(r => r.order_id === 'ORD-2') && o('ORD-2') === '접수완료', o('ORD-2'));
  check('따로 처리됨 badge in row', (await page.locator('#admin-order-list tr', { hasText: '테스트고객' }).textContent()).includes('따로 처리됨'));
  await page.screenshot({ path: path.join(__dirname, 'out', 'separate.png') });
  await page.check('.admin-chk-item[value="ORD-2"]');
  await page.click('button:has-text("따로 처리됨")'); await page.waitForTimeout(800);
  check('따로 처리됨 again → 표시 풀기', tables.admin_separate_orders.length === 0 && !(await page.locator('#admin-order-list tr', { hasText: '테스트고객' }).textContent()).includes('따로 처리됨'));
  check('초기화 unchecks 숨긴 접수건도 보기', !(await page.isChecked('#admin-show-hidden')));
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  await browser.close();
  console.log(results.filter(r => r.startsWith('FAIL')).length ? 'SOME FAILED' : 'ALL PASS');
})();
