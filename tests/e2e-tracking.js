// 셀러 송장번호 보기 · 배송조회 · 송장번호 엑셀 · 송장 빠진 주문 확인 E2E (2026-11-19)
// 실제 Supabase 대신 메모리 속 가짜 서버를 씁니다. 사용: cd tests && npm install && node e2e-tracking.js [before]
//  - 관리자 [운송장 전송] 탭에 송장 엑셀을 올리면 → 업체·받는분이 같은 주문에 송장번호가 들어가는지
//  - 셀러 화면 주문 옆 송장번호 + [배송조회], [송장번호 엑셀], '송장 없는 주문만' 보기
//  - 관리자 '송장 빠진 주문' 목록
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx-js-style');

const BEFORE = process.argv[2] === 'before';
const NM = path.join(__dirname, 'node_modules');
const ROOT = path.join(__dirname, '..');
const PAGE = 'file://' + path.join(ROOT, 'index.html') + '?test';
const OUT = path.join(__dirname, 'out');
const LIB = {
  'xlsx-js-style': 'xlsx-js-style/dist/xlsx.bundle.js',
  'jszip': 'jszip/dist/jszip.min.js',
  'lucide': 'lucide/dist/umd/lucide.min.js',
  'supabase-js': '@supabase/supabase-js/dist/umd/supabase.js',
};

const ids = { seller: '00000000-0000-0000-0000-00000000000a', other: '00000000-0000-0000-0000-00000000000b', admin: '00000000-0000-0000-0000-0000000000ad' };
const users = {
  'seller@x.com': { id: ids.seller, pw: 'password1', profile: { id: ids.seller, email: 'seller@x.com', company: '럭스걸', name: '김', phone: '010-1111-2222', role: 'seller', status: 'approved', created_at: '2026-09-01T00:00:00Z' } },
  'other@x.com': { id: ids.other, pw: 'password1', profile: { id: ids.other, email: 'other@x.com', company: '무드투문', name: '박', phone: '010-3333-2222', role: 'seller', status: 'approved', created_at: '2026-09-01T00:00:00Z' } },
  'admin@x.com': { id: ids.admin, pw: 'adminpass1', profile: { id: ids.admin, email: 'admin@x.com', company: '밤낮', name: '관리', phone: '', role: 'admin', status: 'approved', created_at: '2026-08-01T00:00:00Z' } },
};

// 한국시간 오늘 / 어제
const kst = d => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const TODAY = kst(new Date());
const YESTERDAY = kst(new Date(Date.now() - 864e5));
const at = (day, hh) => new Date(`${day}T${String(hh).padStart(2, '0')}:00:00+09:00`).toISOString();
let n = 0;
const ord = (seller, company, recipient, product, created, extra = {}) => ({
  id: `ORD-${++n}`, seller_id: seller, seller_company: company, sender_name: `밤낮딜리버리(${company})`, recipient, phone: '010-2222-' + String(1000 + n),
  address: '서울시 중구 ' + n + '번지', detail_address: '', product, status: '접수완료', ship_status: '미출고', order_type: 'fulfillment',
  order_no: 100 + n, item_no: 1, seller_order_no: n, created_at: created, courier: null, tracking_no: null, ...extra,
});
const tables = {
  orders: [
    ord(ids.seller, '럭스걸', '고객나', '(합)슬랙스 / 블랙 / 1개', at(TODAY, 9), { order_no: 200, item_no: 1 }),
    ord(ids.seller, '럭스걸', '고객나', '(합)자켓 / 그레이 / 1개', at(TODAY, 9), { order_no: 200, item_no: 2 }),
    ord(ids.seller, '럭스걸', '고객다', '자켓 / 블랙 / XL / 1개', at(TODAY, 10)),
    ord(ids.seller, '럭스걸', '고객라', '스판 자켓', at(YESTERDAY, 15)),
    ord(ids.seller, '럭스걸', '고객빠짐', '원피스 / 소라 / 1개', at(TODAY, 11)),           // 엑셀에 없음 → 송장 빠진 주문
    ord(ids.seller, '럭스걸', '고객대기', '니트', at(TODAY, 13), { status: '접수대기' }),   // 아직 접수대기 → 빠진 주문 아님
    ord(ids.seller, '럭스걸', '사무실보관', '보관 상품', at(TODAY, 8), { order_type: 'keep' }),
    ord(ids.other, '무드투문', '고객마', '(합)티셔츠 cream', at(TODAY, 9), { order_no: 300, item_no: 1 }),
    ord(ids.other, '무드투문', '고객마', '(합)티셔츠 mint', at(TODAY, 9), { order_no: 300, item_no: 2 }),
    ord(ids.other, '무드투문', '고객바', '티셔츠', at(TODAY, 9)),
    ord(ids.seller, '럭스걸', '어제빠짐', '바지', at(YESTERDAY, 11)),   // 어제 접수 → 오늘 출고일 목록엔 안 나옴
  ],
  couriers: [{ id: 'c1', name: '우체국택배', sort_order: 1 }],
  address_book: [], pickup_requests: [], settlements: [], settle_contacts: [], shipments: [],
  admin_hidden_orders: [], admin_separate_orders: [],
};
let nextShipId = 1;

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
    else if (v.startsWith('gte.')) rows = rows.filter(r => String(r[k]) >= v.slice(4));
    else if (v.startsWith('lte.')) rows = rows.filter(r => String(r[k]) <= v.slice(4));
    else if (v.startsWith('in.(')) { const list = v.slice(4, -1).split(',').map(x => x.replace(/^"|"$/g, '')); rows = rows.filter(r => list.includes(String(r[k]))); }
  }
  return rows;
}

