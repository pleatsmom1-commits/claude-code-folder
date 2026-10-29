// 운송장 전송 (관리자 [운송장 전송] 탭 + 업체용 운송장 화면 ship.html) E2E
// 실제 Supabase 대신 메모리 속 가짜 서버를 씁니다. 사용: cd tests && npm install && node e2e-ship.js [실제 송장엑셀.xlsx]
//  (파일을 주면 그 엑셀도 읽어 업체별 묶음을 출력합니다. 개인정보가 있으니 저장소에 넣지 마세요)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx-js-style');

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
  orders: [{ id: 'ORD-1', seller_id: ids.seller, seller_company: '가나 샵', sender_name: '밤낮딜리버리(가나 샵)', recipient: '홍길동', phone: '010-2222-3333', address: '서울', product: '티셔츠', status: '접수대기', ship_status: '미출고', order_type: 'fulfillment', order_no: 1, item_no: 1, seller_order_no: 1, created_at: new Date().toISOString() }],
  couriers: [{ id: 'c1', name: '우체국택배', sort_order: 1 }],
  address_book: [], pickup_requests: [], settlements: [], settle_contacts: [{ company: '럭스걸', phone: '01077778888' }, { company: '유어피치', phone: '' }],
  shipments: [],
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


// 대표님 송장 엑셀과 같은 모양 (가짜 이름)
function makeWorkbook(file, extra = []) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['송화인', '수화인명', '운송장번호', '상품명', '부피추가비용'],
    ['밤낮딜리버리(르아더스)', '고객영', '6082251369497', '픽업건 의류', ''],
    ['밤낮딜리버리', '이천 더드레스', '6082251369444', '의류', ''],
    ['밤낮딜리버리', '유어피치(눈타이드)', '6082251369526', '의류/유어피치(눈타이드)', ''],
    ['밤낮딜리버리(눈타이드)', '고객가', '6082251369478', '자켓 / 블랙 / XL / 1개', ''],
    ['밤낮딜리버리(럭스걸)', '고객나', '6082251369551', '(합)슬랙스', ''],
    ['밤낮딜리버리(럭스걸)', '고객나', '6082251369551', '(합)자켓', ''],
    ['밤낮딜리버리(럭스걸)', '고객다', 6082251369516, '자켓', 1000],
    ['밤낮딜리버리(럭스걸)', '고객라', '6082251369524', '스판 자켓', ''],
    ['밤낮딜리버리(무드투문)', '고객마', '미출고', '(합)티셔츠 cream', ''],
    ['밤낮딜리버리(무드투문)', '고객마', '6082251369522/부출', '(합)티셔츠 mint', ''],
    ['밤낮딜리버리(무드투문)', '고객마', '6082251369522/부출', '(합)삭스', ''],
    ['밤낮딜리버리(무드투문)', '고객바', '6082251369472', '티셔츠', ''],
    ...extra,
    ['', '', '', '', ''],
  ]), 'Sheet1');
  XLSX.writeFile(wb, file);
}

fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });

