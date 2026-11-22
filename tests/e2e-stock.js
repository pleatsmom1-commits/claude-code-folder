// 관리자 [셀러 재고 공개] 탭(숨기기) + 예전 /stock → /inventory + 핵심 화면 확인용 E2E
// 실제 Supabase 대신 메모리 속 가짜 서버를 씁니다. 사용: cd tests && npm install && node e2e-stock.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx-js-style');

const NM = path.join(__dirname, 'node_modules');
const ROOT = path.join(__dirname, '..');
const PAGE = 'file://' + path.join(ROOT, 'index.html') + '?test';
const STOCK_PAGE = 'file://' + path.join(ROOT, 'stock.html');
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
  orders: [{ id: 'ORD-1', seller_id: ids.seller, seller_company: '가나 샵', sender_name: '밤낮딜리버리(가나 샵)', recipient: '홍길동', phone: '010-2222-3333', address: '서울', product: '티셔츠', status: '접수대기', ship_status: '미출고', order_type: 'fulfillment', order_no: 1, item_no: 1, seller_order_no: 1, created_at: new Date().toISOString() }],
  couriers: [{ id: 'c1', name: '우체국택배', sort_order: 1 }],
  address_book: [], pickup_requests: [], settlements: [], settle_contacts: [],
  stock_visibility: [], products: [{ id: 1, company: '재고표만샵', deleted_at: null }, { id: 2, company: '가나샵', deleted_at: null }],
  stock_items: [{ id: 1, company: '가나샵', wholesale_company: '옛도매', wholesale_product: '지워질상품', retail_product: '', color: '', size: '', quantity: 1, location: '', stocked_on: '2026-01-01', shipped_on: null, customer: '', label: '', memo: '' }],
};
let nextStockId = 100;
const requests = [];
const norm = v => String(v || '').replace(/\s/g, '').toLowerCase();
// supabase/stock_hide.sql 흉내: 업체별 설정 → 없으면 전체 설정 → 없으면 보임
const hiddenFor = c => {
  const row = tables.stock_visibility.find(r => r.company_key === norm(c) && r.company_key !== '*');
  if (row) return row.hidden;
  const all = tables.stock_visibility.find(r => r.company_key === '*');
  return !!(all && all.hidden);
};

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

// 재고표(통합본)와 같은 모양의 시험용 엑셀: 업체 탭, 기타업체들 탭, (X) 탭, 안내 탭
function makeWorkbook(file) {
  const H = ['거래처명', '도매업체명', '도매상품명', '소매상품명', '컬러', '사이즈', '수량', '재고위치', '재고생성일', '재고출고일', '기타(반품고객명)', '라벨'];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['재고관리 예시표 입니다'], [], H, ['도매예시', '예시자켓', '', '', 'F', '베이지', 1, '6층창고', 20250407]]), '예시');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([H,
    ['가나샵', '도매A', '꽃무늬 니트', '', 'BLACK', 'FREE', 1, 'G-1', new Date(Date.UTC(2026, 9, 20)), '', '고객가', 'o'],
    ['가나샵', '도매B', '청바지', '', 'BLUE', 'S', 2, 'G-1', 260728, '', '고객나', 'o'],
    ['가나샵', '도매C', '출고된상품', '', 'RED', 'M', 1, 'G-2', 20260901, 20260915, '고객라', ''],
    ['가나샵', '도매D', '텍스트출고', '', '', '', 1, '', 20260901, '10/28출고', '', ''],
    ['가나샵', '도매E', '보관메모', '', '', '', 1, '', 20260901, '안내완료 (자체처리 상품들과 보관)', '', ''],
    ['가나샵', '', '', '', '', '', '', '', '', '', '', ''],
    ['가나샵', '', '', '', '', '', '', '', new Date(Date.UTC(2026, 1, 24)), '재고출고', '고객다', ''],
  ]), '가나샵');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['거래처명', '도매업체명', '도매상품명', '컬러', '사이즈', '잔여재고', '불량수량', '재고위치', '재고생성일', '재고출고일', '기타(반품고객명)', '', '상품명 다른거'],
    ['사아샵', '도매S', '114', '검정', '', 11, '', 'C-1', new Date(Date.UTC(2026, 9, 8)), '', '', '', '메모용'],
    ['사아샵', '도매S', '119', '블랙', '', 3, 1, 'C-2', new Date(Date.UTC(2026, 9, 7)), '', '', '', ''],
  ]), '사아샵');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['', ...H.slice(1)],
    ['다라상회', '도매가', '목걸이A', '', '', '', 1, '가-4', 45981, '', '', 'o'],
    ['마바상회', '도매나', '긴팔티B', '', '크림', '', 3, '가-4', '2026-09-28', '', '', 'o'],
  ]), '기타업체들');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([H, ['종료샵', '도매', '상품', '', '', '', 1, '', '', '', '', '']]), '종료샵(X)');
  XLSX.writeFile(wb, file);
}

fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });

(async () => {
  const xlsxFile = path.join(__dirname, 'out', 'stock-test.xlsx');
  makeWorkbook(xlsxFile);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const dialogs = [];
  let promptAnswer = '';

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
    if (url.pathname === '/rest/v1/rpc/my_stock_visible') return json(200, !!(who && who.profile.status === 'approved' && !hiddenFor(who.profile.company)));
    if (url.pathname === '/rest/v1/rpc/stock_set_hide_all' || url.pathname === '/rest/v1/rpc/stock_set_company_hidden') {
      if (!(who && who.profile.role === 'admin')) return json(403, { code: '42501', message: '관리자만 바꿀 수 있습니다.' });
      if (url.pathname.endsWith('stock_set_hide_all')) {
        tables.stock_visibility = [{ company_key: '*', company: '전체', hidden: !!body.p_hidden }];
      } else {
        const key = norm(body.p_company);
        const all = tables.stock_visibility.find(r => r.company_key === '*');
        tables.stock_visibility = tables.stock_visibility.filter(r => r.company_key !== key);
        if (!!(all && all.hidden) !== !!body.p_hidden) tables.stock_visibility.push({ company_key: key, company: body.p_company.trim(), hidden: !!body.p_hidden });
      }
      return route.fulfill({ status: 204, headers: cors });
    }
    if (url.pathname === '/rest/v1/stock_visibility' && !(who && who.profile.role === 'admin')) return json(200, []);
    if (url.pathname === '/rest/v1/stock_items') {
      // RLS 흉내: 관리자는 전부, 승인된 셀러는 자기 상호(띄어쓰기 무시)만 읽기 (숨긴 셀러는 아무것도 안 보임)
      const isAdmin = who && who.profile.role === 'admin';
      const visible = tables.stock_items.filter(r => isAdmin || (who && who.profile.status === 'approved' && norm(r.company) === norm(who.profile.company) && !hiddenFor(who.profile.company)));
      if (method === 'GET') return json(200, applyFilters(visible, url));
      if (!isAdmin) return json(403, { code: '42501', message: 'permission denied' });
      if (method === 'POST') { const list = (Array.isArray(body) ? body : [body]).map(r => ({ memo: '', label: '', ...r, id: nextStockId++ })); tables.stock_items.push(...list); return json(201, list); }
      if (method === 'PATCH') { const hit = applyFilters(visible, url); hit.forEach(r => Object.assign(r, body)); return json(200, hit); }
      if (method === 'DELETE') { const hit = applyFilters(visible, url); tables.stock_items = tables.stock_items.filter(r => !hit.includes(r)); return json(200, hit); }
    }
    const table = url.pathname.replace('/rest/v1/', '');
    if (tables[table]) {
      const isAdmin = who && who.profile.role === 'admin';
      let rows = tables[table].filter(r => isAdmin || !('seller_id' in r) || (who && r.seller_id === who.id));
      if (method === 'GET') return json(200, applyFilters(rows, url));
    }
    return json(404, { message: 'unmocked ' + url.pathname });
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => { pageErrors.push(e.message); console.log('PAGE ERROR:', e.message); });
  page.on('dialog', async d => { dialogs.push(d.message()); if (d.type() === 'prompt') await d.accept(promptAnswer); else await d.accept(); });
  const lastDialog = () => dialogs[dialogs.length - 1] || '';
  const results = [];
  const check = (name, cond, extra = '') => { const l = `${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`; results.push(l); console.log(l); };
  const vis = sel => page.isVisible(sel);
  const stockOf = c => tables.stock_items.filter(r => norm(r.company) === norm(c));

  // ---------- 1. 로그인 화면 ----------
  await page.goto(PAGE); await page.waitForTimeout(800);
  check('login screen shown', await vis('#login-form'));

  // ---------- 2. 관리자: 주문 목록 + [재고/상품/출고관리] ----------
  // 2026-11-22: 예전 보관 목록(stock_items) 화면을 없앰. 재고는 [재고표] 하나, [셀러 재고 공개] 탭엔 숨기기 설정만
  await page.click('#tab-btn-admin');
  await page.fill('#login-email', 'admin@x.com'); await page.fill('#login-pw', 'adminpass1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  check('admin dashboard + order list', (await vis('#admin-dashboard')) && (await page.textContent('#admin-order-list')).includes('홍길동'));
  await page.click('#admin-group-stock'); await page.waitForTimeout(500);
  check('stock group opens 재고표 tab first', (await vis('#admin-inventory-panel')) && !(await vis('#admin-stock-panel')));
  const tabOrder = await page.$$eval('#admin-subtabs button:not(.hidden)', bs => bs.map(b => b.textContent.trim()));
  check('셀러 재고 공개 tab is last, no 재고관리 tab', tabOrder[tabOrder.length - 1] === '셀러 재고 공개' && !tabOrder.includes('재고관리'), tabOrder.join(','));
  await page.click('#admin-tab-stock'); await page.waitForTimeout(900);
  check('셀러 재고 공개: hide box + 재고표 안내, no old list', (await vis('#stock-hide-box')) && (await page.textContent('#admin-stock-panel')).includes('재고는 [재고표] 하나로 봅니다')
    && !(await page.$('#stock-list')) && !(await page.$('#stock-company-list')) && !(await page.$('#stock-upload-modal')));
  check('old stock_items table never requested', !requests.some(r => r.path === '/rest/v1/stock_items'));
  await page.click('#admin-stock-panel button:has-text("재고표 열기")'); await page.waitForTimeout(500);
  check('[재고표 열기] switches to 재고표 tab', await vis('#admin-inventory-panel'));
  await page.evaluate(() => logout()); await page.waitForTimeout(800);

  // ---------- 3. 셀러: 주문 화면 + 재고 확인 버튼 + 재고 화면 ----------
  await page.click('#tab-btn-seller');
  await page.fill('#login-email', 'seller@x.com'); await page.fill('#login-pw', 'password1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  check('seller dashboard + order list', (await vis('#seller-dashboard')) && (await page.textContent('#seller-order-list')).includes('홍길동'));
  check('seller sees 재고 확인 button', await vis('#nav-stock-btn'));
  // 2026-11-17: 셀러 [재고 확인]은 새 재고표(/inventory)로 바뀜. 예전 /stock 주소는 /inventory 로 보냄
  check('seller 재고 확인 button → /inventory', (await page.getAttribute('#nav-stock-btn', 'href')) === '/inventory');
  const navTo = [];
  const onNav = r => { if (r.isNavigationRequest()) navTo.push(r.url()); };
  page.on('request', onNav);
  await page.goto(STOCK_PAGE).catch(() => {}); await page.waitForTimeout(1500);
  page.off('request', onNav);
  check('seller old /stock redirects to /inventory', navTo.some(u => u.endsWith('/inventory')), navTo.join(' '));
  await page.goto(PAGE); await page.waitForTimeout(1200);

  await page.setViewportSize({ width: 1400, height: 900 });

  // ---------- 4. 셀러에게 재고 숨기기 (전체 / 업체별) ----------
  await page.goto(PAGE); await page.waitForTimeout(1200);
  await page.evaluate(() => logout()); await page.waitForTimeout(800);
  await page.click('#tab-btn-admin');
  await page.fill('#login-email', 'admin@x.com'); await page.fill('#login-pw', 'adminpass1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  await page.click('#admin-group-stock'); await page.waitForTimeout(300);
  await page.click('#admin-tab-stock'); await page.waitForTimeout(900);
  check('hide box: starts all visible', (await vis('#stock-hide-box')) && !(await page.isChecked('#stock-hide-all')) && (await page.textContent('#stock-hide-status')).includes('보임'), await page.textContent('#stock-hide-status'));
  await page.screenshot({ path: path.join(__dirname, 'out', 'shot-stock-hide-off.png'), clip: { x: 0, y: 0, width: 1400, height: 560 } });
  // 업체명 조회 → 가나샵만 숨기기
  await page.fill('#stock-hide-q', '가나'); await page.waitForTimeout(200);
  check('search lists 가나샵 with 보임 + 숨기기 button', (await page.textContent('#stock-hide-list')).includes('가나샵') && (await page.textContent('#stock-hide-list')).includes('셀러에게 보임'));
  await page.fill('#stock-hide-q', '재고표만'); await page.waitForTimeout(200);
  check('search also finds 재고표(products) company', (await page.textContent('#stock-hide-list')).includes('재고표만샵'));
  await page.fill('#stock-hide-q', '가나'); await page.waitForTimeout(200);
  await page.locator('#stock-hide-list button', { hasText: '숨기기' }).first().click(); await page.waitForTimeout(800);
  check('company hidden saved as exception', tables.stock_visibility.length === 1 && tables.stock_visibility[0].company_key === '가나샵' && tables.stock_visibility[0].hidden === true, JSON.stringify(tables.stock_visibility));
  check('status shows 숨긴 업체 1곳 and row shows 숨김', (await page.textContent('#stock-hide-status')).includes('숨긴 업체 1곳') && (await page.textContent('#stock-hide-list')).includes('셀러에게 숨김'));
  await page.fill('#stock-hide-q', ''); await page.waitForTimeout(200);
  check('empty search shows the exception list', (await page.textContent('#stock-hide-list')).includes('따로 숨긴 업체') && (await page.textContent('#stock-hide-list')).includes('가나샵'));
  await page.screenshot({ path: path.join(__dirname, 'out', 'shot-stock-hide-one.png'), clip: { x: 0, y: 0, width: 1400, height: 620 } });

  // 셀러로 확인 (같은 탭에서 로그아웃 → 셀러 로그인)
  const asSeller = async () => {
    await page.goto(PAGE); await page.waitForTimeout(1200);
    await page.evaluate(() => logout()); await page.waitForTimeout(800);
    await page.click('#tab-btn-seller');
    await page.fill('#login-email', 'seller@x.com'); await page.fill('#login-pw', 'password1');
    await page.click('#btn-login'); await page.waitForTimeout(1500);
  };
  const asAdmin = async () => {
    await page.goto(PAGE); await page.waitForTimeout(1200);
    await page.evaluate(() => logout()); await page.waitForTimeout(800);
    await page.click('#tab-btn-admin');
    await page.fill('#login-email', 'admin@x.com'); await page.fill('#login-pw', 'adminpass1');
    await page.click('#btn-login'); await page.waitForTimeout(1500);
    await page.click('#admin-group-stock'); await page.waitForTimeout(300);
    await page.click('#admin-tab-stock'); await page.waitForTimeout(900);
  };
  await asSeller();
  check('hidden seller: 재고 확인 button hidden, orders still work', !(await vis('#nav-stock-btn')) && (await vis('#seller-dashboard')));
  await page.goto('file://' + path.join(ROOT, 'inventory.html')); await page.waitForTimeout(1500);
  check('hidden seller: 재고표 page says 준비 중', (await page.textContent('body')).includes('재고표를 준비 중'));

  // 전체 숨기기 체크 → 가나샵만 다시 보이기
  await asAdmin();
  await page.check('#stock-hide-all'); await page.waitForTimeout(900);
  check('hide all: exceptions cleared, * hidden', tables.stock_visibility.length === 1 && tables.stock_visibility[0].company_key === '*' && tables.stock_visibility[0].hidden, JSON.stringify(tables.stock_visibility));
  check('hide all: status 모든 셀러 숨김', (await page.isChecked('#stock-hide-all')) && (await page.textContent('#stock-hide-status')).includes('모든 셀러 숨김'));
  await page.fill('#stock-hide-q', '가나'); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(__dirname, 'out', 'shot-stock-hide-all.png'), clip: { x: 0, y: 0, width: 1400, height: 620 } });
  await page.locator('#stock-hide-list button', { hasText: '보이기' }).first().click(); await page.waitForTimeout(800);
  check('hide all + 가나샵 보이기 exception', tables.stock_visibility.some(r => r.company_key === '가나샵' && r.hidden === false));
  await asSeller();
  check('exception seller sees 재고 확인 button again', await vis('#nav-stock-btn'));
  await page.goto('file://' + path.join(ROOT, 'inventory.html')); await page.waitForTimeout(1500);
  check('exception seller: 재고표 not 준비 중', !(await page.innerText('body')).includes('재고표를 준비 중'));
  // 다시 전체 보이기
  await asAdmin();
  await page.uncheck('#stock-hide-all'); await page.waitForTimeout(900);
  check('uncheck all: everyone visible', tables.stock_visibility.length === 1 && tables.stock_visibility[0].hidden === false && !hiddenFor('가나샵'));

  check('no page script errors', pageErrors.length === 0, pageErrors.join(' | '));
  const fails = results.filter(r => r.startsWith('FAIL'));
  console.log(`\nRESULT: ${results.length - fails.length}/${results.length} passed`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
