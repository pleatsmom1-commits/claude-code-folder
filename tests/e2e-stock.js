// 재고관리 (관리자 [재고관리] 탭 + 업체 재고 확인 화면 stock.html) + 핵심 화면 확인용 E2E
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
  stock_items: [{ id: 1, company: '가나샵', wholesale_company: '옛도매', wholesale_product: '지워질상품', retail_product: '', color: '', size: '', quantity: 1, location: '', stocked_on: '2026-01-01', shipped_on: null, customer: '', label: '', memo: '' }],
};
let nextStockId = 100;
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
    if (url.pathname === '/rest/v1/stock_items') {
      // RLS 흉내: 관리자는 전부, 승인된 셀러는 자기 상호(띄어쓰기 무시)만 읽기
      const isAdmin = who && who.profile.role === 'admin';
      const visible = tables.stock_items.filter(r => isAdmin || (who && who.profile.status === 'approved' && norm(r.company) === norm(who.profile.company)));
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

  // ---------- 2. 관리자: 주문 목록 + 재고관리 탭 ----------
  await page.click('#tab-btn-admin');
  await page.fill('#login-email', 'admin@x.com'); await page.fill('#login-pw', 'adminpass1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  check('admin dashboard + order list', (await vis('#admin-dashboard')) && (await page.textContent('#admin-order-list')).includes('홍길동'));
  await page.click('#admin-tab-stock'); await page.waitForTimeout(600);
  check('stock tab shows existing item', (await vis('#admin-stock-panel')) && (await page.textContent('#stock-list')).includes('지워질상품'));
  check('company summary marks 가나샵 linked to seller "가나 샵"', (await page.textContent('#stock-company-list')).includes('연결됨'));

  // 엑셀 올리기 → 미리보기
  await page.setInputFiles('#admin-stock-panel input[type=file]', xlsxFile); await page.waitForTimeout(800);
  check('upload preview modal open', await vis('#stock-upload-modal'));
  const sheetsText = await page.textContent('#stock-upload-sheets');
  check('예시 / (X) tabs skipped', sheetsText.includes('예시: 건너뜀') && sheetsText.includes('종료샵(X): 건너뜀'), sheetsText);
  const upText = (await page.textContent('#stock-upload-list')).replace(/\s+/g, ' ');
  check('preview lists 가나샵 / 다라상회 / 마바상회, not 종료샵', ['가나샵', '다라상회', '마바상회'].every(c => upText.includes(c)) && !upText.includes('종료샵'), upText);
  check('preview says 가나샵 will be replaced', upText.includes('1줄 → 교체'), upText);
  await page.click('#stock-upload-confirm'); await page.waitForTimeout(1500);
  check('upload saved alert', lastDialog().includes('4곳을 저장'), lastDialog());
  const din = stockOf('가나샵');
  check('가나샵 replaced: 6 rows (incl. product-less return), old row gone, blank row skipped', din.length === 6 && !din.some(r => r.wholesale_product === '지워질상품'), JSON.stringify(din.map(r => r.wholesale_product)));
  const byName = n => tables.stock_items.find(r => r.wholesale_product === n) || {};
  check('dates parsed (Date / 260728 / 20260901 / serial / text)',
    byName('꽃무늬 니트').stocked_on === '2026-10-20' && byName('청바지').stocked_on === '2026-07-28'
    && byName('출고된상품').stocked_on === '2026-09-01' && byName('출고된상품').shipped_on === '2026-09-15'
    && byName('목걸이A').stocked_on === '2025-11-20' && byName('긴팔티B').stocked_on === '2026-09-28',
    JSON.stringify(tables.stock_items.map(r => [r.wholesale_product, r.stocked_on, r.shipped_on])));
  const sa = tables.stock_items.filter(r => r.company === '사아샵');
  check('잔여재고 column read as 수량, 불량수량 -> memo', sa.length === 2 && sa.find(r => r.wholesale_product === '114').quantity === 11 && sa.find(r => r.wholesale_product === '119').memo === '불량 1개', JSON.stringify(sa));
  check('기타업체들 rows use 거래처명 column', byName('목걸이A').company === '다라상회' && byName('긴팔티B').company === '마바상회' && byName('긴팔티B').quantity === 3);
  check('shipped text "10/28출고" -> date + note', byName('텍스트출고').shipped_on === '2026-10-28' && byName('텍스트출고').shipped_note === '10/28출고', JSON.stringify(byName('텍스트출고')));
  check('"…보관" text stays 보관중 with memo', !byName('보관메모').shipped_on && !byName('보관메모').shipped_note && byName('보관메모').memo.includes('보관'), JSON.stringify(byName('보관메모')));
  const ret = tables.stock_items.find(r => r.customer === '고객다') || {};
  check('product-less return row kept as 출고됨 note', ret.shipped_note === '재고출고' && ret.stocked_on === '2026-02-24', JSON.stringify(ret));
  check('customer / location / label kept', byName('꽃무늬 니트').customer === '고객가' && byName('꽃무늬 니트').location === 'G-1' && byName('꽃무늬 니트').label === 'o');

  // 목록 필터: 기본 보관중 → 출고된상품 안 보임
  let listText = await page.textContent('#stock-list');
  check('default filter 보관중 hides shipped row', listText.includes('꽃무늬 니트') && !listText.includes('출고된상품'));
  await page.selectOption('#stock-f-status', 'shipped'); await page.waitForTimeout(200);
  listText = await page.textContent('#stock-list');
  check('출고됨 filter shows shipped row only', listText.includes('출고된상품') && !listText.includes('꽃무늬 니트'));
  await page.selectOption('#stock-f-status', 'kept');
  await page.fill('#stock-f-keyword', '청바지'); await page.waitForTimeout(200);
  check('keyword search', (await page.locator('#stock-list tr').count()) === 1 && (await page.textContent('#stock-list')).includes('청바지'));
  await page.fill('#stock-f-keyword', ''); await page.waitForTimeout(200);

  // 선택 출고처리
  const flowerId = byName('꽃무늬 니트').id;
  await page.check(`#stock-list input[data-id="${flowerId}"]`);
  promptAnswer = '2026-10-27';
  await page.click('#admin-stock-panel button:has-text("선택 출고처리")'); await page.waitForTimeout(800);
  check('ship checked -> shipped_on set', byName('꽃무늬 니트').shipped_on === '2026-10-27', JSON.stringify(byName('꽃무늬 니트')));
  check('shipped row leaves 보관중 list', !(await page.textContent('#stock-list')).includes('꽃무늬 니트'));

  // 재고 추가 (반품 입고)
  await page.selectOption('#stock-f-company', norm('가나샵')); await page.waitForTimeout(200);
  await page.click('#admin-stock-panel button:has-text("재고 추가")'); await page.waitForTimeout(300);
  check('add modal open with company prefilled', (await vis('#stock-edit-modal')) && (await page.inputValue('#stock-edit-company')) === '가나샵');
  await page.fill('#stock-edit-wholesale_product', '새반품'); await page.fill('#stock-edit-quantity', '2'); await page.fill('#stock-edit-customer', '고객마');
  await page.click('#stock-edit-modal button[type=submit]'); await page.waitForTimeout(800);
  check('added row saved', byName('새반품').quantity === 2 && byName('새반품').customer === '고객마' && byName('새반품').company === '가나샵', JSON.stringify(byName('새반품')));
  // 수정
  await page.locator('#stock-list tr', { hasText: '새반품' }).locator('button', { hasText: '수정' }).click(); await page.waitForTimeout(300);
  await page.fill('#stock-edit-location', 'H-9');
  await page.click('#stock-edit-modal button[type=submit]'); await page.waitForTimeout(800);
  check('edit saved', byName('새반품').location === 'H-9');

  // 엑셀 다운로드
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#admin-stock-panel button:has-text("엑셀 다운로드")')]);
  const dlPath = path.join(__dirname, 'out', 'stock-download.xlsx'); await dl.saveAs(dlPath);
  const dwb = XLSX.readFile(dlPath);
  check('download: one tab per company with original headers', dwb.SheetNames.includes('가나샵') && XLSX.utils.sheet_to_json(dwb.Sheets['가나샵'], { header: 1 })[0].join() .startsWith('거래처명,도매업체명,도매상품명'), dwb.SheetNames.join());
  await page.selectOption('#stock-f-status', 'all'); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(__dirname, 'out', 'shot-stock-admin.png'), fullPage: true });

  // 관리자 미리보기 화면
  const p2 = await context.newPage();
  p2.on('pageerror', e => pageErrors.push('stock.html: ' + e.message));
  await p2.goto(STOCK_PAGE + '?company=' + encodeURIComponent('가나샵')); await p2.waitForTimeout(1200);
  check('admin preview page shows 가나샵 stock + preview bar', (await p2.isVisible('#preview-bar')) && (await p2.textContent('#list')).includes('새반품'));
  await p2.close();
  await page.evaluate(() => logout()); await page.waitForTimeout(800);

  // ---------- 3. 셀러: 주문 화면 + 재고 확인 버튼 + 재고 화면 ----------
  await page.click('#tab-btn-seller');
  await page.fill('#login-email', 'seller@x.com'); await page.fill('#login-pw', 'password1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  check('seller dashboard + order list', (await vis('#seller-dashboard')) && (await page.textContent('#seller-order-list')).includes('홍길동'));
  check('seller sees 재고 확인 button', await vis('#nav-stock-btn'));
  await page.goto(STOCK_PAGE); await page.waitForTimeout(1500);
  const sText = await page.textContent('#app');
  check('seller stock page: own company, kept rows, no other company', sText.includes('가나 샵') && sText.includes('청바지') && sText.includes('새반품') && !sText.includes('목걸이A') && !sText.includes('출고된상품'), sText.slice(0, 200));
  const flat = sText.replace(/\s+/g, '');
  check('seller stock page stats (보관중 3건 · 5개)', flat.includes('3보관중') && flat.includes('5보관수량'), flat.slice(0, 120));
  await page.click('#tab-shipped'); await page.waitForTimeout(200);
  const shippedText = await page.textContent('#list');
  check('seller 출고 내역 tab', shippedText.includes('출고된상품') && shippedText.includes('꽃무늬 니트') && shippedText.includes('10/28출고') && !shippedText.includes('새반품'));
  await page.click('#tab-kept');
  await page.screenshot({ path: path.join(__dirname, 'out', 'shot-stock-seller.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(__dirname, 'out', 'shot-stock-seller-mobile.png'), fullPage: true });

  check('no page script errors', pageErrors.length === 0, pageErrors.join(' | '));
  const fails = results.filter(r => r.startsWith('FAIL'));
  console.log(`\nRESULT: ${results.length - fails.length}/${results.length} passed`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
