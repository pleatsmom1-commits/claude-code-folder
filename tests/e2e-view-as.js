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
  products: [
    { id: 1, code: 'P-0001', company: '가나 샵', wholesale_company: '모노', wholesale_product: '볼캡', color: '블랙', size: 'Free', mall_names: [], memo: '', created_at: '2026-11-01T00:00:00Z' },
    { id: 2, code: 'P-0002', company: '가나 샵', wholesale_company: '모노', wholesale_product: '니트', color: '아이보리', size: 'M', mall_names: [], memo: '', created_at: '2026-11-01T00:00:00Z' },
    { id: 3, code: 'P-0003', company: '다른 샵', wholesale_company: '엘리', wholesale_product: '코트', color: '그레이', size: 'L', mall_names: [], memo: '', created_at: '2026-11-01T00:00:00Z' }],
  product_logs: [],
  stock_items: [
    { id: 1, company: '가나 샵', wholesale_company: '모노', wholesale_product: '볼캡', retail_product: '볼캡', color: '블랙', size: 'Free', quantity: 3, location: 'A1', stocked_on: '2026-11-01', status: '보관' },
    { id: 2, company: '다른 샵', wholesale_company: '엘리', wholesale_product: '코트', retail_product: '코트', color: '그레이', size: 'L', quantity: 5, location: 'B1', stocked_on: '2026-11-01', status: '보관' }],
  inventory: [{ product_id: 1, company: '가나 샵', qty_a: 3, qty_b: 0, qty_defect: 0 }, { product_id: 3, company: '다른 샵', qty_a: 5, qty_b: 0, qty_defect: 0 }],
  inventory_moves: [
    { id: 1, product_id: 1, company: '가나 샵', code: 'P-0001', kind: '조정', d_a: -1, d_b: 0, d_defect: 0, a_after: 3, b_after: 0, defect_after: 0, reason: '관리자메모-비밀', actor_name: '관리자김', at: new Date().toISOString() },
    { id: 2, product_id: 3, company: '다른 샵', code: 'P-0003', kind: '입고', d_a: 5, d_b: 0, d_defect: 0, a_after: 5, b_after: 0, defect_after: 0, reason: '', actor_name: '관리자김', at: new Date().toISOString() }],
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
    if (url.pathname === '/rest/v1/rpc/get_my_settlements') return json(200, [{ company: body.p_company, ship_date: '2026-11-10', total: 12000, token: 'tk' }]);
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
  check('재고 확인 버튼은 업체 미리보기 주소', (await v.getAttribute('#nav-stock-btn', 'href')).includes('/inventory?company=' + encodeURIComponent('가나 샵')));
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

  // 4-2) [상품관리] 버튼: 그 업체 상품만, 셀러 모양, 보기 전용
  check('상품관리 버튼은 보기 전용 주소', (await v.getAttribute('#nav-products-btn', 'href')).includes('view=1'));
  const PROD = 'file://' + path.join(ROOT, 'products.html');
  const pb = await context.newPage();
  pb.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  await pb.goto(PROD + '?company=' + encodeURIComponent('가나 샵')); await pb.waitForTimeout(1500);
  await pb.screenshot({ path: path.join(OUT, 'viewas-products-before.png'), clip: { x: 0, y: 0, width: 1400, height: 480 } });
  await pb.close();
  const pv = await context.newPage();
  pv.on('pageerror', e => { pageErrors.push(e.message); console.log('PAGE ERROR(products):', e.message); });
  pv.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  await pv.goto(PROD + '?company=' + encodeURIComponent('가나 샵') + '&view=1'); await pv.waitForTimeout(1500);
  await pv.screenshot({ path: path.join(OUT, 'viewas-products-after.png'), clip: { x: 0, y: 0, width: 1400, height: 480 } });
  const ptext = (await pv.textContent('body')).replace(/\s+/g, ' ');
  check('상품관리: 보라색 띠', await pv.isVisible('#view-as-bar'));
  check('상품관리: 이 업체 상품만 (다른 샵 코트 없음)', ptext.includes('볼캡') && ptext.includes('니트') && !ptext.includes('코트'));
  check('상품관리: 관리자용 "전체 거래처" 아님', (await pv.textContent('#header-company')).includes('가나 샵'));
  check('상품관리: 거래처 고르기 칸 숨김', !(await pv.isVisible('#f-company')));
  const pb4 = requests.length;
  const pres = await pv.evaluate(async () => [
    (await client.from('products').insert([{ company: '가나 샵', wholesale_company: 'a', wholesale_product: 'b' }]).select()).error?.code,
    (await client.from('products').update({ memo: 'x' }).eq('id', 1).select()).error?.code,
  ]);
  check('상품관리: 등록/수정 막힘', pres.every(c => c === 'VIEW_ONLY'), JSON.stringify(pres));
  check('상품관리: 가짜 DB 에 쓰기 요청 없음', requests.slice(pb4).every(r => r.method === 'GET' || r.method === 'HEAD' || r.path.startsWith('/auth/')));
  await pv.close();

  // 4-3) 나머지 버튼: 재고 확인 · 재고 증감 · 이용 현황 (모두 그 업체 화면, 보기 전용)
  for (const id of ['nav-stock-btn', 'nav-history-btn', 'nav-usage-btn', 'nav-products-btn']) {
    const href = await v.getAttribute('#' + id, 'href');
    check(id + ' → view=1 & uid', href.includes('view=1') && href.includes('uid=' + ids.seller), href);
  }
  const q = '?company=' + encodeURIComponent('가나 샵') + '&view=1&uid=' + ids.seller;
  const openSub = async (file, name) => {
    const sp = await context.newPage();
    sp.on('pageerror', e => { pageErrors.push(e.message); console.log('PAGE ERROR(' + file + '):', e.message); });
    sp.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
    await sp.goto('file://' + path.join(ROOT, file) + q); await sp.waitForTimeout(1800);
    await sp.screenshot({ path: path.join(OUT, 'viewas-sub-' + file.replace('.html', '') + '.png'), clip: { x: 0, y: 0, width: 1400, height: 520 } });
    const text = (await sp.innerText('body')).replace(/\s+/g, ' ');
    check(name + ': 보라색 띠', await sp.isVisible('#view-as-bar'));
    const back = await sp.$$eval('a', as => as.filter(a => a.textContent.includes('업체 화면으로 돌아가기')).map(a => a.getAttribute('href')));
    check(name + ': "← 업체 화면으로 돌아가기" 가 관리자 화면 아닌 업체 화면 보기로', back.length >= 1 && back.every(h => h.includes('view_as=' + '00000000-0000-0000-0000-00000000000a')), JSON.stringify(back));
    check(name + ': 관리자 화면으로 가는 링크 없음', !(await sp.$$eval('a', as => as.some(a => a.getAttribute('href') === '/'))));
    return { sp, text };
  };
  // 2026-11-22: 예전 /stock 은 없애고 /inventory 로 보냄 → 재고 확인 = 새 재고표
  { const { sp, text } = await openSub('inventory.html', '재고 확인');
    check('재고 확인: 이 업체 재고만', text.includes('볼캡') && !text.includes('코트'), text.slice(200, 900)); await sp.close(); }
  { const bp = await context.newPage(); await bp.goto('file://' + path.join(ROOT, 'stock-history.html') + '?company=' + encodeURIComponent('가나 샵')); await bp.waitForTimeout(1800);
    await bp.screenshot({ path: path.join(OUT, 'viewas-sub-stock-history-before.png'), clip: { x: 0, y: 0, width: 1400, height: 520 } }); await bp.close(); }
  { const { sp, text } = await openSub('stock-history.html', '재고 증감');
    check('재고 증감: 이 업체 것만 + 관리자 메모·담당자 숨김(셀러와 같음)', !text.includes('관리자메모-비밀') && !text.includes('관리자김') && !text.includes('전체 거래처') && !(await sp.isVisible('#f-company')), text.slice(0, 300));
    check('재고 증감: 다른 업체 기록 안 보임', !text.includes('P-0003')); await sp.close(); }
  { const { sp, text } = await openSub('usage.html', '이용 현황');
    check('이용 현황: 이 업체 이름', text.includes('가나 샵')); await sp.close(); }

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
