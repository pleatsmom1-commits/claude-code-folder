// 관리자 주문관리: 업체별 접수 현황(접수대기/접수완료 업체 목록 + 업체 누르면 그 업체만). 사용: cd tests && node e2e-company-tabs.js
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
  page.on('dialog', async d => { await d.accept(); });
  const results = [];
  const check = (name, cond, extra = '') => { const l = `${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`; results.push(l); console.log(l); };
  tables.orders = [];
  const mk = (n, company, status, recipient, product, daysAgo = 0) => tables.orders.push({ id: 'ORD-' + n, seller_id: ids.seller, seller_company: company, sender_name: `밤낮딜리버리(${company})`, recipient, phone: '010-1234-' + String(1000 + n), address: '서울 중구 테스트로 ' + n, product, status, ship_status: '미출고', order_type: 'fulfillment', order_no: n, item_no: 1, seller_order_no: n, created_at: new Date(Date.now() - daysAgo * 86400000).toISOString(), accepted_at: status === '접수완료' ? new Date(Date.now() - daysAgo * 86400000 + 60000).toISOString() : null });
  mk(1, '윈온골프', '접수대기', '유미진', '반바지 / M / 1개'); mk(2, '윈온골프', '접수대기', '홍명구', '스커트 / L / 1개'); mk(3, '윈온골프', '접수대기', '박혜영', '스커트 / M / 1개');
  mk(4, '온온', '접수대기', '온온', '의류'); mk(5, '딘컴퍼니', '접수대기', '딘컴퍼니', '의류');
  mk(6, '가나 샵', '접수완료', '김철수', '티셔츠', 1); mk(7, '가나 샵', '접수완료', '이영희', '바지', 1); mk(8, '럭스걸', '접수완료', '최민수', '원피스', 2); mk(9, '온온', '접수완료', '정수아', '의류', 3);
  const OUT = process.env.OUT || 'after';
  const shot = n => page.screenshot({ path: path.join(__dirname, 'out', n), clip: { x: 0, y: 60, width: 1400, height: 640 } });
  await page.goto(PAGE); await page.waitForTimeout(800);
  await page.click('#tab-btn-admin');
  await page.fill('#login-email', 'admin@x.com'); await page.fill('#login-pw', 'adminpass1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  await shot(`tabs-${OUT}-1.png`);
  if (OUT === 'after') {
    const box = async () => (await page.textContent('#admin-company-tabs')).replace(/\s+/g, ' ');
    const t = await box();
    check('접수대기 업체 3곳 · 주문 5건', t.includes('접수대기 업체 3곳 · 주문 5건'), t);
    check('접수완료 업체 3곳 · 주문 4건', t.includes('접수완료 업체 3곳 · 주문 4건'), t);
    await page.click('#admin-company-tabs button:has-text("윈온골프")'); await page.waitForTimeout(300);
    const rows = await page.locator('#admin-order-list .admin-chk-item').count();
    check('윈온골프 누르면 3건만', rows === 3, String(rows));
    check('거래처/상태 칸도 같이 바뀜', await page.inputValue('#admin-seller-filter') === '윈온골프' && await page.inputValue('#admin-status-filter') === '접수대기');
    await shot(`tabs-${OUT}-2.png`);
    await page.click('#admin-company-tabs button:has-text("온온") >> nth=1'); await page.waitForTimeout(300);
    const rows2 = await page.locator('#admin-order-list .admin-chk-item').count();
    check('접수완료 온온 누르면 1건', rows2 === 1 && await page.inputValue('#admin-status-filter') === '접수완료', String(rows2));
    await page.click('#admin-company-tabs button:has-text("모든 업체·상태 보기")'); await page.waitForTimeout(300);
    check('모든 업체 보기 → 9건', await page.locator('#admin-order-list .admin-chk-item').count() === 9);
    await page.click('.admin-preset[data-preset="today"]'); await page.waitForTimeout(300);
    const t2 = await box();
    check('오늘 기간이면 접수완료 0곳', t2.includes('접수완료 업체 0곳'), t2);
    await page.click('.admin-preset[data-preset="all"]'); await page.waitForTimeout(300);
    // 기준 시간: 오늘 0시부터 → 접수완료(1~3일 전 접수완료)는 0곳, 접수대기(오늘)는 그대로
    await page.click('button:has-text("오늘 0시부터")'); await page.waitForTimeout(300);
    const t3 = await box();
    check('기준 오늘 0시 → 접수대기 3곳 그대로', t3.includes('접수대기 업체 3곳 · 주문 5건'), t3);
    check('기준 오늘 0시 → 접수완료 0곳', t3.includes('접수완료 업체 0곳'), t3);
    check('목록도 기준 적용(5건)', await page.locator('#admin-order-list .admin-chk-item').count() === 5);
    await shot(`tabs-${OUT}-3.png`);
    // 2일 전 0시 ~ 지금 → 접수완료: 가나 샵(1일 전), 럭스걸(2일 전 +1h) = 2곳
    const d2 = new Date(Date.now() + 9 * 3600000 - 2 * 86400000).toISOString().slice(0, 10);
    await page.fill('#admin-basis-from', d2 + 'T00:00'); await page.click('button:has-text("기준 적용")'); await page.waitForTimeout(300);
    const t4 = await box();
    check('2일 전 0시부터 → 접수완료 2곳', t4.includes('접수완료 업체 2곳 · 주문 3건'), t4);
    await page.reload(); await page.waitForTimeout(1500);
    check('새로고침해도 기준 시간 기억', await page.inputValue('#admin-basis-from') === d2 + 'T00:00');
    check('새로고침하면 상태는 기본 접수대기', await page.inputValue('#admin-status-filter') === '접수대기');
    await page.selectOption('#admin-status-filter', 'ALL'); await page.evaluate(() => runAdminSearch()); await page.waitForTimeout(300);
    await page.click('button:has-text("기준 지우기")'); await page.waitForTimeout(300);
    check('기준 지우면 9건', await page.locator('#admin-order-list .admin-chk-item').count() === 9);
    // 제일 빠른 접수시간: 전체 9건 중 가장 오래된 건 = 온온 (3일 전, NO.9)
    const e1 = (await page.textContent('#admin-earliest-time')).trim();
    check('제일 빠른 접수 = 온온 NO.9', e1.includes('제일 빠른 접수') && e1.includes('온온') && e1.includes('NO.9'), e1);
    await page.click('#admin-company-tabs button:has-text("윈온골프")'); await page.waitForTimeout(300);
    const e2 = (await page.textContent('#admin-earliest-time')).trim();
    check('윈온골프만 보면 그 안에서 제일 빠른 건', e2.includes('윈온골프'), e2);
    await shot(`tabs-${OUT}-4.png`);
    await page.click('#admin-company-tabs button:has-text("모든 업체·상태 보기")'); await page.waitForTimeout(300);
  }
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
  console.log(results.filter(r => r.startsWith('FAIL')).length ? 'SOME FAILED' : 'ALL PASS');
})();
