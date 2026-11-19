// 매장/사무실 택배 화면 [사입 목록 만들기] (주문 접수 없이 도매 매장별 사입 목록) 확인용 E2E — e2e-order-ai.js 와 같은 가짜 서버
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
  seller_own_stock: [{ product_id: 1, company: '애플샵', qty: 5, updated_at: new Date().toISOString() }], seller_own_stock_moves: [],
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
  await page.goto(PAGE); await page.waitForTimeout(800);
  check('login screen shown', await vis('#login-form'));
  await page.fill('#login-email', 'seller@x.com'); await page.fill('#login-pw', 'password1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  check('seller dashboard shown', await vis('#seller-dashboard'));
  await page.click('#mode-card-store'); await page.waitForTimeout(300);
  check('store form shown', await vis('#store-form-card'));
  check('buy card shown in store screen', (await vis('#buy-ai-card')) && (await vis('#buy-ai-drop-zone')));
  // 그림용: 테스트 띠·상담 버튼 숨기고 위쪽만
  await page.addStyleTag({ content: '#test-site-banner,[id*=test-banner],[id*=chat-btn],[id*=chat-launch],.bamnat-chat-btn{display:none!important}' });
  await page.evaluate(() => { document.querySelectorAll('body > div').forEach(d => { if (/테스트 사이트입니다/.test(d.textContent || '') && d.textContent.length < 200) d.style.display = 'none'; }); window.scrollTo(0, 0); });
  { const bb = await page.locator('#store-section').boundingBox(); await page.screenshot({ path: SHOT('buy-before-upload.png'), fullPage: true, clip: { x: bb.x, y: bb.y, width: bb.width, height: Math.min(bb.height, 760) } }); }

  const ordersBefore = tables.orders.length;
  await page.setInputFiles('#buy-ai-file-input', file); await page.waitForTimeout(1200);
  check('AI called', apiCalls.some(c => c.path === '/api/order-ai'));
  check('buy result shown, drop zone hidden', (await vis('#buy-ai-result')) && !(await vis('#buy-ai-drop-zone')));
  const txt = await page.innerText('#buy-ai-result');
  check('no recipient/phone/address shown', !txt.includes('박민수') && !txt.includes('1234-5678') && !txt.includes('테헤란로'), txt.slice(0, 300));
  check('says no order is registered', txt.includes('사입 목록만 정리'));
  check('no submit button', (await page.locator('#buy-ai-result button', { hasText: '주문접수' }).count()) === 0);
  check('fulfillment AI tab untouched', !(await page.isVisible('#ai-result')));
  const groups = page.locator('#buy-ai-result table').first().locator('tbody tr');
  check('4 product groups', (await groups.count()) === 4, String(await groups.count()));
  check('matched product prefilled', (await groups.nth(0).locator('input').nth(0).inputValue()) === '청평화A');
  // 밤낮 사무실 재고(3)는 안 쓰고, 셀러 '내 재고표'(블랙 M 5개)만 뺌
  const buyTxt = await page.innerText('#ai-buy-box');
  check('office stock ignored, own stock used', !buyTxt.includes('재고 3') && buyTxt.includes('내 재고로 보낼 상품 1개') && !buyTxt.includes('블랙'), buyTxt.slice(0, 300));
  check('own-stock checkbox + out button', (await vis('#buy-use-own')) && (await vis('#btn-buy-own-out')));
  await page.uncheck('#buy-use-own'); await page.waitForTimeout(150);
  check('uncheck own stock → black back in list', (await page.innerText('#ai-buy-box')).includes('블랙'));
  await page.check('#buy-use-own'); await page.waitForTimeout(150);
  check('unknown wholesale grouped as 도매처 없음', buyTxt.includes('(도매처 없음)'));
  check('different unknown products not merged', buyTxt.includes('니트 머플러') && buyTxt.includes('가디건'));

  // 도매처 적기 → 목록이 도매처별로 바뀜
  await groups.nth(1).locator('input').nth(0).fill('디오트 2층 15호'); await groups.nth(1).locator('input').nth(0).dispatchEvent('change'); await page.waitForTimeout(150);
  await groups.nth(1).locator('input').nth(1).fill('울머플러'); await groups.nth(1).locator('input').nth(1).dispatchEvent('change'); await page.waitForTimeout(150);
  await groups.nth(3).locator('input').nth(0).fill('디오트 2층 15호'); await groups.nth(3).locator('input').nth(0).dispatchEvent('change'); await page.waitForTimeout(150);
  await groups.nth(3).locator('input').nth(1).fill('꽈배기 가디건'); await groups.nth(3).locator('input').nth(1).dispatchEvent('change'); await page.waitForTimeout(150);
  const buy2 = await page.innerText('#ai-buy-box');
  check('typed wholesale used', buy2.includes('디오트 2층 15호') && buy2.includes('울머플러') && !buy2.includes('(도매처 없음)'), buy2.slice(0, 400));
  check('muffler qty 2', /울머플러[\s\S]*?\t2\t/.test(buy2) || buy2.includes('2'), '');
  check('remember button shown', await vis('#btn-buy-remember'));
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.locator('#buy-ai-card').screenshot({ path: SHOT('buy-after-upload.png') });

  // 텍스트 복사
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('#ai-buy-box button:has-text("텍스트 복사")'); await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check('copy grouped by wholesale', clip.includes('■ 디오트 2층 15호') && clip.includes('■ 청평화A') && clip.includes('울머플러 : 2개'), clip);

  // 엑셀 받기
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#ai-buy-box button:has-text("엑셀 받기")')]);
  const xf = path.join(__dirname, 'out', 'buy-list.xlsx'); await dl.saveAs(xf);
  const xr = XLSX.utils.sheet_to_json(XLSX.readFile(xf).Sheets['사입할 상품'], { header: 1 });
  check('excel has header + 3 rows (black from own stock)', xr.length === 4 && xr[0][5] === '쇼핑몰상품명', JSON.stringify(xr));

  // 상품관리에 기억하기
  const prodBefore = tables.products.length;
  await page.click('#btn-buy-remember'); await page.waitForTimeout(800);
  check('products created', tables.products.length === prodBefore + 2, String(tables.products.length));
  check('no orders created', tables.orders.length === ordersBefore);

  // 내 재고로 보낸 만큼 빼기
  await page.click('#btn-buy-own-out'); await page.waitForTimeout(500);
  check('own stock deducted 5→4', tables.seller_own_stock.find(r => r.product_id === 1).qty === 4);
  check('done text, button gone', (await page.innerText('#ai-buy-box')).includes('내 재고표에서 뺐어요') && !(await vis('#btn-buy-own-out')));
  check('move logged with file name', (tables.seller_own_stock_moves[0] || {}).reason === '주문서 출고 (smartstore-orders.xlsx)');

  // 빼기
  await groups.nth(0).locator('button').click(); await page.waitForTimeout(150);
  const buy3 = await page.innerText('#ai-buy-box');
  check('removed group drops from list', !buy3.includes('블랙') && buy3.includes('꽈배기 가디건'), buy3.slice(0, 300));
  check('remembered products matched', (await page.innerText('#buy-ai-result table')).includes('상품관리 '));

  // 다른 파일 올리기
  await page.click('#buy-ai-result button:has-text("다른 파일 올리기")'); await page.waitForTimeout(150);
  check('reset shows drop zone', (await vis('#buy-ai-drop-zone')) && !(await vis('#buy-ai-result')));

  // 풀필먼트 AI 탭은 그대로 동작
  await page.click('#mode-card-fulfillment'); await page.waitForTimeout(200);
  await page.click('#reg-tab-ai'); await page.waitForTimeout(200);
  await page.setInputFiles('#ai-file-input', file); await page.waitForTimeout(1200);
  const t2 = await page.innerText('#ai-result');
  check('fulfillment AI still shows recipients + submit', t2.includes('박민수') && (await vis('#btn-ai-submit')));
  { const fb = await page.innerText('#ai-buy-box'); check('fulfillment buy box still uses stock', fb.includes('사무실 재고로 나갈 상품 1개'), fb.slice(0, 200)); }
  // ---------- 내 재고표 화면 ----------
  await page.goto('file:///home/user/claude-code-folder/my-stock.html'); await page.waitForTimeout(1500);
  const ms = await page.innerText('#app');
  check('my-stock shows company + products', ms.includes('애플샵') && ms.includes('울팬츠') && ms.includes('디오트 2층 15호'), ms.slice(0, 300));
  check('my-stock stats', ms.includes('등록 상품') && ms.includes('총 재고'));
  check('own qty shown', (await page.inputValue('#q-1')) === '4');
  await page.click('#q-1 + button'); await page.waitForTimeout(400);
  check('+ saves', tables.seller_own_stock.find(r => r.product_id === 1).qty === 5 && (await page.inputValue('#q-1')) === '5');
  await page.fill('#q-2', '7'); await page.dispatchEvent('#q-2', 'change'); await page.waitForTimeout(400);
  check('type number saves', (tables.seller_own_stock.find(r => r.product_id === 2) || {}).qty === 7);
  await page.waitForTimeout(300);
  check('moves listed', (await page.innerText('#moves')).includes('직접 수정'));
  await page.click('.tabs button:has-text("재고 0")'); await page.waitForTimeout(150);
  check('filter zero hides stocked', !(await page.isVisible('#q-1')));
  await page.click('.tabs button:has-text("전체")'); await page.waitForTimeout(150);
  // 엑셀 받기 → 고쳐서 올리기
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("엑셀 받기")')]);
  const sf = path.join(__dirname, 'out', 'my-stock.xlsx'); await dl2.saveAs(sf);
  const sw = XLSX.readFile(sf); const sr = XLSX.utils.sheet_to_json(sw.Sheets['내 재고'], { header: 1 });
  check('excel download has codes + qty', sr[0][0] === '상품코드' && sr[0][6] === '내 재고' && sr.length === tables.products.length + 1, JSON.stringify(sr[0]));
  sr[1][6] = 12;
  const sw2 = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(sw2, XLSX.utils.aoa_to_sheet(sr), '내 재고'); const sf2 = path.join(__dirname, 'out', 'my-stock-edit.xlsx'); XLSX.writeFile(sw2, sf2);
  await page.setInputFiles('#xl', sf2); await page.waitForTimeout(800);
  check('excel upload applied', tables.seller_own_stock.find(r => r.product_id === 1).qty === 12, lastDialog());
  await page.evaluate(() => { document.querySelectorAll('body > div').forEach(d => { if (/테스트 사이트입니다/.test(d.textContent || '') && d.textContent.length < 200) d.style.display = 'none'; }); });
  await page.screenshot({ path: SHOT('my-stock.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
  await page.screenshot({ path: SHOT('my-stock-phone.png'), fullPage: false });
  check('no horizontal scroll on phone', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.setViewportSize({ width: 1400, height: 900 });

  // 관리자 화면/로그인 화면 기본 확인
  check('no page script errors', pageErrors.length === 0, pageErrors.join(' | '));
  const fails = results.filter(r => r.startsWith('FAIL'));
  console.log(`\nRESULT: ${results.length - fails.length}/${results.length} passed`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
