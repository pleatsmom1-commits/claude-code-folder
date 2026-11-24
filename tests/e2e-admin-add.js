// 관리자 주문관리: [관리자 주문 추가 접수] — 거래처와 같은 업체면 그 업체 접수목록 숫자에 합쳐짐. 사용: cd tests && node e2e-admin-add.js
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
    if (url.pathname === '/rest/v1/orders' && method === 'POST') {
      const list = (Array.isArray(body) ? body : [body]).map(r => {
        const n = Math.max(0, ...tables.orders.map(o => o.order_no || 0)) + 1;
        const sid = r.seller_id || who.id;
        const row = { ship_status: '미출고', ...r, seller_id: sid, order_no: n, item_no: 1, seller_order_no: tables.orders.filter(o => o.seller_id === sid).length + 1, created_at: new Date().toISOString() };
        tables.orders.push(row); return row;
      });
      return json(201, list);
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
  users['prelly@x.com'] = { id: ids.prelly = '00000000-0000-0000-0000-0000000000b1', pw: 'pw', profile: { id: '00000000-0000-0000-0000-0000000000b1', email: 'prelly@x.com', company: '프렐리', name: '박', phone: '010-7777-8888', role: 'seller', status: 'approved', created_at: '2026-09-01T00:00:00Z' } };
  tables.orders = [];
  const names = ['미닛걸', '대륙의실수샵', '라비에', '디바운트', '디어뮤', '프렐리', '로비앙', '샤르빈', '스윗빈', '에리코'];
  names.forEach((c, i) => { for (let k = 0; k <= (i * 7) % 4; k++) { const n = 100 + i * 10 + k; tables.orders.push({ id: 'ORD-' + n, seller_id: c === '프렐리' ? ids.prelly : ids.seller, seller_company: c, sender_name: `밤낮딜리버리(${c})`, recipient: '고객' + n, phone: '010-0000-' + n, address: '서울 중구 테스트로 ' + n, product: '의류 / FREE / 1개', status: '접수대기', ship_status: '미출고', order_type: 'fulfillment', order_no: n, item_no: 1, seller_order_no: k + 1, created_at: new Date(Date.now() - ((names.length - i) * 37 + k) * 60000 - 6 * 3600000).toISOString() }); } });
  const OUT = process.env.OUT || 'after';
  const outDir = path.join(__dirname, 'out');
  await page.goto(PAGE); await page.waitForTimeout(800);
  await page.click('#tab-btn-admin');
  await page.fill('#login-email', 'admin@x.com'); await page.fill('#login-pw', 'adminpass1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  const chipText = async c => (await page.locator(`#admin-company-tabs button:has-text("${c}")`).first().textContent()).replace(/\s+/g, ' ').trim();
  await page.screenshot({ path: path.join(outDir, `add-${OUT}-1.png`), clip: { x: 0, y: 330, width: 1400, height: 330 } });
  if (OUT === 'after') {
    const before = await chipText('프렐리');
    check('처음 프렐리 칩 4건', /프렐리 4\b/.test(before), before);
    await page.click('#btn-admin-add-order'); await page.waitForTimeout(300);
    check('추가 접수 창 열림', await page.isVisible('#admin-add-modal'));
    await page.fill('#aa-company', '프렐리 '); await page.dispatchEvent('#aa-company', 'input'); await page.waitForTimeout(200);
    const mt = await page.textContent('#aa-company-match');
    check('같은 거래처 알림', mt.includes('같은 업체') && mt.includes('4건 → 5건'), mt);
    check('송화인명 자동', await page.inputValue('#aa-sender-name') === '밤낮딜리버리(프렐리)');
    check('C/S 연락처 자동(셀러 가입 번호)', await page.inputValue('#aa-cs-phone') === '010-7777-8888');
    await page.fill('#aa-recipient', '신양숙'); await page.fill('#aa-phone', '01066803957');
    await page.fill('#aa-product', '캐시미어 실크 니트 / 그레이 / FREE / 1개');
    await page.fill('#aa-address', '경기 구리시 장자대로37번길 20'); await page.fill('#aa-detail-address', '104동 1401호');
    await page.fill('#aa-bamnat-memo', '전화로 추가 주문');
    await page.locator('#admin-add-modal > div').screenshot({ path: path.join(outDir, `add-${OUT}-2-modal.png`) });
    await page.click('#aa-submit'); await page.waitForTimeout(600);
    const saved = tables.orders.find(o => String(o.id).startsWith('ORD-ADM-'));
    check('저장됨: 프렐리 셀러 주문으로', saved && saved.seller_id === ids.prelly && saved.seller_company === '프렐리' && saved.status === '접수대기', JSON.stringify(saved || {}).slice(0, 200));
    const after = await chipText('프렐리');
    check('프렐리 칩 5건으로 늘어남', /프렐리 5\b/.test(after), after);
    await page.click('#admin-company-tabs button:has-text("프렐리")'); await page.waitForTimeout(300);
    const rows = await page.locator('#admin-order-list .admin-chk-item').count();
    check('프렐리 누르면 5건', rows === 5, String(rows));
    const listText = await page.textContent('#admin-order-list');
    check('관리자 추가 표시', listText.includes('관리자 추가'));
    await page.screenshot({ path: path.join(outDir, `add-${OUT}-3-list.png`), clip: { x: 0, y: 330, width: 1400, height: 560 } });
    await page.setViewportSize({ width: 2100, height: 900 }); await page.waitForTimeout(300);
    const tb = await page.locator('#admin-order-list').evaluate(el => { const t = el.closest('table'); t.scrollIntoView(); const r = t.getBoundingClientRect(); const rows = t.querySelectorAll('tbody tr'); const r3 = rows[Math.min(2, rows.length - 1)].getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r3.bottom - r.y }; });
    await page.screenshot({ path: path.join(outDir, `add-${OUT}-5-rows.png`), clip: { x: tb.x, y: tb.y, width: Math.min(tb.w, 2100 - tb.x), height: tb.h } });
    await page.setViewportSize({ width: 1400, height: 900 }); await page.waitForTimeout(300);
    // 거래처 아닌 이름
    await page.click('#btn-admin-add-order'); await page.waitForTimeout(300);
    await page.fill('#aa-company', '처음보는샵'); await page.dispatchEvent('#aa-company', 'input');
    const mt2 = await page.textContent('#aa-company-match');
    check('없는 거래처 경고', mt2.includes('거래처가 없어요'), mt2);
    await page.locator('#admin-add-modal > div').screenshot({ path: path.join(outDir, `add-${OUT}-4-new.png`) });
    await page.click('#admin-add-modal button:has-text("취소")');
  }
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
  console.log(results.filter(r => r.startsWith('FAIL')).length ? 'SOME FAILED' : 'ALL PASS');
})();
