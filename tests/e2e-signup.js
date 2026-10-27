// 회원가입 주소·필수항목·비밀번호 규칙 + 핵심 화면(로그인/셀러 주문/관리자 목록) 확인용 E2E
// 실제 Supabase 대신 메모리 속 가짜 서버를 씁니다.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');

// 테스트용 라이브러리: tests 폴더에서 npm install 하면 생깁니다.
const NM = path.join(__dirname, 'node_modules');
const PAGE = 'file:///home/user/claude-code-folder/index.html?test';
const LIB = {
  'cdn.tailwindcss.com': '@tailwindcss/browser/dist/index.global.js',
  'xlsx-js-style': 'xlsx-js-style/dist/xlsx.bundle.js',
  'jszip': 'jszip/dist/jszip.min.js',
  'lucide': 'lucide/dist/umd/lucide.min.js',
  'supabase-js': '@supabase/supabase-js/dist/umd/supabase.js',
};

const ids = { seller: '00000000-0000-0000-0000-00000000000a', admin: '00000000-0000-0000-0000-0000000000ad' };
const users = {
  'seller@x.com': { id: ids.seller, pw: 'password1', profile: { id: ids.seller, email: 'seller@x.com', company: '애플샵', name: '김', phone: '010-1111-2222', role: 'seller', status: 'approved', created_at: '2026-09-01T00:00:00Z' } },
  'admin@x.com': { id: ids.admin, pw: 'adminpass1', profile: { id: ids.admin, email: 'admin@x.com', company: '밤낮', name: '관리', phone: '', role: 'admin', status: 'approved', created_at: '2026-08-01T00:00:00Z' } },
};
const tables = {
  orders: [{ id: 'ORD-1', seller_id: ids.seller, seller_company: '애플샵', sender_name: '밤낮딜리버리(애플샵)', recipient: '홍길동', phone: '010-2222-3333', address: '서울', product: '티셔츠', status: '접수대기', ship_status: '미출고', order_type: 'fulfillment', order_no: 1, item_no: 1, seller_order_no: 1, created_at: new Date().toISOString() }],
  couriers: [{ id: 'c1', name: '우체국택배', sort_order: 1 }],
  address_book: [], pickup_requests: [], settlements: [], settle_contacts: [],
};
const requests = [];

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
    if (url.pathname === '/auth/v1/signup') return json(200, { id: 'new-user', email: body.email, user_metadata: body.data, aud: 'authenticated', role: '', confirmation_sent_at: new Date().toISOString() });
    if (url.pathname === '/auth/v1/user') {
      if (!who) return json(401, { msg: 'no' });
      if (method === 'PUT' && body.password) who.pw = body.password;
      return json(200, userObj(who));
    }
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/rest/v1/rpc/company_available') {
      const n = v => String(v || '').replace(/\s/g, '').toLowerCase();
      return json(200, !Object.values(users).some(u => n(u.profile.company) === n(body.p_company)));
    }
    if (url.pathname === '/rest/v1/profiles') {
      const isAdmin = who && who.profile.role === 'admin';
      let rows = Object.values(users).map(u => u.profile).filter(p => isAdmin || (who && p.id === who.id));
      rows = applyFilters(rows, url);
      if (method === 'PATCH') { rows.forEach(p => Object.assign(p, body)); return json(200, rows); }
      if ((headers['accept'] || '').includes('vnd.pgrst.object')) return rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' });
      return json(200, rows);
    }
    const table = url.pathname.replace('/rest/v1/', '');
    if (tables[table]) {
      const isAdmin = who && who.profile.role === 'admin';
      let rows = tables[table].filter(r => isAdmin || !('seller_id' in r) || (who && r.seller_id === who.id));
      if (method === 'GET') return json(200, applyFilters(rows, url));
      if (method === 'POST') { const list = (Array.isArray(body) ? body : [body]).map(r => ({ ...r, seller_id: who && who.id, created_at: new Date().toISOString() })); tables[table].push(...list); return json(201, list); }
      if (method === 'PATCH') { const hit = applyFilters(rows, url); hit.forEach(r => Object.assign(r, body)); return json(200, hit); }
      if (method === 'DELETE') { const hit = applyFilters(rows, url); tables[table] = tables[table].filter(r => !hit.includes(r)); return json(200, hit); }
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
  const signupCalls = () => requests.filter(r => r.path === '/auth/v1/signup');

  // ---------- 1. 로그인 화면 ----------
  await page.goto(PAGE); await page.waitForTimeout(800);
  check('login screen shown', await vis('#login-form'));

  // ---------- 2. 회원가입 ----------
  await page.click('button:has-text("회원가입하기")'); await page.waitForTimeout(200);
  check('signup modal open', await vis('#signup-modal'));
  const labels = await page.$$eval('#signup-modal label', ls => ls.map(l => l.textContent.replace(/\s+/g, ' ').trim()));
  check('required stars: 대표자명 / 연락처 / 매장·사무실 주소', ['대표자명 *', '연락처 (C/S) *', '매장 · 사무실 주소 *'].every(t => labels.includes(t)), labels.join(' | '));
  check('address search + detail inputs', (await vis('#signup-zipcode')) && (await vis('#signup-address')) && (await vis('#signup-detail-address')) && (await vis('#signup-modal button:has-text("주소 검색")')));
  check('password rule hint shown', (await page.textContent('#signup-modal')).includes('숫자 또는 특수문자'));
  check('대표자명 / 연락처 are required inputs', await page.$eval('#signup-name', e => e.required) && await page.$eval('#signup-phone', e => e.required));

  await page.fill('#signup-company', '신규샵'); await page.click('#btn-signup-company-check'); await page.waitForTimeout(300);
  await page.fill('#signup-email', 'new@x.com');
  await page.fill('#signup-name', '박대표'); await page.fill('#signup-phone', '010.9999.8888');
  // 비밀번호: 영문만 → 막힘
  await page.fill('#signup-pw', 'abcdefgh'); await page.fill('#signup-pw-confirm', 'abcdefgh');
  await page.click('#signup-modal button[type=submit]'); await page.waitForTimeout(300);
  check('password letters only -> blocked', lastDialog().includes('숫자 또는 특수문자') && signupCalls().length === 0, lastDialog());
  // 주소 없음 → 막힘
  await page.fill('#signup-pw', 'abcdefg1'); await page.fill('#signup-pw-confirm', 'abcdefg1');
  await page.click('#signup-modal button[type=submit]'); await page.waitForTimeout(300);
  check('missing address -> blocked', lastDialog().includes('주소') && signupCalls().length === 0, lastDialog());
  // 잘못된 연락처 → 막힘
  await page.evaluate(() => { document.getElementById('signup-zipcode').value = '04572'; document.getElementById('signup-address').value = '서울 중구 청계천로 400'; });
  await page.fill('#signup-detail-address', '3층 301호');
  await page.fill('#signup-phone', '1234');
  await page.click('#signup-modal button[type=submit]'); await page.waitForTimeout(300);
  check('bad phone -> blocked', lastDialog().includes('연락처') && signupCalls().length === 0, lastDialog());
  // 특수문자 비밀번호 + 정상 입력 → 가입
  await page.fill('#signup-phone', '010.9999.8888');
  await page.fill('#signup-pw', 'abcdefg!'); await page.fill('#signup-pw-confirm', 'abcdefg!');
  await page.click('#signup-modal button[type=submit]'); await page.waitForTimeout(600);
  const sc = signupCalls()[0];
  const meta = sc && sc.body && sc.body.data;
  check('signup sent with special-char password', !!sc && sc.body.password === 'abcdefg!', JSON.stringify(sc && sc.body && sc.body.password));
  check('signup metadata has name/phone(formatted)/address', meta && meta.name === '박대표' && meta.phone === '010-9999-8888' && meta.zipcode === '04572' && meta.address === '서울 중구 청계천로 400' && meta.detail_address === '3층 301호', JSON.stringify(meta));
  check('signup modal closed after success', !(await vis('#signup-modal')));

  // ---------- 3. 셀러 로그인 · 주문 화면 · 내정보 주소 ----------
  await page.fill('#login-email', 'seller@x.com'); await page.fill('#login-pw', 'password1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  check('seller dashboard shown', await vis('#seller-dashboard'));
  check('seller order form + list shown', (await page.isVisible('#single-order-form') || await page.isVisible('#store-section')) && (await page.textContent('#seller-order-list')).includes('홍길동'));
  await page.evaluate(() => openMyPage()); await page.waitForTimeout(300);
  check('mypage shows address fields', (await vis('#mypage-zipcode')) && (await vis('#mypage-detail-address')) && (await page.textContent('#mypage-account')).includes('미등록'));
  await page.evaluate(() => { document.getElementById('mypage-zipcode').value = '06000'; document.getElementById('mypage-address').value = '서울 강남구 1'; });
  await page.fill('#mypage-detail-address', '2층');
  await page.click('#mypage-modal button:has-text("정보 저장")'); await page.waitForTimeout(500);
  check('mypage saves address', users['seller@x.com'].profile.address === '서울 강남구 1' && users['seller@x.com'].profile.zipcode === '06000' && users['seller@x.com'].profile.detail_address === '2층', JSON.stringify(users['seller@x.com'].profile));
  // 내정보 비밀번호 변경 규칙
  await page.fill('#mypage-current-pw', 'password1'); await page.fill('#mypage-new-pw', 'newpassword'); await page.fill('#mypage-new-pw-confirm', 'newpassword');
  await page.click('#mypage-modal button:has-text("비밀번호 변경")'); await page.waitForTimeout(300);
  check('mypage password letters only -> blocked', lastDialog().includes('숫자 또는 특수문자') && users['seller@x.com'].pw === 'password1', lastDialog());
  await page.fill('#mypage-new-pw', 'newpass12'); await page.fill('#mypage-new-pw-confirm', 'newpass12');
  await page.click('#mypage-modal button:has-text("비밀번호 변경")'); await page.waitForTimeout(800);
  check('mypage password with number -> changed', users['seller@x.com'].pw === 'newpass12', lastDialog());
  await page.evaluate(() => closeMyPage());
  await page.evaluate(() => logout()); await page.waitForTimeout(800);

  // ---------- 4. 관리자: 주문 목록 · 셀러 주소 ----------
  await page.click('#tab-btn-admin');
  await page.fill('#login-email', 'admin@x.com'); await page.fill('#login-pw', 'adminpass1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  check('admin dashboard + order list', (await vis('#admin-dashboard')) && (await page.textContent('#admin-order-list')).includes('홍길동'));
  await page.click('#admin-tab-sellers'); await page.waitForTimeout(500);
  const sellerHead = await page.textContent('#admin-sellers-panel thead');
  const sellerRow = (await page.locator('#seller-admin-list tr', { hasText: '애플샵' }).textContent()).replace(/\s+/g, ' ');
  check('seller list shows address column + value', sellerHead.includes('매장 · 사무실 주소') && sellerRow.includes('서울 강남구 1') && sellerRow.includes('2층'), sellerRow);
  await page.fill('#seller-search', '강남구'); await page.waitForTimeout(200);
  check('seller search by address', (await page.locator('#seller-admin-list tr').count()) === 1);
  await page.fill('#seller-search', ''); await page.waitForTimeout(200);
  await page.locator('#seller-admin-list tr', { hasText: '애플샵' }).locator('button', { hasText: '정보수정' }).click(); await page.waitForTimeout(300);
  check('seller edit modal prefilled address', (await page.inputValue('#seller-edit-address')) === '서울 강남구 1' && (await page.inputValue('#seller-edit-detail-address')) === '2층');
  await page.fill('#seller-edit-detail-address', '3층');
  await page.click('#seller-edit-modal button[type=submit]'); await page.waitForTimeout(500);
  check('admin saves seller address', users['seller@x.com'].profile.detail_address === '3층', lastDialog());
  await page.screenshot({ path: path.join(__dirname, 'out', 'shot-sellers.png') });

  // 회원가입 화면 캡처
  await page.evaluate(() => logout()); await page.waitForTimeout(800);
  await page.click('#tab-btn-seller');
  await page.click('button:has-text("회원가입하기")'); await page.waitForTimeout(300);
  await page.locator('#signup-modal > div').screenshot({ path: path.join(__dirname, 'out', 'shot-signup.png') });

  check('no page script errors', pageErrors.length === 0, pageErrors.join(' | '));
  const fails = results.filter(r => r.startsWith('FAIL'));
  console.log(`\nRESULT: ${results.length - fails.length}/${results.length} passed`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