(async () => {
  const xlsxFile = path.join(__dirname, 'out', 'ship-test.xlsx');
  makeWorkbook(xlsxFile);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const dialogs = [];
  let promptAnswer = '';
  const apiCalls = [];

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
    if (tables[table]) {
      if (method === 'GET') return json(200, applyFilters(tables[table], url));
    }
    return json(404, { message: 'unmocked ' + url.pathname });
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => { pageErrors.push(e.message); console.log('PAGE ERROR:', e.message); });
  page.on('dialog', async d => { dialogs.push(d.message()); if (d.type() === 'prompt') await d.accept(promptAnswer); else await d.accept(); });
  // file:// 화면의 /api/... 요청은 가로챌 수 없어, 화면 안의 fetch 를 바꿔 기록합니다
  await page.exposeFunction('__apiCall', c => { apiCalls.push(c); });
  await page.addInitScript(() => {
    const orig = window.fetch;
    window.fetch = (input, init = {}) => {
      const u = String(input);
      if (!u.startsWith('/api/')) return orig(input, init);
      const body = JSON.parse(init.body || '{}');
      window.__apiCall({ path: u, body });
      const results = (body.companies || []).slice(0, body.testPhone ? 1 : 99).map(company => ({ company, status: 'sent', message: '접수됨', to: '010-****-0000' }));
      return Promise.resolve(new Response(JSON.stringify({ test: !!body.testPhone, results, summary: { sent: results.length, failed: 0, skipped: 0 } }), { headers: { 'Content-Type': 'application/json' } }));
    };
  });
  const lastDialog = () => dialogs[dialogs.length - 1] || '';
  const results = [];
  const check = (name, cond, extra = '') => { const l = `${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`; results.push(l); console.log(l); };
  const vis = sel => page.isVisible(sel);
  const ship = c => tables.shipments.find(s => s.company === c);

  await page.goto(PAGE); await page.waitForTimeout(800);
  await page.click('#tab-btn-admin');
  await page.fill('#login-email', 'admin@x.com'); await page.fill('#login-pw', 'adminpass1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  check('admin dashboard + order list', (await vis('#admin-dashboard')) && (await page.textContent('#admin-order-list')).includes('홍길동'));
  await page.click('#admin-tab-ship'); await page.waitForTimeout(600);
  check('운송장 전송 tab opens', await vis('#admin-ship-panel'));
  await page.fill('#ship-date', '2026-10-28'); await page.dispatchEvent('#ship-date', 'change'); await page.waitForTimeout(300);

  await page.setInputFiles('#ship-file-input', xlsxFile); await page.waitForTimeout(800);
  const listText = (await page.textContent('#ship-list')).replace(/\s+/g, ' ');
  check('companies = 송화인 괄호 안 상호만 (그냥 밤낮딜리버리 줄은 제외)', ['르아더스', '눈타이드', '럭스걸', '무드투문'].every(c => listText.includes(c)) && !listText.includes('유어피치') && !listText.includes('더드레스'), listText);
  check('제외 줄 수 표시', (await page.textContent('#ship-file-status')).includes('괄호 없는 송화인 2줄 제외'), await page.textContent('#ship-file-status'));
  check('summary counts', (await page.textContent('#ship-summary')).includes('업체 4곳'), await page.textContent('#ship-summary'));
  const FULL = await page.evaluate(() => SHIP_FULL_FEATURES);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  if (!FULL) {
    // 간단 복사 도우미: 저장·발송 버튼 없이 업체별 [송장 목록 복사]만
    check('simple mode: 저장·발송·체크 숨김', !(await vis('#ship-save-btn')) && !(await vis('#ship-send-btn')) && !(await page.locator('#ship-list input[type=checkbox]').first().isVisible()));
    const g = Object.fromEntries(tables.shipments.map(x => [x.company, x]));
    check('upload auto-saves 4 companies for the date (Excel order kept)', tables.shipments.length === 4 && tables.shipments.every(x => x.ship_date === '2026-10-28' && !x.copied_at) && tables.shipments.sort((a, b) => a.seq - b.seq).map(x => x.company).join(',') === '르아더스,눈타이드,럭스걸,무드투문', JSON.stringify(tables.shipments.map(x => [x.company, x.seq])));
    check('럭스걸 출고 3건 (같은 송장 1건), 상품 4개, 부피추가 1000', g['럭스걸'].parcel_count === 3 && g['럭스걸'].items.length === 4 && g['럭스걸'].extra_fee === 1000);
    check('무드투문 출고 2건, 미출고 1개', g['무드투문'].parcel_count === 2 && g['무드투문'].unshipped_count === 1);
    check('number cell read as full tracking number', g['럭스걸'].items.some(i => i.tracking === '6082251369516'));
    check('매장발송(유어피치(눈타이드)) 줄은 눈타이드에 안 들어감', g['눈타이드'].items.length === 1 && !g['눈타이드'].items[0].store);
    await page.locator('#ship-list tr', { hasText: '무드투문' }).locator('button:has-text("송장 목록 복사")').click(); await page.waitForTimeout(300);
    const clip2 = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    check('송장 목록 복사: 지금 카톡 모양 (받는분 탭 송장 탭 상품) + 출고건수', clip2.startsWith('무드투문님 10/28 운송장정보 전달드립니다.\n\n총 출고된 송장건수 : 2건 ( 이중 부분출고송장건수 : 1건)\n\n') && clip2.includes('고객마\t미출고\t(합)티셔츠 cream') && clip2.includes('고객마\t6082251369522/부출\t(합)삭스') && clip2.includes('고객바\t6082251369472\t티셔츠') && clip2.endsWith('티셔츠\n\n오늘의 정산서는 모든 출고가 마무리 되는대로 바로 보내드리겠습니다. 고맙습니다.'), clip2);
    check('row copy marks ✔ + shows copied line (no popup)', (await page.textContent('#ship-next-last')).includes('무드투문') && (await page.locator('#ship-list tr', { hasText: '무드투문' }).locator('.ship-done-chk').isChecked()));
    check('copy saved to DB (copied_at)', !!g['무드투문'].copied_at);
    const order = await page.evaluate(() => shipCurrentList().map(r => r.company));
    check('table follows Excel order', order.join(',') === '르아더스,눈타이드,럭스걸,무드투문', order.join(','));
    check('버튼 문구 = [르아더스 풀필송장번호 복사]', (await page.textContent('#ship-next-btn')).trim() === '📋 르아더스 풀필송장번호 복사', await page.textContent('#ship-next-btn'));
    await page.setViewportSize({ width: 1830, height: 1000 }); await page.screenshot({ path: path.join(__dirname, 'out', 'shot-ship-btnlabel.png'), clip: { x: 0, y: 380, width: 1830, height: 330 } }); await page.setViewportSize({ width: 1400, height: 900 });
    check('next shows first company + progress', (await page.textContent('#ship-next-name')) === '르아더스' && (await page.textContent('#ship-next-progress')).includes('4곳 중 1곳 완료'));
    await page.click('#ship-next-btn'); await page.waitForTimeout(300);
    let c3 = await page.evaluate(() => navigator.clipboard.readText());
    check('다음 업체 복사 → 르아더스 copied, next = 눈타이드', c3.includes('르아더스님') && (await page.textContent('#ship-next-name')) === '눈타이드', c3.split('\n')[0]);
    await page.click('button:has-text("나중에")'); await page.waitForTimeout(200);
    check('나중에 → 눈타이드 skipped, next = 럭스걸', (await page.textContent('#ship-next-name')) === '럭스걸' && (await page.locator('#ship-list tr', { hasText: '눈타이드' }).textContent()).includes('나중에'));
    await page.click('#ship-next-btn'); await page.waitForTimeout(300);
    c3 = await page.evaluate(() => navigator.clipboard.readText());
    check('no 부분출고 → 총 출고건수만', c3.startsWith('럭스걸님 10/28 운송장정보 전달드립니다.\n\n총 출고된 송장건수 : 3건\n\n'), c3.split('\n').slice(0, 2).join(' / '));
    check('럭스걸 copied, then 순서 끝 with 눈타이드 미뤄둠', c3.includes('럭스걸님') && (await page.textContent('#ship-next-name')) === '순서 끝' && (await page.textContent('#ship-next-info')).includes('눈타이드') && (await page.isDisabled('#ship-next-btn')));
    await page.screenshot({ path: path.join(__dirname, 'out', 'shot-ship-next.png') });

    // 다른 컴퓨터/새로고침: 엑셀을 다시 올리지 않고 출고일 + [조회]만으로 다시 보임
    await page.evaluate(() => Object.keys(localStorage).filter(k => !k.startsWith('sb-')).forEach(k => localStorage.removeItem(k)));
    await page.reload(); await page.waitForTimeout(1500);
    await page.click('#admin-tab-ship'); await page.waitForTimeout(300);
    await page.fill('#ship-date', '2026-10-27'); await page.dispatchEvent('#ship-date', 'change'); await page.waitForTimeout(300);
    check('다른 날짜 → 비어 있음', (await page.textContent('#ship-list')).includes('표시할 운송장이 없습니다'));
    await page.fill('#ship-date', '2026-10-28'); await page.click('#ship-search-btn'); await page.waitForTimeout(500);
    check('[조회] → 저장된 목록 + 복사 표시 다시 보임 (엑셀 없이)', (await page.textContent('#ship-next-progress')).includes('4곳 중 3곳 완료') && (await page.textContent('#ship-next-name')) === '눈타이드' && (await page.textContent('#ship-summary')).includes('복사완료 3곳'), await page.textContent('#ship-summary'));
    await page.selectOption('#ship-filter', 'done'); await page.waitForTimeout(300);
    let rows = (await page.textContent('#ship-list')).replace(/\s+/g, ' ');
    check('복사완료 업체만 조회', rows.includes('럭스걸') && rows.includes('무드투문') && rows.includes('르아더스') && !rows.includes('눈타이드'), rows.slice(0, 200));
    await page.selectOption('#ship-filter', 'todo'); await page.waitForTimeout(300);
    rows = (await page.textContent('#ship-list')).replace(/\s+/g, ' ');
    check('미복사 업체만 조회', rows.includes('눈타이드') && !rows.includes('럭스걸'), rows.slice(0, 200));
    await page.selectOption('#ship-filter', 'all'); await page.waitForTimeout(300);
    await page.locator('#ship-list tr', { hasText: '럭스걸' }).locator('button:has-text("송장 목록 복사")').click(); await page.waitForTimeout(300);
    c3 = await page.evaluate(() => navigator.clipboard.readText());
    check('조회한 목록에서도 다시 복사 가능', c3.startsWith('럭스걸님 10/28') && c3.includes('6082251369516'), c3.split('\n')[0]);

    // 송장 추가 후 다시 올리기: 그대로인 업체는 복사 표시 유지, 바뀐 업체만 표시 해제
    makeWorkbook(xlsxFile, [['밤낮딜리버리(럭스걸)', '고객추가', '6082251369999', '추가 상품', '']]);
    await page.setInputFiles('#ship-file-input', xlsxFile); await page.waitForTimeout(1000);
    check('re-upload: still 4 rows, 럭스걸 updated', tables.shipments.length === 4 && ship('럭스걸').items.length === 5 && ship('럭스걸').parcel_count === 4);
    check('re-upload: 바뀐 럭스걸만 복사 표시 해제 + 알림', !ship('럭스걸').copied_at && !!ship('무드투문').copied_at && !!ship('르아더스').copied_at && lastDialog().includes('럭스걸'), lastDialog());
    makeWorkbook(xlsxFile);

    const chk = page.locator('#ship-list tr', { hasText: '르아더스' }).locator('.ship-done-chk');
    await chk.uncheck(); await page.waitForTimeout(300);
    check('uncheck → 복사 표시 해제 (DB 도)', !(await chk.isChecked()) && !ship('르아더스').copied_at && (await page.textContent('#ship-next-name')) === '르아더스');
    await page.click('button:has-text("처음부터 다시")'); await page.waitForTimeout(300);
    check('처음부터 다시 clears marks (DB 도)', (await page.textContent('#ship-next-progress')).includes('4곳 중 0곳 완료') && tables.shipments.every(x => !x.copied_at));
    await page.setViewportSize({ width: 1830, height: 1000 });
    await page.screenshot({ path: path.join(__dirname, 'out', 'shot-ship-checkall-before.png'), clip: { x: 0, y: 380, width: 1830, height: 500 } });
    check('[전체 체크] 버튼 보임', (await vis('#ship-checkall-btn')) && (await page.textContent('#ship-checkall-label')) === '전체 체크');
    await page.click('#ship-checkall-btn'); await page.waitForTimeout(300);
    check('[전체 체크] → 모두 복사완료 (DB 도), 버튼은 "전체 체크 해제"', tables.shipments.every(x => !!x.copied_at) && (await page.textContent('#ship-next-progress')).includes('4곳 중 4곳 완료') && (await page.textContent('#ship-checkall-label')) === '전체 체크 해제');
    await page.screenshot({ path: path.join(__dirname, 'out', 'shot-ship-checkall-after.png'), clip: { x: 0, y: 380, width: 1830, height: 500 } });
    await page.click('#ship-checkall-btn'); await page.waitForTimeout(300);
    check('[전체 체크 해제] → 모두 해제', tables.shipments.every(x => !x.copied_at) && (await page.textContent('#ship-checkall-label')) === '전체 체크');
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.click('#ship-clear-btn'); await page.waitForTimeout(400);
    check('전체 삭제 → 그 날짜 저장분 삭제, 목록 비움', tables.shipments.length === 0 && (await page.textContent('#ship-list')).includes('표시할 운송장이 없습니다') && !(await vis('#ship-next')) && !(await vis('#ship-clear-btn')));
    await page.screenshot({ path: path.join(__dirname, 'out', 'shot-ship-simple.png') });

    // 송장 작업표 v6 형식: 출력송장 시트(송장번호 모두 있음) + 미출고송장 시트(미출고 송장번호 목록)
    const v6 = path.join(__dirname, 'out', 'ship-v6.xlsx');
    const wb6 = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb6, XLSX.utils.aoa_to_sheet([
      ['송화인', '송화인전번', '수화인명', '주소', '상품명', '옵션', '전화번호', '휴대폰', '배송메세지', '운송장번호', '택배비', '수량'],
      ['밤낮딜리버리(르아더스)', '0100000', '고객영', '주소', '픽업건 의류', '', '', '', '', '6082251369497', '', '1'],
      ['밤낮딜리버리(럭스걸)', '0100000', '고객가', '주소', '자켓', '', '', '', '', '6082251300001', '', '1'],
      ['밤낮딜리버리(럭스걸)', '0100000', '고객나', '주소', '(합)슬랙스', '', '', '', '', '6082251300002', '', '1'],
      ['밤낮딜리버리(럭스걸)', '0100000', '고객나', '주소', '(합)니트', '', '', '', '', '6082251300002', '', '1'],
      ['밤낮딜리버리(럭스걸)', '0100000', '고객다', '주소', '셔츠', '', '', '', '', 6082251300003, '', '1'],
    ]), '출력송장');
    XLSX.utils.book_append_sheet(wb6, XLSX.utils.aoa_to_sheet([['미출고송장번호'], [6082251300002]]), '미출고송장');
    XLSX.utils.book_append_sheet(wb6, XLSX.utils.aoa_to_sheet([['송화인', '수화인명', '상품명', '운송장번호'], ['밤낮딜리버리', '엉뚱한값', '무시', '1']]), '출고및 미출고 결과값');
    XLSX.writeFile(wb6, v6);
    await page.setInputFiles('#ship-file-input', v6); await page.waitForTimeout(1000);
    const lux6 = ship('럭스걸');
    check('v6 형식: 출력송장 시트를 읽고 결과값 시트는 무시', tables.shipments.length === 2 && !!ship('르아더스') && lux6 && lux6.items.length === 4, JSON.stringify(tables.shipments.map(x => x.company)));
    check('v6 형식: 미출고송장 목록의 송장 → 미출고 (같은 송장 2줄 = 미출고 1개)', lux6.parcel_count === 2 && lux6.unshipped_count === 1 && lux6.items.filter(i => i.state === '미출고').length === 2, JSON.stringify(lux6 && { p: lux6.parcel_count, u: lux6.unshipped_count }));
    check('v6 형식: 파일 상태에 미출고 시트 반영 표시', (await page.textContent('#ship-file-status')).includes("'미출고송장' 시트 미출고 송장 1개 반영"), await page.textContent('#ship-file-status'));
    await page.locator('#ship-list tr', { hasText: '럭스걸' }).locator('button:has-text("송장 목록 복사")').click(); await page.waitForTimeout(300);
    const c6 = await page.evaluate(() => navigator.clipboard.readText());
    check('v6 형식: 복사 내용에 미출고 표시', c6.includes('고객나\t미출고\t(합)슬랙스') && c6.includes('고객다\t6082251300003\t셔츠') && c6.includes("총 출고된 송장건수 : 2건"), c6);
  } else {
    check('unsaved rows cannot be checked', await page.locator('#ship-list input[type=checkbox]:not([disabled])').count() === 0);
    await page.click('#ship-save-btn'); await page.waitForTimeout(800);
    check('saved 4 companies', tables.shipments.length === 4 && lastDialog().includes('4곳 저장'), lastDialog());
    const lux = ship('럭스걸');
    check('럭스걸 출고 3건 (같은 송장 1건), 상품 4개, 부피추가 1000', lux && lux.parcel_count === 3 && lux.items.length === 4 && Number(lux.extra_fee) === 1000, JSON.stringify(lux && { p: lux.parcel_count, n: lux.items.length, f: lux.extra_fee }));
    const mood = ship('무드투문');
    check('무드투문 출고 2건, 미출고 1개, 부분출고 표시', mood && mood.parcel_count === 2 && mood.unshipped_count === 1 && mood.items.filter(i => i.state === '부분출고').length === 2, JSON.stringify(mood && mood.items));
    check('number cell read as full tracking number', lux.items.some(i => i.tracking === '6082251369516'));
    check('매장발송 rows marked store; 유어피치(눈타이드) → 눈타이드', ship('르아더스').items[0].store === true && ship('눈타이드').items.length === 2 && ship('눈타이드').items[0].store === true);
    check('token made', tables.shipments.every(s => /^[0-9a-f]{32}$/.test(s.token)));

    // 체크해서 일부만: 테스트 사이트에서는 업체 발송이 막히고 시험 발송만
    await page.locator('#ship-list tr', { hasText: '럭스걸' }).locator('input[type=checkbox]').check(); await page.waitForTimeout(200);
    check('checked count shown', (await page.textContent('#ship-checked-count')).includes('1곳'));
    await page.click('#ship-send-btn'); await page.waitForTimeout(300);
    check('test site blocks real send', lastDialog().includes('테스트 사이트') && !apiCalls.length, lastDialog());
    promptAnswer = '010-5425-9060';
    await page.click('#admin-ship-panel button:has-text("시험 발송 (내 번호)")'); await page.waitForTimeout(500);
    const t = apiCalls.find(c => c.path === '/api/ship/send');
    check('test send uses checked company + my phone', t && t.body.companies[0] === '럭스걸' && t.body.testPhone === '01054259060' && t.body.date === '2026-10-28', JSON.stringify(t));
    check('test send alert', lastDialog().includes('시험 발송 접수 완료'), lastDialog());

    // 단톡방용 문구 복사
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.locator('#ship-list tr', { hasText: '럭스걸' }).locator('button:has-text("단톡방용 문구 복사")').click(); await page.waitForTimeout(300);
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    check('copy message has 출고건수 + link', clip.includes('럭스걸님, 10월 28일 운송장정보가 전달되었습니다') && clip.includes('출고건수: 3건') && clip.includes('/ship?t=' + lux.token), clip);

    await page.locator('#ship-list tr', { hasText: '무드투문' }).locator('button:has-text("송장 목록 복사")').click(); await page.waitForTimeout(300);
    const clip2 = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    check('송장 목록 복사: 지금 카톡 모양 (받는분 탭 송장 탭 상품) + 출고건수', clip2.startsWith('무드투문님 10/28 운송장정보 전달드립니다.\n\n총 출고된 송장건수 : 2건 ( 이중 부분출고송장건수 : 1건)\n\n') && clip2.includes('고객마\t미출고\t(합)티셔츠 cream') && clip2.includes('고객마\t6082251369522/부출\t(합)삭스') && clip2.includes('고객바\t6082251369472\t티셔츠') && clip2.endsWith('티셔츠\n\n오늘의 정산서는 모든 출고가 마무리 되는대로 바로 보내드리겠습니다. 고맙습니다.'), clip2);
    // 다시 올리기: 같은 내용이면 저장할 것 없음, 바뀐 업체만 '바뀜'
    lux.sent_at = new Date(Date.now() - 10 * 60 * 1000).toISOString(); lux.updated_at = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    await page.fill('#ship-date', '2026-10-28'); await page.dispatchEvent('#ship-date', 'change'); await page.waitForTimeout(400);
    await page.setInputFiles('#ship-file-input', xlsxFile); await page.waitForTimeout(800);
    check('same excel again -> nothing to save', await page.isDisabled('#ship-save-btn'));
    check('럭스걸 shows 발송완료', (await page.locator('#ship-list tr', { hasText: '럭스걸' }).textContent()).includes('발송완료'));
    await page.screenshot({ path: path.join(__dirname, 'out', 'shot-ship-admin.png') });

    // 업체 화면
    const sp = await context.newPage();
    sp.on('pageerror', e => { pageErrors.push('ship.html: ' + e.message); });
    await sp.goto(SHIP_PAGE + '?t=' + mood.token); await sp.waitForTimeout(800);
    const shipText = (await sp.textContent('#app')).replace(/\s+/g, ' ');
    check('ship page shows 출고 2 + 미출고 1 + 부분출고', shipText.includes('출고된 운송장 2건') && shipText.includes('미출고 상품 1개') && shipText.includes('부분출고') && shipText.includes('6082251369522'), shipText.slice(0, 300));
    await sp.setViewportSize({ width: 390, height: 844 });
    await sp.screenshot({ path: path.join(__dirname, 'out', 'shot-ship-page.png'), fullPage: true });
    await sp.goto(SHIP_PAGE + '?t=zzz'); await sp.waitForTimeout(300);
    check('bad token message', (await sp.textContent('#app')).includes('올바르지 않습니다'));
  }

  // 실제 송장 엑셀 (선택)
  const real = process.argv[2];
  if (real) {
    await page.setInputFiles('#ship-file-input', real); await page.waitForTimeout(1000);
    const groups = await page.evaluate(() => shipCurrentList().map(g => `${g.company}: 출고 ${g.parcel_count}건 / 상품 ${g.items.length} / 미출고 ${g.unshipped_count} / 부분 ${g.partial_count} / 부피 ${g.extra_fee}`));
    console.log('\n[실제 엑셀]', await page.evaluate(() => shipExcelWarnings), '\n' + groups.join('\n'));
  }

  check('no page script errors', pageErrors.length === 0, pageErrors.join(' | '));
  const fails = results.filter(r => r.startsWith('FAIL'));
  console.log(`\nRESULT: ${results.length - fails.length}/${results.length} passed`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
