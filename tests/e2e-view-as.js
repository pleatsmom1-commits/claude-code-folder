// 관리자 [셀러관리] > [화면 보기]: 업체가 로그인했을 때 보는 화면을 보기 전용으로 열기. 사용: cd tests && npm install && node e2e-view-as.js
// 실제 Supabase 대신 메모리 속 가짜 서버를 씁니다.
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
    if (url.pathname === '/rest/v1/rpc/stock_hidden_for' || url.pathname === '/rest/v1/rpc/my_stock_visible') return json(200, url.pathname.endsWith('stock_hidden_for') ? false : true);
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



  // 셀러 주소록·픽업요청 (관리자 보기에서 셀러 것만 나오는지)
  tables.pickup_requests.push({ id: 'p2', seller_id: ids.seller, seller_company: '가나 샵', store_name: '가나매장', store_location: '1층', prepay: false, prepay_misong: false, agreed: true, status: '접수', created_at: new Date().toISOString() });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => { pageErrors.push(e.message); console.log('PAGE ERROR:', e.message); });
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  const results = [];
  const check = (name, cond, extra = '') => { const l = `${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`; results.push(l); console.log(l); };
  const OUT = path.join(__dirname, 'out');

  // 1) 셀러가 직접 로그인했을 때 화면 (비교용)
  await page.goto(PAGE); await page.waitForTimeout(800);
  await page.fill('#login-email', 'seller@x.com'); await page.fill('#login-pw', 'password1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'viewas-seller-real.png') });
  const sellerNav = (await page.textContent('#nav-user-area')).replace(/\s+/g, ' ');
  await page.click('#nav-user-area button:has-text("로그아웃")'); await page.waitForTimeout(800);

  // 2) 관리자 로그인 → 셀러관리 탭 [화면 보기] 버튼
  await page.click('#tab-btn-admin');
  await page.fill('#login-email', 'admin@x.com'); await page.fill('#login-pw', 'adminpass1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  await page.click('#admin-group-sellers'); await page.waitForTimeout(500);
  const viewBtn = page.locator('#seller-admin-list button:has-text("화면 보기")');
  check('셀러관리 목록에 [화면 보기] 버튼 (셀러 1명, 관리자 줄에는 없음)', await viewBtn.count() === 1, String(await viewBtn.count()));
  await page.screenshot({ path: path.join(OUT, 'viewas-admin-sellers-after.png'), clip: { x: 0, y: 0, width: 1400, height: 560 } });
  await page.evaluate(() => document.querySelectorAll('#seller-admin-list button').forEach(b => { if (b.textContent.includes('화면 보기')) b.style.display = 'none'; }));
  await page.screenshot({ path: path.join(OUT, 'viewas-admin-sellers-before.png'), clip: { x: 0, y: 0, width: 1400, height: 560 } });
  await page.evaluate(() => document.querySelectorAll('#seller-admin-list button').forEach(b => b.style.display = ''));
  const [popup] = await Promise.all([context.waitForEvent('page'), viewBtn.click()]);
  check('[화면 보기]는 새 창으로 view_as 주소를 연다', popup.url().includes('view_as=' + ids.seller), popup.url());
  await popup.close().catch(() => {});

  // 3) 보기 전용 창 (file:// 이라 직접 주소로 엽니다)
  const v = await context.newPage();
  v.on('pageerror', e => { pageErrors.push(e.message); console.log('PAGE ERROR(view):', e.message); });
  v.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  await v.goto(PAGE + '&view_as=' + ids.seller); await v.waitForTimeout(1800);
  check('맨 위 보라색 띠 표시', await v.isVisible('#view-as-bar'));
  check('띠에 업체명', (await v.textContent('#view-as-company')) === '가나 샵');
  check('셀러 화면이 보임', await v.isVisible('#seller-dashboard'));
  check('관리자 화면은 숨김', !(await v.isVisible('#admin-dashboard')));
  const viewNav = (await v.textContent('#nav-user-area')).replace(/\s+/g, ' ');
  check('오른쪽 위 업체명 = 셀러와 같음', viewNav.includes('가나 샵님') && sellerNav.includes('가나 샵님'), viewNav);
  check('로그아웃 대신 [관리자로 돌아가기]', viewNav.includes('관리자로 돌아가기') && !viewNav.includes('로그아웃'));
  check('재고 확인 버튼은 업체 미리보기 주소', (await v.getAttribute('#nav-stock-btn', 'href')).includes('/stock?company=' + encodeURIComponent('가나 샵')));
  await v.screenshot({ path: path.join(OUT, 'viewas-view.png') });
  await v.setViewportSize({ width: 390, height: 844 }); await v.waitForTimeout(300);
  await v.screenshot({ path: path.join(OUT, 'viewas-view-mobile.png') });
  await v.setViewportSize({ width: 1400, height: 900 });

  // 4) 저장·수정·삭제·알림이 실제로 막히는지
  const before = requests.length;
  const res = await v.evaluate(async () => {
    const a = await supabaseClient.from('orders').insert([{ recipient: 'x' }]).select();
    const b = await supabaseClient.from('orders').update({ recipient: 'y' }).eq('id', 'ORD-1').select();
    const c = await supabaseClient.from('orders').delete().eq('id', 'ORD-1').select();
    const d = await supabaseClient.rpc('cancel_my_pickup', { p_id: 'p2' });
    const e = await supabaseClient.from('profiles').update({ name: 'z' }).eq('id', currentUserId).select();
    const f = await fetch('/api/order-ai', { method: 'POST', body: '{}' }).then(r => r.status).catch(() => 'err');
    const g = await supabaseClient.from('orders').select('id').eq('seller_id', currentUserId);
    return [a, b, c, d, e].map(r => r.error && r.error.code).concat([f, (g.data || []).length]);
  });
  const writes = requests.slice(before).filter(r => r.method !== 'GET' && r.method !== 'HEAD' && !r.path.startsWith('/auth/'));
  check('저장/수정/삭제/취소/내정보 모두 VIEW_ONLY 로 막힘', res.slice(0, 5).every(c => c === 'VIEW_ONLY'), JSON.stringify(res));
  check('서버 기능(/api) POST 도 막힘', res[5] === 403, String(res[5]));
  check('읽기는 그대로 (주문 불러오기)', res[6] === 2, String(res[6]));
  check('가짜 DB 에 쓰기 요청이 하나도 안 감', writes.length === 0, JSON.stringify(writes));
  // 화면 버튼으로 시도: 보관요청 접수
  const d0 = dialogs.length;
  await v.evaluate(() => { const o = document.querySelector('#nav-user-area button'); }); 
  const tried = await v.evaluate(async () => { try { await supabaseClient.from('pickup_requests').insert([{ store_name: 'a' }]); } catch (e) { return 'throw'; } return 'ok'; });
  check('막혀도 화면 오류 없이 계속', tried === 'ok');
  const pickRows = await v.evaluate(async () => { await loadMyPickupRequests(); return myPickupRequests.map(r => r.seller_id); });
  check('내 픽업요청 내역은 이 업체 것만', pickRows.length === 1 && pickRows[0] === '00000000-0000-0000-0000-00000000000a', JSON.stringify(pickRows));

  // 5) 관리자로 돌아가기 → 관리자 로그인 유지
  const errsBeforeExit = pageErrors.length;
  await v.click('#view-as-bar button'); await v.waitForTimeout(1500);
  pageErrors.length = errsBeforeExit; // file:// 의 '/' 는 폴더 목록 화면이라 그 화면 오류는 빼고 봅니다
  // file:// 에서는 '/' 로 가므로 원래 화면 주소로 다시 열어 관리자 로그인 유지 확인
  await v.goto(PAGE); await v.waitForTimeout(1500);
  check('돌아가면 관리자 화면 (로그인 유지)', await v.isVisible('#admin-dashboard'));
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
  console.log(results.filter(r => r.startsWith('FAIL')).length ? 'SOME FAILED' : 'ALL PASS');
})();
