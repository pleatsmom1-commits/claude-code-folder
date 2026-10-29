// 새 재고표 (inventory.html + 관리자 [새 재고표] 탭) E2E
// 실제 Supabase 대신 메모리 속 가짜 서버를 씁니다. 사용: cd tests && npm install && node e2e-inventory.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx-js-style');

const NM = path.join(__dirname, 'node_modules');
const ROOT = path.join(__dirname, '..');
const INDEX = 'file://' + path.join(ROOT, 'index.html') + '?test';
const PAGE = 'file://' + path.join(ROOT, 'inventory.html');
const LIB = {
  'cdn.tailwindcss.com': '@tailwindcss/browser/dist/index.global.js',
  'xlsx-js-style': 'xlsx-js-style/dist/xlsx.bundle.js',
  'jszip': 'jszip/dist/jszip.min.js',
  'lucide': 'lucide/dist/umd/lucide.min.js',
  'supabase-js': '@supabase/supabase-js/dist/umd/supabase.js',
};

const ids = { seller: '00000000-0000-0000-0000-00000000000a', admin: '00000000-0000-0000-0000-0000000000ad' };
const users = {
  'seller@x.com': { id: ids.seller, pw: 'password1', profile: { id: ids.seller, email: 'seller@x.com', company: '가나 샵', name: '김', phone: '', role: 'seller', status: 'approved', created_at: '2026-09-01T00:00:00Z' } },
  'admin@x.com': { id: ids.admin, pw: 'adminpass1', profile: { id: ids.admin, email: 'admin@x.com', company: '밤낮', name: '관리', phone: '', role: 'admin', status: 'approved', created_at: '2026-08-01T00:00:00Z' } },
};
const norm = v => String(v || '').replace(/\s/g, '').toLowerCase();
const itemKey = p => [p.company, p.wholesale_company, p.wholesale_product, p.color, p.size].map(norm).join('|');
const now = () => new Date().toISOString();
let nextId = 1, codeSeq = 0, nextMove = 1;
function newProduct(r) {
  return { id: nextId++, code: 'P' + String(++codeSeq).padStart(6, '0'), company: '', wholesale_company: '', wholesale_product: '', color: '', size: '', mall_names: [], photo_url: '', memo: '', delete_requested_at: null, delete_request_reason: '', deleted_at: null, created_at: now(), ...r };
}
const tables = {
  orders: [], couriers: [], address_book: [], pickup_requests: [], settlements: [], settle_contacts: [],
  products: [
    newProduct({ company: '가나샵', wholesale_company: '도매A', wholesale_product: '꽃니트', color: '검정', size: 'F', mall_names: [{ platform: '스마트스토어', name: '플라워 니트' }] }),
    newProduct({ company: '다라상회', wholesale_company: '도매B', wholesale_product: '목걸이' }),
  ],
  inventory: [], inventory_moves: [],
  // 예전 재고표: 보관중 2줄(라벨 o / 없음, 같은 상품) + 출고된 1줄 + 불량 메모
  stock_items: [
    { id: 1, company: '가나샵', wholesale_company: '도매A', wholesale_product: '꽃니트', retail_product: '플라워 니트', color: '검정', size: 'F', quantity: 2, location: 'G-1', label: 'o', memo: '', shipped_on: null, shipped_note: '' },
    { id: 2, company: '가나샵', wholesale_company: '도매A', wholesale_product: '꽃니트', retail_product: '', color: '검정', size: 'F', quantity: 1, location: 'G-2', label: '', memo: '', shipped_on: null, shipped_note: '' },
    { id: 3, company: '가나샵', wholesale_company: '도매Z', wholesale_product: '청바지', retail_product: '와이드 데님', color: '', size: 'S', quantity: 3, location: 'H-1', label: '', memo: '불량 1개', shipped_on: null, shipped_note: '' },
    { id: 4, company: '가나샵', wholesale_company: '도매Y', wholesale_product: '나간상품', retail_product: '', color: '', size: '', quantity: 1, location: '', label: '', memo: '', shipped_on: '2026-10-01', shipped_note: '' },
  ],
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
    else if (v === 'is.null') rows = rows.filter(r => r[k] == null);
  }
  return rows;
}
// inventory.sql 의 함수 흉내
function invRow(p) {
  let r = tables.inventory.find(x => x.product_id === p.id);
  if (!r) { r = { product_id: p.id, company: p.company, qty_a: 0, qty_b: 0, qty_defect: 0, location: '', memo: '' }; tables.inventory.push(r); }
  return r;
}
function logMove(p, kind, da, db, dd, r, reason) {
  tables.inventory_moves.push({ id: nextMove++, product_id: p.id, company: p.company, code: p.code, kind, d_a: da, d_b: db, d_defect: dd, a_after: r.qty_a, b_after: r.qty_b, defect_after: r.qty_defect, reason, actor_name: '관리', at: now() });
}
function rpcMove(b) {
  const p = tables.products.find(x => x.id === b.p_product_id && !x.deleted_at);
  if (!p) return [400, { message: '상품을 찾을 수 없습니다.' }];
  const r = invRow(p);
  const a = r.qty_a + b.p_da, bb = r.qty_b + b.p_db, d = r.qty_defect + b.p_dd;
  if (a < 0 || bb < 0 || d < 0) return [400, { code: '23514', message: `재고가 모자랍니다. (${p.code})` }];
  Object.assign(r, { qty_a: a, qty_b: bb, qty_defect: d });
  if (b.p_location != null) r.location = b.p_location;
  if (b.p_da || b.p_db || b.p_dd) logMove(p, b.p_kind, b.p_da, b.p_db, b.p_dd, r, b.p_reason || '');
  return [200, r];
}
function rpcImport(b) {
  const seen = [];
  let count = 0;
  for (const it of b.p_items) {
    const p = tables.products.find(x => x.id === it.product_id);
    if (!p || norm(p.company) !== norm(b.p_company)) return [400, { message: '거래처 상품이 아닙니다.' }];
    seen.push(p.id);
    const old = tables.inventory.find(x => x.product_id === p.id);
    if (!old && !it.a && !it.b && !it.defect) continue;
    const r = invRow(p);
    const da = it.a - r.qty_a, db = it.b - r.qty_b, dd = it.defect - r.qty_defect;
    Object.assign(r, { qty_a: it.a, qty_b: it.b, qty_defect: it.defect, location: it.location || '', memo: it.memo || '' });
    logMove(p, '최종재고', da, db, dd, r, b.p_reason);
    count++;
  }
  tables.inventory.filter(r => norm(r.company) === norm(b.p_company) && !seen.includes(r.product_id) && (r.qty_a || r.qty_b || r.qty_defect)).forEach(r => {
    const p = tables.products.find(x => x.id === r.product_id);
    const da = -r.qty_a, db = -r.qty_b, dd = -r.qty_defect;
    Object.assign(r, { qty_a: 0, qty_b: 0, qty_defect: 0 });
    logMove(p, '최종재고', da, db, dd, r, b.p_reason + ' (파일에 없음)');
  });
  return [200, count];
}

fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });

(async () => {
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
    requests.push({ method, path: url.pathname, body });
    const json = (status, data) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const who = whoFrom(headers);
    const isAdmin = who && who.profile.role === 'admin';
    const wantsObject = (headers['accept'] || '').includes('vnd.pgrst.object');
    const mine = r => who && who.profile.status === 'approved' && norm(r.company) === norm(who.profile.company);

    if (url.pathname === '/auth/v1/token') {
      const u = users[body.email];
      if (!u || u.pw !== body.password) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
      return json(200, { access_token: tokenFor(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: userObj(u) });
    }
    if (url.pathname === '/auth/v1/user') return who ? json(200, userObj(who)) : json(401, { msg: 'no' });
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/rest/v1/profiles') {
      let rows = applyFilters(Object.values(users).map(u => u.profile).filter(p => isAdmin || (who && p.id === who.id)), url);
      if (wantsObject) return rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' });
      return json(200, rows);
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      if (!isAdmin) return json(403, { code: '42501', message: '관리자만' });
      const [st, data] = url.pathname.endsWith('inventory_move') ? rpcMove(body) : rpcImport(body);
      return json(st, data);
    }
    if (url.pathname === '/rest/v1/products') {
      const visible = tables.products.filter(r => isAdmin || mine(r));
      if (method === 'GET') return json(200, applyFilters(visible, url));
      if (method === 'POST') {
        const list = (Array.isArray(body) ? body : [body]).map(r => (isAdmin ? r : { ...r, company: who.profile.company }));
        if (list.some(r => tables.products.some(p => !p.deleted_at && itemKey(p) === itemKey(r)))) return json(409, { code: '23505', message: 'dup' });
        const made = list.map(newProduct);
        tables.products.push(...made);
        return json(201, wantsObject ? made[0] : made);
      }
    }
    if (['inventory', 'inventory_moves', 'stock_items'].includes(url.pathname.replace('/rest/v1/', ''))) {
      const t = url.pathname.replace('/rest/v1/', '');
      if (method !== 'GET') return json(403, { code: '42501', message: 'permission denied' });
      const rows = applyFilters(tables[t].filter(r => isAdmin || (t !== 'stock_items' && mine(r))), url);
      return json(200, t === 'inventory_moves' ? rows.sort((a, b) => b.id - a.id) : rows);
    }
    const table = url.pathname.replace('/rest/v1/', '');
    if (tables[table] && method === 'GET') return json(200, applyFilters(tables[table], url));
    return json(404, { message: 'unmocked ' + url.pathname });
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => { pageErrors.push(e.message); console.log('PAGE ERROR:', e.message); });
  page.on('dialog', async d => { dialogs.push(d.message()); if (d.type() === 'prompt') await d.accept(promptAnswer); else await d.accept(); });
  const lastDialog = () => dialogs[dialogs.length - 1] || '';
  const results = [];
  const check = (name, cond, extra = '') => { const l = `${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`; results.push(l); console.log(l); };
  const prod = n => tables.products.find(p => p.wholesale_product === n) || {};
  const qty = n => tables.inventory.find(r => r.product_id === prod(n).id) || {};
  const row = text => page.locator('#list tr', { hasText: text });

  // ---------- 1. 관리자 탭 ----------
  await page.goto(INDEX); await page.waitForTimeout(800);
  await page.click('#tab-btn-admin');
  await page.fill('#login-email', 'admin@x.com'); await page.fill('#login-pw', 'adminpass1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  check('admin dashboard + order list', await page.isVisible('#admin-dashboard'));
  await page.click('#admin-tab-inventory'); await page.waitForTimeout(2000);
  const frame = page.frame({ url: /inventory\.html\?embed=1/ });
  check('새 재고표 tab loads inventory.html in frame', !!frame && (await frame.textContent('#list')).includes('아직 재고가 없습니다'));
  await page.click('#admin-tab-products'); await page.waitForTimeout(1500);
  check('상품관리 tab still works', !!page.frame({ url: /products\.html\?embed=1/ }));

  // ---------- 2. 최종재고 양식 받기 (예전 재고표로 채움) ----------
  await page.goto(PAGE); await page.waitForTimeout(1500);
  const [tdl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("최종재고 양식 받기")')]);
  const tplPath = path.join(__dirname, 'out', 'inv-template.xlsx'); await tdl.saveAs(tplPath);
  const twb = XLSX.readFile(tplPath);
  const trows = XLSX.utils.sheet_to_json(twb.Sheets['최종재고'], { header: 1 });
  check('template header', trows[0].slice(0, 12).join() === '거래처명,상품코드,도매업체명,도매상품명,컬러,사이즈,쇼핑몰상품명,상품화수량,미상품화수량,불량수량,재고위치,메모', trows[0].join());
  const tFlower = trows.find(r => r[3] === '꽃니트') || [];
  check('old stock merged into existing product (label o -> 상품화 2, none -> 미상품화 1, both locations)', tFlower[1] === prod('꽃니트').code && tFlower[7] === 2 && tFlower[8] === 1 && tFlower[10] === 'G-1, G-2', JSON.stringify(tFlower));
  const tJean = trows.find(r => r[3] === '청바지') || [];
  check('old-only item listed without code, 불량 from memo', !tJean[1] && tJean[6] === '와이드 데님' && tJean[8] === 3 && tJean[9] === 1, JSON.stringify(tJean));
  check('shipped old row not in template', !trows.some(r => r[3] === '나간상품'));
  check('product with no stock (목걸이) included with 0', trows.some(r => r[3] === '목걸이' && r[7] === 0 && r[8] === 0));
  check('작성방법 sheet', twb.SheetNames.includes('작성방법'));

  // ---------- 3. 최종재고 올리기 ----------
  const up = [trows[0],
    ['가나샵', prod('꽃니트').code, '도매A', '꽃니트', '검정', 'F', '', 2, 1, 0, 'G-1', ''],
    ['가나샵', '', '도매Z', '청바지', '', 'S', '와이드 데님', 0, 3, 1, 'H-1', ''],
    ['가나샵', '', '도매Z', '청바지', '', 'S', '', 0, 2, 0, 'H-2', ''],        // 같은 상품 줄 → 합침
    ['가나샵', '', '도매W', '0개상품', '', '', '', 0, 0, 0, '', ''],          // 0 → 상품만 등록
    ['다라상회', prod('목걸이').code, '', '', '', '', '', 0, 0, 0, '', ''],
    ['', '', '도매Q', '거래처없음', '', '', '', 1, 0, 0, '', ''],
    ['가나샵', 'P999999', '', '', '', '', '', 1, 0, 0, '', ''],
  ];
  const upPath = path.join(__dirname, 'out', 'inv-upload.xlsx');
  const uwb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(uwb, XLSX.utils.aoa_to_sheet(up), '최종재고'); XLSX.writeFile(uwb, upPath);
  await page.setInputFiles('#upload-input', upPath); await page.waitForTimeout(800);
  const info = await page.textContent('#upload-info');
  check('upload preview: 2 companies, 4 products, 2 new, 2 skipped', info.includes('거래처 2곳') && info.includes('상품 4개') && info.includes('새로 등록 2개') && info.includes('건너뜀 2줄'), info);
  await page.click('#upload-confirm'); await page.waitForTimeout(1500);
  check('upload done alert', lastDialog().includes('거래처 2곳') && lastDialog().includes('새로 등록한 상품 2개'), lastDialog());
  check('quantities set (꽃니트 2/1, 청바지 0/5/1 merged)', qty('꽃니트').qty_a === 2 && qty('꽃니트').qty_b === 1 && qty('청바지').qty_b === 5 && qty('청바지').qty_defect === 1 && qty('청바지').location === 'H-1, H-2', JSON.stringify(tables.inventory));
  check('new products registered in 상품관리 with mall name', prod('청바지').code && prod('청바지').mall_names[0]?.name === '와이드 데님' && prod('0개상품').code);
  check('zero row: product but no inventory row', !tables.inventory.some(r => r.product_id === prod('0개상품').id) && !tables.inventory.some(r => r.product_id === prod('목걸이').id));
  let listText = await page.textContent('#list');
  check('list shows stock rows only by default', listText.includes('꽃니트') && listText.includes('청바지') && !listText.includes('0개상품'));

  // ---------- 4. [-][+] 조정 + 이유 ----------
  await row('꽃니트').locator('td').nth(8).locator('button', { hasText: '+' }).click();   // 상품화 +1
  await row('꽃니트').locator('td').nth(8).locator('button', { hasText: '+' }).click();   // +1
  await row('청바지').locator('td').nth(9).locator('button', { hasText: '−' }).click();  // 미상품화 -1
  check('save bar shows 2 changed', (await page.isVisible('#save-bar')) && (await page.textContent('#save-info')).includes('2개'));
  await page.click('#save-btn'); await page.waitForTimeout(400);
  check('reason required', lastDialog().includes('이유를 적어주세요') && qty('꽃니트').qty_a === 2, lastDialog());
  await row('꽃니트').locator('.reason-input').fill('재고 다시 셈');
  await page.fill('#save-reason', '실사');
  await page.click('#save-btn'); await page.waitForTimeout(1000);
  check('adjust saved (꽃니트 상품화 4, 청바지 미상품화 4)', qty('꽃니트').qty_a === 4 && qty('청바지').qty_b === 4, JSON.stringify(tables.inventory));
  const adj = tables.inventory_moves.filter(m => m.kind === '조정');
  check('adjust logs with row reason / common reason', adj.some(m => m.reason === '재고 다시 셈' && m.d_a === 2) && adj.some(m => m.reason === '실사' && m.d_b === -1), JSON.stringify(adj));
  check('save bar hidden after save', !(await page.isVisible('#save-bar')));

  // ---------- 5. 라벨완료 ----------
  promptAnswer = '1';
  await row('꽃니트').locator('button', { hasText: '라벨완료' }).click(); await page.waitForTimeout(800);
  check('label done moves 1 B -> A', qty('꽃니트').qty_a === 5 && qty('꽃니트').qty_b === 0);
  await row('청바지').locator('.row-check').check();
  await page.click('button:has-text("선택 라벨완료")'); await page.waitForTimeout(1000);
  check('bulk label done moves all B -> A', qty('청바지').qty_a === 4 && qty('청바지').qty_b === 0 && qty('청바지').qty_defect === 1);

  // ---------- 6. 입고 (자동 채움 / 새 상품) ----------
  await page.click('button:has-text("+ 입고")'); await page.waitForTimeout(300);
  await page.fill('#i-name', '플라워'); await page.waitForTimeout(200);
  check('suggestion by mall name', (await page.textContent('#i-suggest')).includes('꽃니트'));
  await page.locator('#i-suggest button', { hasText: '꽃니트' }).click(); await page.waitForTimeout(200);
  check('pick fills wholesale fields', (await page.inputValue('#i-wholesale_company')) === '도매A' && (await page.inputValue('#i-wholesale_product')) === '꽃니트' && (await page.inputValue('#i-color')) === '검정');
  await page.fill('#i-qty', '3'); await page.fill('#i-reason', '반품 입고');
  await page.click('#i-save'); await page.waitForTimeout(1000);
  check('intake adds to 미상품화', qty('꽃니트').qty_b === 3 && tables.inventory_moves.some(m => m.kind === '입고' && m.reason === '반품 입고' && m.d_b === 3));
  await page.click('button:has-text("+ 입고")'); await page.waitForTimeout(300);
  await page.fill('#i-company', '가나샵'); await page.fill('#i-wholesale_company', '도매N'); await page.fill('#i-wholesale_product', '새가디건');
  await page.fill('#i-name', '코지 가디건'); await page.selectOption('#i-where', 'a'); await page.fill('#i-qty', '2');
  await page.waitForTimeout(200);
  check('no match -> hint to register new', (await page.textContent('#i-suggest')).includes('새로 등록'));
  await page.click('#i-save'); await page.waitForTimeout(1200);
  check('new product registered + intake to 상품화', prod('새가디건').code && prod('새가디건').mall_names[0]?.name === '코지 가디건' && qty('새가디건').qty_a === 2, JSON.stringify(prod('새가디건')));

  // ---------- 7. 기록 · 다운로드 ----------
  await row('꽃니트').locator('button', { hasText: '기록' }).click(); await page.waitForTimeout(600);
  const logText = await page.textContent('#log-list');
  check('history lists 최종재고/조정/라벨완료/입고', ['최종재고', '조정', '라벨완료', '입고', '재고 다시 셈'].every(t => logText.includes(t)), logText.replace(/\s+/g, ' ').slice(0, 300));
  await page.click('#log-modal button:has-text("×")');
  const [ldl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("엑셀 다운로드")')]);
  const lPath = path.join(__dirname, 'out', 'inv-list.xlsx'); await ldl.saveAs(lPath);
  const lrows = XLSX.utils.sheet_to_json(XLSX.readFile(lPath).Sheets['재고'], { header: 1 });
  check('list download has quantities', lrows.some(r => r[3] === '꽃니트' && r[7] === 5 && r[8] === 3 && r[10] === 8), JSON.stringify(lrows.slice(0, 3)));
  await page.screenshot({ path: path.join(__dirname, 'out', 'shot-inventory-admin.png'), fullPage: true });
  // 조정 중 화면 (안내용 캡처)
  await row('꽃니트').locator('td').nth(8).locator('button', { hasText: '−' }).click();
  await page.screenshot({ path: path.join(__dirname, 'out', 'shot-inventory-adjust.png') });
  await page.click('button:has-text("되돌리기")');

  // 재고 다시 올리기: 파일에 없는 상품은 0
  const up2 = [trows[0], ['가나샵', prod('꽃니트').code, '', '', '', '', '', 1, 0, 0, '', '']];
  const up2Path = path.join(__dirname, 'out', 'inv-upload2.xlsx');
  const u2 = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(u2, XLSX.utils.aoa_to_sheet(up2), '최종재고'); XLSX.writeFile(u2, up2Path);
  await page.setInputFiles('#upload-input', up2Path); await page.waitForTimeout(800);
  const zeroCell = await page.locator('#upload-list tr td').nth(6).textContent();
  check('re-upload preview warns 2 items -> 0', zeroCell.trim() === '2', zeroCell);
  await page.click('#upload-confirm'); await page.waitForTimeout(1500);
  check('re-upload: 꽃니트 1, others of 가나샵 -> 0', qty('꽃니트').qty_a === 1 && qty('꽃니트').qty_b === 0 && qty('청바지').qty_a === 0 && qty('새가디건').qty_a === 0);

  // ---------- 8. 셀러: 보기만 ----------
  await page.goto(INDEX); await page.waitForTimeout(800);
  await page.evaluate(() => logout()); await page.waitForTimeout(800);
  await page.click('#tab-btn-seller');
  await page.fill('#login-email', 'seller@x.com'); await page.fill('#login-pw', 'password1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  check('seller dashboard (order screen) still works', await page.isVisible('#seller-dashboard'));
  await page.goto(PAGE); await page.waitForTimeout(1500);
  const sText = await page.textContent('#list');
  check('seller sees own stock only, read-only', sText.includes('꽃니트') && (await page.locator('#list .qty').count()) === 0 && !(await page.isVisible('button:has-text("+ 입고")')), sText.slice(0, 120));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(__dirname, 'out', 'shot-inventory-seller-mobile.png'), fullPage: true });

  check('no direct table writes', !requests.some(r => ['inventory', 'inventory_moves'].some(t => r.path === '/rest/v1/' + t) && r.method !== 'GET'));
  check('no page script errors', pageErrors.length === 0, pageErrors.join(' | '));
  const fails = results.filter(r => r.startsWith('FAIL'));
  console.log(`\nRESULT: ${results.length - fails.length}/${results.length} passed`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
