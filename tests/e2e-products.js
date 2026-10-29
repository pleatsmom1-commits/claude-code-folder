// 상품관리 (products.html + 관리자 [상품관리] 탭 + 셀러 [상품관리] 버튼) E2E
// 실제 Supabase 대신 메모리 속 가짜 서버를 씁니다. 사용: cd tests && npm install && node e2e-products.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx-js-style');

const NM = path.join(__dirname, 'node_modules');
const ROOT = path.join(__dirname, '..');
const INDEX = 'file://' + path.join(ROOT, 'index.html') + '?test';
const PRODUCTS = 'file://' + path.join(ROOT, 'products.html');
const LIB = {
  'cdn.tailwindcss.com': '@tailwindcss/browser/dist/index.global.js',
  'xlsx-js-style': 'xlsx-js-style/dist/xlsx.bundle.js',
  'jszip': 'jszip/dist/jszip.min.js',
  'lucide': 'lucide/dist/umd/lucide.min.js',
  'supabase-js': '@supabase/supabase-js/dist/umd/supabase.js',
};

const ids = { seller: '00000000-0000-0000-0000-00000000000a', other: '00000000-0000-0000-0000-00000000000b', admin: '00000000-0000-0000-0000-0000000000ad' };
const users = {
  'seller@x.com': { id: ids.seller, pw: 'password1', profile: { id: ids.seller, email: 'seller@x.com', company: '가나 샵', name: '김', phone: '', role: 'seller', status: 'approved', created_at: '2026-09-01T00:00:00Z' } },
  'admin@x.com': { id: ids.admin, pw: 'adminpass1', profile: { id: ids.admin, email: 'admin@x.com', company: '밤낮', name: '관리', phone: '', role: 'admin', status: 'approved', created_at: '2026-08-01T00:00:00Z' } },
};
const norm = v => String(v || '').replace(/\s/g, '').toLowerCase();
const itemKey = p => [p.company, p.wholesale_company, p.wholesale_product, p.color, p.size].map(norm).join('|');
let nextId = 1, nextLog = 1, codeSeq = 0;
const now = () => new Date().toISOString();
function newProduct(r, who) {
  return { id: nextId++, code: 'P' + String(++codeSeq).padStart(6, '0'), company: '', wholesale_company: '', wholesale_product: '', color: '', size: '', mall_names: [], photo_url: '', memo: '', delete_requested_at: null, delete_request_reason: '', delete_requested_by: null, deleted_at: null, created_at: now(), created_by: who, updated_at: now(), updated_by: who, ...r };
}
const tables = {
  orders: [], couriers: [], address_book: [], pickup_requests: [], settlements: [], settle_contacts: [], stock_items: [],
  products: [
    newProduct({ company: '가나샵', wholesale_company: '도매A', wholesale_product: '꽃니트', color: '검정', size: 'F', mall_names: [{ platform: '스마트스토어', name: '플라워 니트' }] }, ids.admin),
    newProduct({ company: '다라상회', wholesale_company: '도매B', wholesale_product: '목걸이', color: '', size: '' }, ids.admin),
  ],
  product_logs: [],
};
const uploads = [];
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
  }
  return rows;
}
// products.sql 의 트리거(products_guard / products_log) 흉내
function log(p, action, before, who) {
  tables.product_logs.push({ id: nextLog++, product_id: p.id, code: p.code, company: p.company, action, before, after: { ...p }, actor: who.id, actor_name: who.profile.name || who.profile.company, at: now() });
}

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });

(async () => {
  const photoFile = path.join(__dirname, 'out', 'photo.png'); fs.writeFileSync(photoFile, PNG);
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
    const isAdmin = who && who.profile.role === 'admin';

    if (url.pathname === '/auth/v1/token') {
      const u = users[body.email];
      if (!u || u.pw !== body.password) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
      return json(200, { access_token: tokenFor(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: userObj(u) });
    }
    if (url.pathname === '/auth/v1/user') return who ? json(200, userObj(who)) : json(401, { msg: 'no' });
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname.startsWith('/storage/v1/object/product-photos/')) {
      if (!who) return json(403, { message: 'no' });
      uploads.push({ path: url.pathname.replace('/storage/v1/object/product-photos/', ''), type: headers['content-type'] });
      return json(200, { Key: url.pathname.replace('/storage/v1/object/', '') });
    }
    if (url.pathname === '/rest/v1/profiles') {
      let rows = Object.values(users).map(u => u.profile).filter(p => isAdmin || (who && p.id === who.id));
      rows = applyFilters(rows, url);
      if ((headers['accept'] || '').includes('vnd.pgrst.object')) return rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' });
      return json(200, rows);
    }
    if (url.pathname === '/rest/v1/products') {
      const mine = r => who && who.profile.status === 'approved' && norm(r.company) === norm(who.profile.company);
      const visible = tables.products.filter(r => isAdmin || mine(r));
      if (method === 'GET') return json(200, applyFilters(visible, url));
      if (method === 'DELETE') return json(403, { code: '42501', message: 'permission denied' });
      if (method === 'POST') {
        const list = Array.isArray(body) ? body : [body];
        const made = [];
        for (const r of list) {
          const row = { ...r };
          if (!isAdmin) { row.company = who.profile.company; delete row.deleted_at; delete row.delete_requested_at; }
          if (tables.products.some(p => !p.deleted_at && itemKey(p) === itemKey(row))) return json(409, { code: '23505', message: 'duplicate key' });
          made.push(newProduct(row, who.id));
        }
        made.forEach(p => { tables.products.push(p); log(p, '등록', null, who); });
        return json(201, made);
      }
      if (method === 'PATCH') {
        const hit = applyFilters(visible, url).filter(r => isAdmin || !r.deleted_at);
        for (const p of hit) {
          const before = { ...p };
          const patch = { ...body };
          delete patch.code;
          if (!isAdmin) { delete patch.company; delete patch.deleted_at; }
          Object.assign(p, patch, { updated_at: now(), updated_by: who.id });
          const action = p.deleted_at && !before.deleted_at ? '삭제' : p.delete_requested_at && !before.delete_requested_at ? '삭제요청'
            : !p.delete_requested_at && before.delete_requested_at ? '삭제요청취소' : '수정';
          log(p, action, before, who);
        }
        return json(200, hit);
      }
    }
    if (url.pathname === '/rest/v1/product_logs') {
      const rows = tables.product_logs.filter(l => isAdmin || (who && norm(l.company) === norm(who.profile.company)));
      return json(200, applyFilters(rows, url).sort((a, b) => b.id - a.id));
    }
    const table = url.pathname.replace('/rest/v1/', '');
    if (tables[table] && method === 'GET') return json(200, applyFilters(tables[table], url));
    return json(404, { message: 'unmocked ' + url.pathname });
  });

  const page = await context.newPage();
  const pageErrors = [];
  const watch = p => {
    p.on('pageerror', e => { pageErrors.push(e.message); console.log('PAGE ERROR:', e.message); });
    p.on('dialog', async d => { dialogs.push(d.message()); if (d.type() === 'prompt') await d.accept(promptAnswer); else await d.accept(); });
  };
  watch(page);
  const lastDialog = () => dialogs[dialogs.length - 1] || '';
  const results = [];
  const check = (name, cond, extra = '') => { const l = `${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`; results.push(l); console.log(l); };
  const byProd = n => tables.products.find(p => p.wholesale_product === n) || {};

  // ---------- 1. 관리자: 주문접수 화면의 [상품관리] 탭 ----------
  await page.goto(INDEX); await page.waitForTimeout(800);
  check('login screen shown', await page.isVisible('#login-form'));
  await page.click('#tab-btn-admin');
  await page.fill('#login-email', 'admin@x.com'); await page.fill('#login-pw', 'adminpass1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  check('admin dashboard shown', await page.isVisible('#admin-dashboard'));
  await page.click('#admin-tab-products'); await page.waitForTimeout(2000);
  const frame = page.frame({ url: /products\.html\?embed=1/ });
  check('products tab loads products.html in frame', !!frame && await page.isVisible('#admin-products-panel'));
  if (frame) {
    check('embedded page hides its own header', !(await frame.isVisible('#page-header')));
    const t = await frame.textContent('#list');
    check('admin frame lists all companies', t.includes('꽃니트') && t.includes('목걸이') && t.includes('다라상회'), t.slice(0, 200));
  }
  await page.click('#admin-tab-orders');
  await page.click('#admin-tab-products'); await page.waitForTimeout(300);
  check('frame not reloaded on reopen', page.frames().filter(f => /products\.html/.test(f.url())).length === 1);

  // ---------- 2. 관리자: products.html 단독 화면 ----------
  await page.goto(PRODUCTS); await page.waitForTimeout(1500);
  check('admin page header + company filter', (await page.isVisible('#page-header')) && (await page.isVisible('#f-company')));

  // 새 상품 등록 (사진 포함, 플랫폼 2개)
  await page.click('button:has-text("+ 상품 등록")'); await page.waitForTimeout(300);
  check('edit modal open', await page.isVisible('#edit-modal'));
  await page.fill('#e-company', '가나샵');
  await page.fill('#e-wholesale_company', '도매C'); await page.fill('#e-wholesale_product', '청바지');
  await page.fill('#e-color', '블루'); await page.fill('#e-size', 'S');
  await page.fill('#e-names .name-row:nth-child(1) .n-platform', '스마트스토어');
  await page.fill('#e-names .name-row:nth-child(1) .n-name', '와이드 데님');
  await page.click('button:has-text("+ 줄 추가")');
  await page.fill('#e-names .name-row:nth-child(2) .n-platform', '지그재그');
  await page.fill('#e-names .name-row:nth-child(2) .n-name', '[당일] 데님');
  await page.setInputFiles('#e-photo', photoFile); await page.waitForTimeout(500);
  check('photo preview shown', await page.isVisible('#e-photo-img'));
  await page.click('#e-save'); await page.waitForTimeout(1000);
  const jean = byProd('청바지');
  check('product created with code + 2 mall names', /^P\d{6}$/.test(jean.code || '') && jean.mall_names?.length === 2 && jean.company === '가나샵', JSON.stringify(jean));
  check('photo uploaded (.jpg) and url saved', uploads.length === 1 && /image\/jpeg|multipart/.test(uploads[0].type) && uploads[0].path.endsWith('.jpg') && jean.photo_url.includes('/product-photos/') && !/[가-힣]/.test(uploads[0].path), JSON.stringify(uploads));
  check('new product appears in list', (await page.textContent('#list')).includes('와이드 데님'));

  // 중복 등록 막기
  await page.click('button:has-text("+ 상품 등록")'); await page.waitForTimeout(300);
  await page.fill('#e-company', '가나 샵');
  await page.fill('#e-wholesale_company', '도매C'); await page.fill('#e-wholesale_product', '청바지');
  await page.fill('#e-color', '블루'); await page.fill('#e-size', 'S');
  await page.click('#e-save'); await page.waitForTimeout(800);
  check('duplicate blocked with friendly message', lastDialog().includes('이미 같은 상품'), lastDialog());
  await page.click('#edit-modal button:has-text("취소")');

  // 수정 → 기록
  await page.locator('#list tr', { hasText: '와이드 데님' }).locator('button', { hasText: '수정' }).click(); await page.waitForTimeout(300);
  check('edit modal shows code', (await page.textContent('#edit-code')).includes(jean.code));
  await page.fill('#e-memo', '시즌 상품');
  await page.click('#e-save'); await page.waitForTimeout(800);
  check('edit saved', byProd('청바지').memo === '시즌 상품');
  await page.locator('#list tr', { hasText: '와이드 데님' }).locator('button', { hasText: '기록' }).click(); await page.waitForTimeout(600);
  const logText = await page.textContent('#log-list');
  check('history shows 등록 + 수정 with field diff', logText.includes('등록') && logText.includes('수정') && logText.includes('메모') && logText.includes('시즌 상품'), logText);
  await page.click('#log-modal button:has-text("×")');

  // 검색 + 거래처 필터
  await page.fill('#f-keyword', '플라워'); await page.waitForTimeout(200);
  check('search by mall name', (await page.locator('#list tr').count()) === 1 && (await page.textContent('#list')).includes('꽃니트'));
  await page.fill('#f-keyword', ''); await page.selectOption('#f-company', norm('다라상회')); await page.waitForTimeout(200);
  check('company filter', (await page.textContent('#list')).includes('목걸이') && !(await page.textContent('#list')).includes('꽃니트'));
  await page.selectOption('#f-company', '');

  // 등록 양식 받기 → 채워서 올리기 (새 상품 2줄을 하나로 합침 + 기존 상품코드에 이름 추가 + 잘못된 줄)
  const [fdl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("등록 양식 받기")')]);
  const formPath = path.join(__dirname, 'out', 'products-form.xlsx'); await fdl.saveAs(formPath);
  const fwb = XLSX.readFile(formPath);
  const head = XLSX.utils.sheet_to_json(fwb.Sheets['상품등록'], { header: 1 })[0];
  check('form has admin columns + 작성방법 sheet', head.join() === '거래처명,상품코드,도매업체명,도매상품명,컬러,사이즈,플랫폼,쇼핑몰상품명,메모' && fwb.SheetNames.includes('작성방법'), head.join());
  const flower = byProd('꽃니트');
  const upPath = path.join(__dirname, 'out', 'products-upload.xlsx');
  const uwb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(uwb, XLSX.utils.aoa_to_sheet([head,
    ['사아샵', '', '도매S', '114', '검정', 'F', '스마트스토어', '코지 가디건', ''],
    ['사아샵', '', '도매S', '114', '검정', 'F', '지그재그', '[당일] 코지', ''],
    ['', flower.code, '', '', '', '', '쿠팡', '플라워 니트 쿠팡', ''],
    ['', flower.code, '', '', '', '', '스마트스토어', '플라워 니트', ''],
    ['', 'P999999', '', '', '', '', '쿠팡', '없는코드', ''],
    ['', '', '도매X', '이름만', '', '', '', '', ''],
  ]), '상품등록');
  XLSX.writeFile(uwb, upPath);
  await page.setInputFiles('#upload-input', upPath); await page.waitForTimeout(800);
  const info = await page.textContent('#upload-info');
  check('upload preview counts (new 1, add 1, skipped 2)', info.includes('새 상품 1개') && info.includes('쇼핑몰상품명 추가 1개') && info.includes('건너뜀 2줄'), info);
  await page.click('#upload-confirm'); await page.waitForTimeout(1200);
  const cozy = byProd('114');
  check('excel rows merged into one product with 2 names', cozy.company === '사아샵' && cozy.mall_names?.length === 2, JSON.stringify(cozy));
  check('existing product got only the new mall name', byProd('꽃니트').mall_names.length === 2 && byProd('꽃니트').mall_names[1].platform === '쿠팡', JSON.stringify(byProd('꽃니트').mall_names));

  // 목록 다운로드: 플랫폼마다 한 줄
  const [ldl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("엑셀 다운로드")')]);
  const listPath = path.join(__dirname, 'out', 'products-list.xlsx'); await ldl.saveAs(listPath);
  const lrows = XLSX.utils.sheet_to_json(XLSX.readFile(listPath).Sheets['상품등록'], { header: 1 });
  check('list download: one row per platform name', lrows.filter(r => r[3] === '꽃니트').length === 2 && lrows.filter(r => r[3] === '청바지').length === 2, JSON.stringify(lrows.slice(0, 4)));
  await page.screenshot({ path: path.join(__dirname, 'out', 'shot-products-admin.png'), fullPage: true });

  // ---------- 3. 셀러: [상품관리] 버튼 → 자기 상품만, 삭제는 요청만 ----------
  await page.goto(INDEX); await page.waitForTimeout(800);
  await page.evaluate(() => logout()); await page.waitForTimeout(800);
  await page.click('#tab-btn-seller');
  await page.fill('#login-email', 'seller@x.com'); await page.fill('#login-pw', 'password1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  check('seller dashboard shown (order screen still works)', await page.isVisible('#seller-dashboard'));
  check('seller sees 상품관리 button', await page.isVisible('#nav-products-btn'));
  await page.goto(PRODUCTS); await page.waitForTimeout(1500);
  const sText = await page.textContent('#list');
  check('seller sees only own company', sText.includes('꽃니트') && sText.includes('청바지') && !sText.includes('목걸이') && !sText.includes('114'), sText.slice(0, 200));
  check('seller has no company filter / column', !(await page.isVisible('#f-company')) && !(await page.innerText('thead')).includes('거래처명'));

  // 셀러 등록 (회사는 서버가 정함)
  await page.click('button:has-text("+ 상품 등록")'); await page.waitForTimeout(300);
  check('seller modal has no company input', !(await page.isVisible('#e-company')));
  await page.fill('#e-wholesale_company', '도매D'); await page.fill('#e-wholesale_product', '셀러상품');
  await page.fill('#e-names .name-row:nth-child(1) .n-name', '셀러 상품명');
  await page.click('#e-save'); await page.waitForTimeout(800);
  check('seller registered product under own company', byProd('셀러상품').company === '가나 샵' && byProd('셀러상품').created_by === ids.seller, JSON.stringify(byProd('셀러상품')));

  // 삭제 요청
  await page.locator('#list tr', { hasText: '셀러 상품명' }).locator('button', { hasText: '수정' }).click(); await page.waitForTimeout(300);
  check('seller sees 삭제 요청 (not 삭제)', (await page.isVisible('#e-request')) && !(await page.isVisible('#e-delete')));
  promptAnswer = '판매 종료';
  await page.click('#e-request'); await page.waitForTimeout(800);
  check('delete request saved with reason', !!byProd('셀러상품').delete_requested_at && byProd('셀러상품').delete_request_reason === '판매 종료' && !byProd('셀러상품').deleted_at);
  check('request badge shown', (await page.textContent('#request-badge')).includes('1건'));
  await page.screenshot({ path: path.join(__dirname, 'out', 'shot-products-seller.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(__dirname, 'out', 'shot-products-seller-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1400, height: 900 });

  // ---------- 4. 관리자: 삭제 요청 승인 / 거절 ----------
  // 다른 요청 하나 더 (꽃니트) → 거절할 것
  byProd('꽃니트').delete_requested_at = now(); byProd('꽃니트').delete_request_reason = '실수';
  await page.goto(INDEX); await page.waitForTimeout(800);
  await page.evaluate(() => logout()); await page.waitForTimeout(800);
  await page.click('#tab-btn-admin');
  await page.fill('#login-email', 'admin@x.com'); await page.fill('#login-pw', 'adminpass1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  await page.goto(PRODUCTS); await page.waitForTimeout(1500);
  check('admin sees 삭제 요청 2건 badge', (await page.textContent('#request-badge')).includes('2건'));
  await page.click('#request-badge'); await page.waitForTimeout(200);
  check('badge filters to requested', (await page.locator('#list tr').count()) === 2);
  await page.locator('#list tr', { hasText: '셀러 상품명' }).locator('button', { hasText: '삭제 승인' }).click(); await page.waitForTimeout(800);
  check('approve -> deleted_at set (row kept)', !!byProd('셀러상품').deleted_at && tables.products.includes(byProd('셀러상품')));
  await page.locator('#list tr', { hasText: '꽃니트' }).locator('button', { hasText: '거절' }).click(); await page.waitForTimeout(800);
  check('reject -> request cleared', !byProd('꽃니트').delete_requested_at && !byProd('꽃니트').deleted_at);
  await page.selectOption('#f-status', 'deleted'); await page.waitForTimeout(200);
  check('삭제됨 filter shows deleted product', (await page.textContent('#list')).includes('셀러 상품명'));
  check('no DELETE request was ever sent', !requests.some(r => r.method === 'DELETE'));
  check('logs recorded for each step', ['등록', '수정', '삭제요청', '삭제', '삭제요청취소'].every(a => tables.product_logs.some(l => l.action === a)), tables.product_logs.map(l => l.action).join());

  check('no page script errors', pageErrors.length === 0, pageErrors.join(' | '));
  const fails = results.filter(r => r.startsWith('FAIL'));
  console.log(`\nRESULT: ${results.length - fails.length}/${results.length} passed`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
