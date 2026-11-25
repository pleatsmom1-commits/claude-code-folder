// 셀러 [미출고 주문 다시 접수]. 사용: cd tests && node e2e-redo-orders.js   (SHOT_DIR 를 주면 그림 저장, BEFORE=1 이면 바꾸기 전 화면만)
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

const ago = d => new Date(Date.now() - d * 86400000).toISOString();
const ids = { seller: '00000000-0000-0000-0000-00000000000a', admin: '00000000-0000-0000-0000-0000000000ad' };
const users = {
  'seller@x.com': { id: ids.seller, pw: 'password1', profile: { id: ids.seller, email: 'seller@x.com', company: '가나 샵', name: '김', phone: '010-1111-2222', role: 'seller', status: 'approved', created_at: '2026-09-01T00:00:00Z' } },
  'admin@x.com': { id: ids.admin, pw: 'adminpass1', profile: { id: ids.admin, email: 'admin@x.com', company: '밤낮', name: '관리', phone: '', role: 'admin', status: 'approved', created_at: '2026-08-01T00:00:00Z' } },
};
const tables = {
  orders: [
    { id: 'ORD-A', seller_id: ids.seller, seller_company: '가나 샵', sender_name: '밤낮딜리버리(가나 샵)', cs_phone: '010-1111-2222', recipient: '홍길동', phone: '010-2222-3333', zipcode: '06000', address: '서울 강남구 테헤란로 1', detail_address: '101호', product: '꽃무늬 원피스 블랙 F 1개', wholesale_company: '디오트 2층 12호', wholesale_product: '플라워원피스', bamnat_memo: '', status: '접수완료', ship_status: '미출고', order_type: 'fulfillment', order_no: 11, item_no: 1, seller_order_no: 11, created_at: ago(1) },
    { id: 'ORD-H1', seller_id: ids.seller, seller_company: '가나 샵', sender_name: '밤낮딜리버리(가나 샵)', recipient: '김철수', phone: '010-5555-6666', address: '부산 해운대구 1', product: '(합) 니트 아이보리 1개', wholesale_company: '청평화 1층', wholesale_product: '니트', bamnat_memo: '꼼꼼히 포장', status: '접수완료', ship_status: '미출고', order_type: 'fulfillment', order_no: 12, item_no: 1, seller_order_no: 12, created_at: ago(1.1) },
    { id: 'ORD-H2', seller_id: ids.seller, seller_company: '가나 샵', sender_name: '밤낮딜리버리(가나 샵)', recipient: '김철수', phone: '010-5555-6666', address: '부산 해운대구 1', product: '(합) 슬랙스 블랙 M 1개', wholesale_company: '청평화 1층', wholesale_product: '슬랙스', status: '접수완료', ship_status: '미출고', order_type: 'fulfillment', order_no: 12, item_no: 2, seller_order_no: 12, created_at: ago(1.1) },
    { id: 'ORD-T', seller_id: ids.seller, seller_company: '가나 샵', sender_name: '밤낮딜리버리(가나 샵)', recipient: '송장있음', phone: '010-7777-8888', address: '대구', product: '청바지', status: '접수완료', ship_status: '미출고', tracking_no: '6012345678901', courier: '우체국택배', order_type: 'fulfillment', order_no: 10, item_no: 1, seller_order_no: 10, created_at: ago(1.2) },
    { id: 'ORD-W', seller_id: ids.seller, seller_company: '가나 샵', sender_name: '밤낮딜리버리(가나 샵)', recipient: '대기중', phone: '010-1212-3434', address: '인천', product: '셔츠', status: '접수대기', ship_status: '미출고', order_type: 'fulfillment', order_no: 13, item_no: 1, seller_order_no: 13, created_at: ago(0.1) },
    { id: 'ORD-OLD', seller_id: ids.seller, seller_company: '가나 샵', sender_name: '밤낮딜리버리(가나 샵)', recipient: '오래된주문', phone: '010-9999-0000', address: '광주', product: '코트', status: '접수완료', ship_status: '미출고', order_type: 'fulfillment', order_no: 5, item_no: 1, seller_order_no: 5, created_at: ago(10) },
    { id: 'ORD-S', seller_id: ids.seller, seller_company: '가나 샵', sender_name: '밤낮딜리버리', recipient: '매장', phone: '010-1313-1414', address: '서울', product: '매장상품', status: '접수완료', ship_status: '미출고', order_type: 'store_post', order_no: 9, item_no: 1, seller_order_no: 9, created_at: ago(1) },
  ],
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
    if (url.pathname === '/rest/v1/orders' && method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      const out = list.map(r => {
        let no = null, item = 1;
        if (/\(합\)/.test(r.product)) { const m = tables.orders.find(o => o.status === r.status && /\(합\)/.test(o.product) && o.recipient === r.recipient && o.phone === r.phone); if (m) { no = m.order_no; item = tables.orders.filter(o => o.order_no === no).length + 1; } }
        if (no == null) no = Math.max(...tables.orders.map(o => o.order_no || 0)) + 1;
        const sno = tables.orders.find(o => o.order_no === no)?.seller_order_no || Math.max(...tables.orders.map(o => o.seller_order_no || 0)) + 1;
        const row = { ...r, seller_id: who.id, order_no: no, item_no: item, seller_order_no: sno, ship_status: '미출고', created_at: new Date().toISOString() };
        tables.orders.push(row); return row;
      });
      return json(201, out);
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
  const shot = async (n, el) => { if (!process.env.SHOT_DIR) return; if (el) await page.locator(el).screenshot({ path: path.join(OUT, n) }); else await page.screenshot({ path: path.join(OUT, n) }); };
  await page.setViewportSize({ width: Number(process.env.SHOT_W || 1400), height: 900 });
  await page.goto(PAGE); await page.waitForTimeout(800);
  await page.fill('#login-email', 'seller@x.com'); await page.fill('#login-pw', 'password1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  check('셀러 화면', await vis('#seller-dashboard'));
  await page.evaluate(() => { document.getElementById('time-simulator-bar').style.display = 'none'; setSimulatedTime(16 * 60); setHistoryPreset('all'); });
  await page.waitForTimeout(400);
  const listCard = page.locator('#seller-order-list').locator('xpath=ancestor::div[contains(@class,"seller-work")]');
  await listCard.scrollIntoViewIfNeeded();
  await page.evaluate(() => { document.getElementById('seller-order-scroll').scrollLeft = 99999; });
  if (process.env.BEFORE) { await listCard.screenshot({ path: path.join(OUT, process.env.BEFORE) }); await browser.close(); return; }
  await listCard.screenshot({ path: path.join(OUT, 'after_list.png') }).catch(() => {});

  const rowBtn = id => page.locator(`#seller-order-list button[data-id="${id}"]`, { hasText: '다시 접수' });
  check('위 버튼 보임', await vis('#btn-redo-open'));
  check('접수완료+송장없음 → [다시 접수]', await rowBtn('ORD-A').count() === 1 && await rowBtn('ORD-H1').count() === 1);
  check('송장 있는 주문 → 없음', await rowBtn('ORD-T').count() === 0);
  check('10일 전 주문 → 없음', await rowBtn('ORD-OLD').count() === 0);
  check('매장 접수 → 없음', await rowBtn('ORD-S').count() === 0);
  check('접수대기 → 수정/삭제 그대로', await page.locator('#seller-order-list button[data-id="ORD-W"]', { hasText: '수정' }).count() === 1);

  // 07~15시 막힘
  await page.evaluate(() => setSimulatedTime(9 * 60));
  await rowBtn('ORD-A').click(); await page.waitForTimeout(300);
  check('모달 열림 + ORD-A 미리 체크', await vis('#redo-modal') && await page.locator('.redo-chk[value="ORD-A"]').isChecked());
  check('모달 목록 3건', await page.locator('.redo-chk').count() === 3);
  const posts = () => requests.filter(r => r.method === 'POST' && r.path === '/rest/v1/orders').length;
  await page.click('#btn-redo-submit'); await page.waitForTimeout(300);
  check('09시 → 저장 안 됨 + 안내', posts() === 0 && dialogs.some(d => d.includes('택배출고 작업 시간')));
  await page.evaluate(() => setSimulatedTime(16 * 60));

  await page.check('.redo-chk[value="ORD-H1"]'); await page.check('.redo-chk[value="ORD-H2"]');
  check('버튼 글자 3건', (await page.textContent('#btn-redo-submit')).includes('3건'));
  await shot('after_modal.png', '#redo-modal > div');
  await page.click('#btn-redo-submit'); await page.waitForTimeout(800);
  const added = tables.orders.filter(o => String(o.id).startsWith('ORD-RE'));
  check('3건 저장', added.length === 3, String(added.length));
  check('접수대기 + [재접수] 메모', added.every(o => o.status === '접수대기' && o.bamnat_memo.startsWith('[재접수]')));
  check('메모 이어붙임', added.some(o => o.bamnat_memo === '[재접수] 꼼꼼히 포장'));
  const h = added.filter(o => o.product.includes('(합)'));
  check('합배송 2건 같은 번호로 묶임', h.length === 2 && h[0].order_no === h[1].order_no);
  check('내용 그대로 복사', added.some(o => o.recipient === '홍길동' && o.address === '서울 강남구 테헤란로 1' && o.detail_address === '101호' && o.wholesale_product === '플라워원피스' && o.sender_name === '밤낮딜리버리(가나 샵)'));
  check('원래 주문 그대로', tables.orders.find(o => o.id === 'ORD-A').status === '접수완료');
  check('완료 안내', dialogs.some(d => d.includes('3건을 다시 접수했어요')));
  check('모달 닫힘', !(await vis('#redo-modal')));
  // 다시 열면 이미 다시 접수한 것은 막힘
  await page.click('#btn-redo-open'); await page.waitForTimeout(300);
  check('이미 다시 접수함 표시 + 체크 불가', await page.locator('.redo-chk:disabled').count() === 3 && (await page.textContent('#redo-list')).includes('이미 다시 접수함'));
  await page.evaluate(() => closeRedoModal());
  await page.evaluate(() => { document.getElementById('seller-order-scroll').scrollLeft = 99999; });
  await listCard.screenshot({ path: path.join(OUT, 'after_list_done.png') }).catch(() => {});
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
  console.log(results.filter(r => r.startsWith('FAIL')).length ? 'SOME FAILED' : 'ALL PASS');
})();