function makeWorkbook(file) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['송화인', '수화인명', '운송장번호', '상품명', '부피추가비용'],
    ['밤낮딜리버리(럭스걸)', '고객나', '6082251369551', '(합)슬랙스', ''],
    ['밤낮딜리버리(럭스걸)', '고객나', '6082251369551', '(합)자켓', ''],
    ['밤낮딜리버리(럭스걸)', '고객다', 6082251369516, '자켓', 1000],
    ['밤낮딜리버리(럭스걸)', '고객라', '6082251369524', '스판 자켓', ''],
    ['밤낮딜리버리(무드투문)', '고객마', '미출고', '(합)티셔츠 cream', ''],
    ['밤낮딜리버리(무드투문)', '고객마', '6082251369522/부출', '(합)티셔츠 mint', ''],
    ['밤낮딜리버리(무드투문)', '고객바', '6082251369472', '티셔츠', ''],
    ['밤낮딜리버리', '이천 더드레스', '6082251369444', '의류', ''],
  ]), 'Sheet1');
  XLSX.writeFile(wb, file);
}

fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const xlsxFile = path.join(OUT, 'tracking-test.xlsx');
  makeWorkbook(xlsxFile);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const dialogs = [];
  const patches = [];
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
    const json = (status, data) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const who = whoFrom(headers);
    const isAdmin = who && who.profile.role === 'admin';
    if (url.pathname === '/auth/v1/token') {
      const u = users[body.email];
      if (!u || u.pw !== body.password) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
      return json(200, { access_token: tokenFor(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: userObj(u) });
    }
    if (url.pathname === '/auth/v1/user') return who ? json(200, userObj(who)) : json(401, { msg: 'no' });
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/rest/v1/profiles') {
      let rows = Object.values(users).map(u => u.profile).filter(p => isAdmin || (who && p.id === who.id));
      rows = applyFilters(rows, url);
      if ((headers['accept'] || '').includes('vnd.pgrst.object')) return rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' });
      return json(200, rows);
    }
    if (url.pathname === '/rest/v1/orders') {
      // 셀러는 자기 주문만 (RLS 흉내)
      const mine = tables.orders.filter(o => isAdmin || (who && o.seller_id === who.id));
      if (method === 'GET') return json(200, applyFilters(mine, url));
      if (method === 'PATCH') {
        if (!isAdmin) return json(200, []);
        const rows = applyFilters(mine, url);
        rows.forEach(r => Object.assign(r, body));
        patches.push({ ids: rows.map(r => r.id), body });
        return json(200, rows);
      }
    }
    if (url.pathname === '/rest/v1/shipments') {
      if (!isAdmin) return json(401, { message: 'permission denied' });
      if (method === 'GET') return json(200, applyFilters(tables.shipments, url));
      if (method === 'POST') {
        const list = Array.isArray(body) ? body : [body];
        for (const r of list) {
          const old = tables.shipments.find(x => x.company === r.company && x.ship_date === r.ship_date);
          if (old) Object.assign(old, r); else tables.shipments.push({ id: nextShipId++, ...r });
        }
        return json(201, list);
      }
      if (method === 'PATCH') { const rows = applyFilters(tables.shipments, url); rows.forEach(r => Object.assign(r, body)); return json(200, rows); }
    }
    const table = url.pathname.replace('/rest/v1/', '');
    if (tables[table] && method === 'GET') return json(200, applyFilters(tables[table], url));
    return json(404, { message: 'unmocked ' + url.pathname });
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => { pageErrors.push(e.message); console.log('PAGE ERROR:', e.message); });
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  const results = [];
  const check = (name, cond, extra = '') => { const l = `${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`; results.push(l); console.log(l); };
  const vis = sel => page.isVisible(sel);
  const o = id => tables.orders.find(x => x.id === id);
  const tag = BEFORE ? 'before' : 'after';
  const login = async (email, pw, admin = false) => {
    await page.goto(PAGE); await page.waitForTimeout(800);
    if (admin) await page.click('#tab-btn-admin');
    await page.fill('#login-email', email); await page.fill('#login-pw', pw);
    await page.click('#btn-login'); await page.waitForTimeout(1500);
  };
  const logout = async () => {
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  };

  // ---------- 1) 관리자: 송장 엑셀 올리기 ----------
  await login('admin@x.com', 'adminpass1', true);
  check('admin dashboard', await vis('#admin-dashboard'));
  await page.click('#admin-tab-ship'); await page.waitForTimeout(500);
  await page.fill('#ship-date', TODAY); await page.dispatchEvent('#ship-date', 'change'); await page.waitForTimeout(300);
  await page.setInputFiles('#ship-file-input', xlsxFile); await page.waitForTimeout(1500);
  await page.setViewportSize({ width: 1400, height: 1400 });
  await page.screenshot({ path: path.join(OUT, `tracking-admin-ship-${tag}.png`), fullPage: false });
  await page.setViewportSize({ width: 1400, height: 900 });
  if (!BEFORE) {
    check('합배송 고객나 2개 상품 모두 같은 송장', o('ORD-1').tracking_no === '6082251369551' && o('ORD-2').tracking_no === '6082251369551', JSON.stringify([o('ORD-1').tracking_no, o('ORD-2').tracking_no]));
    check('숫자 칸 송장도 들어감 (고객다)', o('ORD-3').tracking_no === '6082251369516');
    check('어제 접수건도 연결 (고객라)', o('ORD-4').tracking_no === '6082251369524');
    check('택배사 = 우체국택배', o('ORD-1').courier === '우체국택배');
    check('엑셀에 없는 주문은 그대로 비어 있음', !o('ORD-5').tracking_no && !o('ORD-6').tracking_no && !o('ORD-7').tracking_no);
    check('부분출고: 미출고 줄 상품 cream 은 비고, mint 만 송장', !o('ORD-8').tracking_no && o('ORD-9').tracking_no === '6082251369522', JSON.stringify([o('ORD-8').tracking_no, o('ORD-9').tracking_no]));
    check('다른 업체 고객바', o('ORD-10').tracking_no === '6082251369472');
    check('출고상태(ship_status)는 건드리지 않음', tables.orders.every(x => x.ship_status === '미출고'));
    const linkText = await page.textContent('#ship-link-status');
    check('연결 결과 안내', /주문 \d+건에 송장번호/.test(linkText), linkText);
    const miss = (await page.textContent('#ship-missing')).replace(/\s+/g, ' ');
    check('송장 빠진 주문: 고객빠짐(엑셀에 없음) + 고객마 cream(미출고) 보임', miss.includes('고객빠짐') && miss.includes('엑셀에 없음') && miss.includes('고객마') && miss.includes('미출고'), miss.slice(0, 300));
    check('송장 빠진 주문: 접수대기·보관요청·송장 있는 주문은 안 보임', !miss.includes('고객대기') && !miss.includes('어제빠짐') && !miss.includes('사무실보관') && !miss.includes('고객다'), miss.slice(0, 300));
    // 다시 올려도 두 번 저장 안 함
    const before = patches.length;
    await page.setInputFiles('#ship-file-input', xlsxFile); await page.waitForTimeout(1500);
    check('같은 엑셀 다시 올려도 이미 들어간 송장은 다시 저장 안 함', patches.length === before, `${before} → ${patches.length}`);
    await page.locator('#ship-missing').scrollIntoViewIfNeeded();
    const box = await page.locator('#ship-missing-box').boundingBox();
    await page.screenshot({ path: path.join(OUT, `tracking-admin-missing-${tag}.png`), clip: { x: 0, y: Math.max(0, box.y - 20), width: 1400, height: Math.min(900, box.height + 40) } });
  }

  // ---------- 2) 셀러 화면 ----------
  await logout();
  await login('seller@x.com', 'password1');
  check('seller dashboard', await vis('#seller-dashboard'));
  const sellerText = (await page.textContent('#seller-order-list')).replace(/\s+/g, ' ');
  { const w = page.locator('.seller-work').last(); await w.scrollIntoViewIfNeeded(); const wb = await w.boundingBox(); await page.screenshot({ path: path.join(OUT, `note-seller-top-${process.env.NOTE_TAG || tag}.png`), clip: { x: 0, y: Math.max(0, wb.y - 10), width: 1400, height: 420 } }); }
  check('셀러는 자기 주문만 (무드투문 고객 안 보임)', !sellerText.includes('고객마') && !sellerText.includes('고객바'));
  await page.locator('#seller-order-scroll').scrollIntoViewIfNeeded();
  const sbox = await page.locator('#seller-order-scroll').boundingBox();
  await page.screenshot({ path: path.join(OUT, `tracking-seller-${tag}.png`), clip: { x: 0, y: Math.max(0, sbox.y - 150), width: 1400, height: Math.min(560, sbox.height + 150) } });
  if (!BEFORE) {
    check('주문 옆 송장번호 보임', sellerText.includes('6082251369551') && sellerText.includes('6082251369516'));
    const link = await page.locator('#seller-order-list a.track-link').first().getAttribute('href');
    check('[배송조회] = 우체국 배송조회 주소', /^https:\/\/service\.epost\.go\.kr\/trace\.RetrieveDomRigiTraceList\.comm\?sid1=\d{13}$/.test(link), link);
    check('송장 없는 주문은 "아직 없음"', (await page.locator('#seller-order-list tr', { hasText: '고객빠짐' }).textContent()).includes('아직 없음'));
    // 송장 없는 주문만 보기
    await page.selectOption('#history-tracking', 'none'); await page.click('#btn-history-search'); await page.waitForTimeout(300);
    let t = (await page.textContent('#seller-order-list')).replace(/\s+/g, ' ');
    check('[송장 없는 주문만] → 고객빠짐·고객대기, 송장 있는 것·보관요청 제외', t.includes('고객빠짐') && t.includes('고객대기') && !t.includes('고객다') && !t.includes('사무실보관'), t.slice(0, 200));
    await page.screenshot({ path: path.join(OUT, `tracking-seller-missing-${tag}.png`), clip: { x: 0, y: Math.max(0, sbox.y - 150), width: 1400, height: 420 } });
    await page.selectOption('#history-tracking', 'all'); await page.click('#btn-history-search'); await page.waitForTimeout(300);
    // 송장번호 엑셀
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-tracking-excel')]);
    const file = path.join(OUT, 'tracking-download.xlsx');
    await dl.saveAs(file);
    const wb = XLSX.readFile(file);
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    check('엑셀 머리글', aoa[0].join('|') === '접수일시|NO.|받는분|연락처|주소|쇼핑몰 상품명|택배사|송장번호', aoa[0].join('|'));
    check('엑셀: 오늘 조회 중 송장 있는 3줄만 (빠진 주문·보관요청 제외)', aoa.length === 4 && aoa.slice(1).every(r => /^\d{13}$/.test(String(r[7]))), JSON.stringify(aoa.slice(1).map(r => [r[2], r[7]])));
    check('엑셀: 송장번호가 글자로 저장 (앞자리 0 보존용)', wb.Sheets[wb.SheetNames[0]]['H2'].t === 's');
    check('엑셀 받고 나서 빠진 주문 안내', dialogs.some(d => d.includes('송장번호가 아직 없는')), dialogs[dialogs.length - 1]);
    // 휴대폰 화면
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
    await page.locator('#seller-order-scroll').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, `tracking-seller-mobile-${tag}.png`) });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check('휴대폰: 화면 전체 가로 넘침 없음', !overflow);
    await page.setViewportSize({ width: 1400, height: 900 });
  }
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
  const fails = results.filter(r => r.startsWith('FAIL'));
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length && !BEFORE ? 1 : 0);
})();
