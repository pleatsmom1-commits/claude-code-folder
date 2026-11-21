// 택배 업체용 [내 택배 주문 목록에 넣기] + 내 택배 주문(my-ship.html) 운송장 양식·엑셀 확인용 E2E — e2e-buy-list.js 와 같은 가짜 서버
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
  'wait@x.com': { id: '00000000-0000-0000-0000-0000000000c1', pw: 'waitpass1', profile: { id: '00000000-0000-0000-0000-0000000000c1', email: 'wait@x.com', company: '대기샵', name: '이', phone: '010-3333-4444', role: 'seller', status: 'pending', created_at: '2026-10-28T00:00:00Z' } },
  'admin@x.com': { id: ids.admin, pw: 'adminpass1', profile: { id: ids.admin, email: 'admin@x.com', company: '밤낮', name: '관리', phone: '', role: 'admin', status: 'approved', created_at: '2026-08-01T00:00:00Z' } },
};
const tables = {
  orders: [
    { id: 'ORD-1', seller_id: ids.seller, seller_company: '애플샵', sender_name: '밤낮딜리버리(애플샵)', cs_phone: '010-1111-2222', recipient: '홍길동', phone: '010-2222-3333', address: '서울', product: '티셔츠', status: '접수대기', ship_status: '미출고', order_type: 'fulfillment', order_no: 1, item_no: 1, seller_order_no: 1, created_at: new Date(Date.now() - 86400000 * 10).toISOString() },
    { id: 'ORD-2', seller_id: ids.seller, seller_company: '애플샵', sender_name: '밤낮딜리버리(애플샵)', cs_phone: '010-7777-8888', recipient: '이영희', phone: '010-5555-6666', address: '부산', product: '가디건 / 아이보리', status: '접수대기', ship_status: '미출고', order_type: 'fulfillment', order_no: 2, item_no: 1, seller_order_no: 2, created_at: new Date(Date.now() - 86400000).toISOString() },
  ],
  products: [
    { id: 1, code: 'P000001', company: '애플샵', wholesale_company: '청평화A', wholesale_product: '울팬츠', color: '블랙', size: 'M', mall_names: [{ platform: '스마트스토어', name: '고랭 울 팬츠' }], deleted_at: null },
    { id: 2, code: 'P000002', company: '애플샵', wholesale_company: '청평화A', wholesale_product: '울팬츠', color: '화이트', size: 'M', mall_names: [{ platform: '스마트스토어', name: '고랭 울 팬츠' }], deleted_at: null },
  ],
  inventory: [{ product_id: 1, company: '애플샵', qty_a: 3 }],
  ai_chat_logs: [{ id: 1, created_at: new Date().toISOString(), chat_id: 'a', question: '카드로 결제할 수 있어요?', answer: '계좌이체만 됩니다.', needs_human: false, source: 'https://www.bamnatdelivery.com/', cost_usd: 0.02 }],
  ai_usage: [{ id: 1, created_at: new Date().toISOString(), user_id: ids.seller, company: '애플샵', kind: 'order_file', model: 'claude-opus-5-5', input_tokens: 1500, output_tokens: 200, cost_usd: 0.01, note: '스마트스토어.xlsx' }],
  order_file_formats: [{ id: 1, company: '애플샵', signature: '주문번호|수취인명|수취인연락처', platform: '스마트스토어', mapping: {}, use_count: 3, last_used_at: new Date().toISOString() }],
  couriers: [{ id: 'c1', name: '우체국택배', sort_order: 1 }],
  address_book: [], pickup_requests: [], settlements: [], settle_contacts: [],
  seller_own_stock: [{ product_id: 1, company: '애플샵', qty: 5, updated_at: new Date().toISOString() }], seller_own_stock_moves: [], seller_ship_orders: [], seller_ship_templates: [],
};
const requests = [];
const apiCalls = []; // 사이트 서버(/api/...)로 보낸 요청 (회원가입·승인 알림 문자)

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
    else if (v.startsWith('neq.')) rows = rows.filter(r => String(r[k]) !== decodeURIComponent(v.slice(4)));
    else if (v.startsWith('in.(')) { const list = v.slice(4, -1).split(',').map(x => x.replace(/^"|"$/g, '')); rows = rows.filter(r => list.includes(String(r[k]))); }
  }
  return rows;
}

fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
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
    if (url.pathname === '/rest/v1/rpc/ship_orders_purge') return json(200, 0);
    if (url.pathname === '/rest/v1/rpc/own_stock_apply') {
      let n = 0;
      for (const it of body.p_items) {
        let row = tables.seller_own_stock.find(r => r.product_id === it.product_id);
        const old = row ? row.qty : 0;
        const q = Math.max(0, body.p_mode === 'set' ? it.qty : old + it.change);
        if (!row) { row = { product_id: it.product_id, company: '애플샵', qty: 0 }; tables.seller_own_stock.push(row); }
        row.qty = q; row.updated_at = new Date().toISOString();
        if (q !== old) tables.seller_own_stock_moves.push({ product_id: it.product_id, change: q - old, qty_after: q, reason: body.p_reason, created_at: new Date().toISOString() });
        n++;
      }
      return json(200, n);
    }
    const table = url.pathname.replace('/rest/v1/', '');
    if (tables[table]) {
      const isAdmin = who && who.profile.role === 'admin';
      let rows = tables[table].filter(r => isAdmin || !('seller_id' in r) || (who && r.seller_id === who.id));
      if (method === 'GET') return json(200, applyFilters(rows, url));
      if (method === 'POST') { const list = (Array.isArray(body) ? body : [body]).map(r => ({ id: r.id ?? (1000 + tables[table].length + Math.floor(Math.random() * 1000)), ...r, seller_id: who && who.id, created_at: new Date().toISOString() })); tables[table].push(...list); return json(201, list); }
      if (method === 'PATCH') { const hit = applyFilters(rows, url); hit.forEach(r => Object.assign(r, body)); return json(200, hit); }
      if (method === 'DELETE') { const hit = applyFilters(rows, url); tables[table] = tables[table].filter(r => !hit.includes(r)); return json(200, hit); }
    }
    return json(404, { message: 'unmocked ' + url.pathname });
  });

  const page = await context.newPage();
  const pageErrors = [];
  let aiReply = { cached: false, platform: '스마트스토어', mapping: { header_row: 1, columns: { recipient: 2, phone: 3, phone2: -1, zipcode: 4, address: 5, address_detail: 6, product: 7, option: 8, qty: 9, memo: 10, order_no: 0 } } };
  await page.exposeFunction('__apiCall', c => { apiCalls.push(c); });
  await page.exposeFunction('__aiReply', b => (typeof aiReply === 'function' ? aiReply(b) : aiReply));
  await page.addInitScript(() => {
    const orig = window.fetch;
    window.fetch = async (input, init = {}) => {
      const u = String(input);
      if (!u.startsWith('/api/')) return orig(input, init);
      const h = init.headers || {};
      window.__apiCall({ path: u, body: JSON.parse(init.body || '{}'), auth: h.Authorization || '' });
      const reply = u === '/api/order-ai' ? await window.__aiReply(JSON.parse(init.body || '{}')) : { status: 'sent' };
      return new Response(JSON.stringify(reply), { status: reply.error ? 502 : 200, headers: { 'Content-Type': 'application/json' } });
    };
  });
  page.on('console', m => { if (m.type() === 'error' || m.text().startsWith('T:')) console.log('CONSOLE', m.text()); });
  page.on('pageerror', e => { pageErrors.push(e.message); console.log('PAGE ERROR:', e.message); });
  page.on('dialog', async d => { dialogs.push(d.message()); if (d.type() === 'prompt') await d.accept(promptAnswer); else await d.accept(); });
  const lastDialog = () => dialogs[dialogs.length - 1] || '';
  const results = [];
  const check = (name, cond, extra = '') => { const l = `${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`; results.push(l); console.log(l); };
  const vis = sel => page.isVisible(sel);

  // 쇼핑몰 주문서 (스마트스토어 비슷한 모양: 맨 위 안내줄 + 제목줄)
  const XLSX = require(path.join(NM, 'xlsx-js-style'));
  const aoa = [
    ['스마트스토어 발주발송관리'],
    ['상품주문번호', '구매자명', '수취인명', '수취인연락처1', '우편번호', '기본배송지', '상세배송지', '상품명', '옵션정보', '수량', '배송메세지'],
    ['2026103000001', '김구매', '박민수', '010-1234-5678', '06000', '서울 강남구 테헤란로 1', '101호', '고랭 울 팬츠', '컬러: 블랙 / 사이즈: M', 1, '문 앞'],
    ['2026103000002', '김구매', '박민수', '01012345678', '06000', '서울 강남구 테헤란로 1', '101호', '니트 머플러', '', 2, '문 앞'],
    ['2026103000003', '최구매', '정수진', '', '48000', '부산 해운대구 1', '', '고랭 울 팬츠', '컬러: 화이트 / 사이즈: M', 1, ''],
    ['2026103000004', '이구매', '이영희', '010-5555-6666', '48100', '부산 수영구 2', '', '가디건', '아이보리', 1, ''],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '발주발송관리');
  const file = path.join(__dirname, 'out', 'smartstore-orders.xlsx');
  XLSX.writeFile(wb, file);

  const SHOT = n => path.join(__dirname, 'out', n);
  const hideBanner = () => page.evaluate(() => { document.querySelectorAll('body > div').forEach(d => { if (/테스트 사이트입니다/.test(d.textContent || '') && d.textContent.length < 200) d.style.display = 'none'; }); });
  await page.goto(PAGE); await page.waitForTimeout(800);
  await page.fill('#login-email', 'seller@x.com'); await page.fill('#login-pw', 'password1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  check('seller dashboard shown', await vis('#seller-dashboard'));
  await page.click('#mode-card-store'); await page.waitForTimeout(300);
  check('my-ship link in buy card', (await page.locator('#buy-ai-card a[href="/my-ship"]').count()) === 1);
  await page.setInputFiles('#buy-ai-file-input', file); await page.waitForTimeout(1200);
  check('ship box shown', await vis('#btn-ship-save'));
  check('ship box text', (await page.innerText('#ai-ship-box')).includes('운송장 프로그램 엑셀 양식 그대로'));
  await hideBanner();
  await page.locator('#buy-ai-card').screenshot({ path: SHOT('ship-buy-card.png') });
  await page.click('#btn-ship-save'); await page.waitForTimeout(600);
  const so = tables.seller_ship_orders;
  check('4 ship orders saved', so.length === 4, String(so.length));
  const o1 = so.find(o => o.order_no === '2026103000001') || {};
  check('address split base/detail', o1.address === '서울 강남구 테헤란로 1' && o1.address_detail === '101호', JSON.stringify(o1));
  check('phone formatted, product/option kept', o1.phone === '010-1234-5678' && o1.product === '고랭 울 팬츠' && o1.option.includes('블랙'), JSON.stringify(o1));
  check('saved message + link', (await page.innerText('#ai-ship-box')).includes('4건 넣었어요') && (await vis('#ai-ship-box a[href="/my-ship"]')));
  check('no fulfillment orders created', tables.orders.length === 2);
  // 같은 파일 다시 → 중복 빼기
  await page.click('#buy-ai-result button:has-text("다른 파일 올리기")'); await page.waitForTimeout(150);
  await page.setInputFiles('#buy-ai-file-input', file); await page.waitForTimeout(1200);
  await page.click('#btn-ship-save'); await page.waitForTimeout(600);
  check('duplicates skipped', tables.seller_ship_orders.length === 4 && (await page.innerText('#ai-ship-box')).includes('이미 있던 4건'), await page.innerText('#ai-ship-box'));

  // ---------- 내 택배 주문 화면 ----------
  await page.goto('file:///home/user/claude-code-folder/my-ship.html'); await page.waitForTimeout(1500);
  const t1 = await page.innerText('#app');
  check('notice shown', t1.includes('직접 택배를 보내시는 대표님') && t1.includes('관리자는 이 목록을 볼 수 없어요') && t1.includes('90일'));
  check('4 orders listed', (await page.locator('.orders tbody tr').count()) === 4 && t1.includes('박민수'), t1.slice(0, 300));
  check('download disabled without template', await page.isDisabled('button:has-text("운송장 엑셀 받기")'));
  // CJ 대한통운 모양 빈 양식
  const cjHead = ['보내는분성명', '보내는분전화번호', '보내는분주소(전체, 분할)', '받는분성명', '받는분전화번호', '받는분기타연락처', '받는분우편번호', '받는분주소(전체, 분할)', '품목명', '내품수량', '배송메세지1', '운임구분', '박스타입'];
  const twb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(twb, XLSX.utils.aoa_to_sheet([cjHead]), '운송장');
  const tf = path.join(__dirname, 'out', 'cj-template.xlsx'); XLSX.writeFile(twb, tf);
  await page.setInputFiles('#tpl-file', tf); await page.waitForTimeout(800); 
  check('template modal open', await vis('.modal'), JSON.stringify(dialogs.slice(-2)) + pageErrors.join('|'));
  const sels = page.locator('.modal tbody select');
  const vals = []; for (let i = 0; i < cjHead.length; i++) vals.push(await sels.nth(i).inputValue());
  const want = ['sender_name', 'sender_phone', 'sender_address', 'recipient', 'phone', 'phone2', 'zipcode', 'address_full', 'product_full', 'qty', 'memo', 'blank', 'blank'];
  check('fields guessed', JSON.stringify(vals) === JSON.stringify(want), JSON.stringify(vals));
  await sels.nth(11).selectOption('fixed'); await page.fill('#fx-11', '선불'); await page.dispatchEvent('#fx-11', 'input');
  await sels.nth(12).selectOption('fixed'); await page.fill('#fx-12', '극소'); await page.dispatchEvent('#fx-12', 'input');
  await page.fill('#t-name', 'CJ대한통운');
  await page.fill('#s-phone', '010-9999-0000'); await page.fill('#s-addr', '서울 중구 신당동 1');
  await hideBanner();
  await page.evaluate(() => { document.querySelectorAll('.modal .table-box').forEach(b => { b.scrollTop = 0; b.style.maxHeight = 'none'; }); const bg = document.querySelector('.modal-bg'); bg.style.position = 'static'; bg.style.overflow = 'visible'; document.querySelector('.wrap').style.display = 'none'; });
  await page.locator('.modal').screenshot({ path: SHOT('ship-template-modal.png') });
  await page.evaluate(() => { document.querySelector('.wrap').style.display = ''; });
  await page.click('button:has-text("이 양식 저장")'); await page.waitForTimeout(600);
  check('template saved', tables.seller_ship_templates.length === 1 && tables.seller_ship_templates[0].is_default === true && tables.seller_ship_templates[0].name === 'CJ대한통운');
  check('template listed', (await page.innerText('#app')).includes('CJ대한통운'));
  await hideBanner();
  await page.screenshot({ path: SHOT('my-ship.png'), fullPage: true });
  // 운송장 엑셀 받기 (같은 받는분 합치기)
  await page.evaluate(() => { const o = XLSX.writeFile; window.__names = []; XLSX.writeFile = (wb, n, opt) => { window.__names.push(n); return o(wb, n, opt); }; });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("운송장 엑셀 받기")')]);
  const of = path.join(__dirname, 'out', 'waybill.xlsx'); await dl.saveAs(of);
  { const nm = (await page.evaluate(() => window.__names))[0] || ''; check('file name', nm.startsWith('운송장_CJ대한통운_') && nm.endsWith('.xlsx'), nm); }  // (Playwright 는 한글 파일 이름을 'download' 로 보여줘서 직접 확인)
  const xr = XLSX.utils.sheet_to_json(XLSX.readFile(of).Sheets['운송장'], { header: 1, defval: '' });
  check('header row = template', JSON.stringify(xr[0]) === JSON.stringify(cjHead), JSON.stringify(xr[0]));
  check('4 lines (1 order = 1 line, no merge)', xr.length === 5, JSON.stringify(xr));
  const parks = xr.filter(r => r[3] === '박민수'); const park = parks[0] || [];
  check('same recipient → 2 separate lines', parks.length === 2 && park[8] === '고랭 울 팬츠 / 블랙 / M' && park[9] === 1 && parks[1][8] === '니트 머플러 2개' && parks[1][9] === 2, JSON.stringify(parks));
  check('same-recipient hint in list', (await page.innerText('.orders')).includes('같은 받는분 2건'));
  check('sender + fixed values', park[0] === '애플샵' && park[1] === '010-9999-0000' && park[11] === '선불' && park[12] === '극소', JSON.stringify(park));
  check('full address', park[7] === '서울 강남구 테헤란로 1 101호' && park[6] === '06000', JSON.stringify(park));
  check('marked downloaded', tables.seller_ship_orders.every(o => o.downloaded_at) && (await page.innerText('#app')).includes('엑셀 받음'));
  // 휴대폰
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
  await page.screenshot({ path: SHOT('my-ship-phone.png') });
  check('no horizontal scroll on phone', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.setViewportSize({ width: 1400, height: 900 });
  // 선택 지우기
  await page.click('.orders thead input[type=checkbox]'); await page.waitForTimeout(100);
  await page.locator('.orders tbody input[type=checkbox]').first().check(); await page.waitForTimeout(100);
  await page.click('button:has-text("선택 지우기")'); await page.waitForTimeout(500);
  check('one order deleted', tables.seller_ship_orders.length === 3);

  // 관리자는 못 봄
  await page.goto(PAGE); await page.waitForTimeout(800);
  await page.evaluate(() => localStorage.clear()); await page.goto(PAGE); await page.waitForTimeout(800);
  await page.fill('#login-email', 'admin@x.com'); await page.fill('#login-pw', 'adminpass1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  check('admin dashboard ok', await vis('#admin-dashboard'));
  await page.goto('file:///home/user/claude-code-folder/my-ship.html'); await page.waitForTimeout(1200);
  check('admin blocked', (await page.innerText('#app')).includes('업체 대표님만 볼 수 있어요'));

  check('no page script errors', pageErrors.length === 0, pageErrors.join(' | '));
  const fails = results.filter(r => r.startsWith('FAIL'));
  console.log(`\nRESULT: ${results.length - fails.length}/${results.length} passed`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
