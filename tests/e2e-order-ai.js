// 쇼핑몰 주문서 그대로 올리기(order-ai.js) + 관리자 AI 사용료(ai-cost.html) 확인용 E2E
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

  // ---------- 1. 셀러: 새 탭 ----------
  await page.goto(PAGE); await page.waitForTimeout(800);
  check('login screen shown', await vis('#login-form'));
  await page.fill('#login-email', 'seller@x.com'); await page.fill('#login-pw', 'password1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  check('seller dashboard shown', await vis('#seller-dashboard'));
  check('3 order tabs', (await vis('#reg-tab-single')) && (await vis('#reg-tab-batch')) && (await vis('#reg-tab-ai')));
  await page.click('#reg-tab-ai'); await page.waitForTimeout(200);
  check('AI tab shows upload zone only', (await vis('#ai-drop-zone')) && !(await vis('#single-order-form')) && !(await vis('#batch-order-form')));
  await page.locator('#seller-dashboard').screenshot({ path: path.join(__dirname, 'out', 'shot-ai-tab.png') });
  await page.click('#reg-tab-batch'); await page.waitForTimeout(100);
  check('batch tab still works', (await vis('#batch-order-form')) && !(await vis('#ai-order-form')));
  await page.click('#reg-tab-single'); await page.waitForTimeout(100);
  check('single tab still works', (await vis('#single-order-form')) && !(await vis('#ai-order-form')));
  await page.click('#reg-tab-ai');

  // ---------- 2. 올리기 → 확인표 ----------
  await page.setInputFiles('#ai-file-input', file); await page.waitForTimeout(1200);
  const call = apiCalls.find(c => c.path === '/api/order-ai');
  check('AI called once with login token', !!call && call.auth.startsWith('Bearer ') && call.body.file_name === 'smartstore-orders.xlsx');
  check('signature = header row', call && call.body.signature.startsWith('상품주문번호|구매자명|수취인명'), call && call.body.signature);
  const sent = JSON.stringify(call && call.body.rows);
  check('only top rows sent (header + 3)', call && call.body.rows.length === 5, String(call && call.body.rows.length));
  check('phones/names masked for AI', !sent.includes('1234-5678') && !sent.includes('박민수') && sent.includes('010-*'), sent.slice(0, 300));
  check('confirm table shown', await vis('#ai-result') && !(await vis('#ai-drop-zone')));
  const table = await page.innerText('#ai-result');
  check('sender + cs phone shown (last used number)', table.includes('밤낮딜리버리(애플샵)') && table.includes('010-7777-8888'), table.slice(0, 200));
  check('4 orders, platform badge', table.includes('주문 4건') && table.includes('스마트스토어 양식'));
  check('address joined with detail', table.includes('서울 강남구 테헤란로 1 101호'));
  check('notice about office stock shown', (await page.innerText('#stock-ship-notice')).includes('사무실에 있는 재고부터 우선 출고'));
  const row = n => page.locator('#ai-result tbody tr').nth(n);
  check('(합) not added automatically', !(await row(0).innerText()).includes('(합) 고랭') && (await page.locator('#ai-result tbody input[type=checkbox]').count()) === 2);
  check('same recipient hint + checkbox', (await row(0).innerText()).includes('같은 받는분 2건') && table.includes('부분출고 없이'));
  check('product matched by mall name + color', (await row(0).innerText()).includes('P000001') && (await row(0).innerText()).includes('재고 3'));
  check('wholesale filled from match', (await row(0).locator('input[type=text]').nth(0).inputValue()) === '청평화A' && (await row(0).locator('input[type=text]').nth(1).inputValue()) === '울팬츠');
  check('white matched + no stock', (await row(2).innerText()).includes('P000002') && (await row(2).innerText()).includes('재고 없음'));
  check('unknown product shown', (await row(1).innerText()).includes('상품관리에 없음'));
  check('missing phone flagged', (await row(2).innerText()).includes('연락처 없음'));
  check('missing wholesale flagged', (await row(1).innerText()).includes('도매처명·도매상품명 없음'));
  check('duplicate text', (await row(3).innerText()).includes('최근 3일안에 동일한 주문건이 있으니 확인해주세요.'));
  check('unknown-wholesale button + disclaimer', table.includes('빈 도매처 칸을 쇼핑몰상품명으로 채우기') && table.includes('책임질 수 없습니다'));
  check('submit blocked while rows are missing info', await page.isDisabled('#btn-ai-submit'));
  const why = await page.isVisible('#ai-submit-why') ? await page.innerText('#ai-submit-why') : '';
  check('reason shown next to submit button', why.includes('빈 칸이 있는 주문 3건') && why.includes('연락처 없음 1건') && why.includes('도매처명·도매상품명 없음 2건'), why);
  { await page.addStyleTag({ content: "#bn-chat-btn{display:none!important}" }); const sy = await page.evaluate(() => window.scrollY); const b0 = await page.locator("#ai-result").boundingBox(); const bb = { ...b0, y: b0.y + sy }; const vp = page.viewportSize();
    await page.screenshot({ path: path.join(__dirname, 'out', `${process.env.SHOT || 'shot'}-ai-submit-why.png`), fullPage: true, clip: { x: bb.x, y: bb.y + bb.height - 300, width: Math.min(bb.width, vp.width), height: 300 } }); }
  await page.screenshot({ path: path.join(__dirname, 'out', 'shot-ai-confirm.png'), fullPage: true });
  await page.locator('#ai-result').screenshot({ path: path.join(__dirname, 'out', `${process.env.SHOT || 'shot'}-ai-result.png`) });
  if (await page.isVisible('#ai-buy-box')) {
    const buy = await page.innerText('#ai-buy-box');
    check('buy list: stock 3 covers black (2개), white 1 + unknown listed', buy.includes('사무실 재고로 나갈 상품 2개') || buy.includes('사무실 재고로 나갈 상품'), buy.slice(0, 400));
    console.log('BUYBOX:\n' + buy);
  }

  // 연락처 없는 줄 빼기 → 아직 도매처 빈 줄 때문에 막힘
  await row(2).locator('button').click(); await page.waitForTimeout(100);
  check('after 빼기: still blocked by empty wholesale', await page.isDisabled('#btn-ai-submit'));
  // 니트 머플러: 직접 입력
  await row(1).locator('input[type=text]').nth(0).fill('신평화B'); await row(1).locator('input[type=text]').nth(0).press('Tab'); await page.waitForTimeout(100);
  await row(1).locator('input[type=text]').nth(1).fill('머플러'); await row(1).locator('input[type=text]').nth(1).press('Tab'); await page.waitForTimeout(100);
  // 가디건: 모름 → 쇼핑몰상품명
  await page.click('button:has-text("빈 도매처 칸을 쇼핑몰상품명으로 채우기")'); await page.waitForTimeout(100);
  check('unknown filled with mall name', (await row(3).locator('input[type=text]').nth(1).inputValue()) === '가디건 / 아이보리' && (await row(3).innerText()).includes('모름'));
  check('now submit enabled (3건)', !(await page.isDisabled('#btn-ai-submit')) && (await page.innerText('#btn-ai-submit')).includes('3건'));
  check('reason box gone when submit enabled', !(await page.isVisible('#ai-submit-why')));
  // (합) 체크: 같은 받는분 2건 함께
  await row(1).locator('input[type=checkbox]').check(); await page.waitForTimeout(100);
  check('(합) checks whole group', (await row(0).locator('input[type=checkbox]').isChecked()) && (await row(0).innerText()).includes('(합) 고랭'));
  await page.screenshot({ path: path.join(__dirname, 'out', 'shot-ai-confirm2.png'), fullPage: true });

  // 보관요청 [접수] 전에는 막힘 (기존 규칙과 같음)
  const before = tables.orders.length;
  await page.click('#btn-ai-submit'); await page.waitForTimeout(300);
  check('keep request required first', tables.orders.length === before && lastDialog().includes('보관요청'), lastDialog());
  await page.evaluate(() => { keepConfirmed = '없음'; });
  await page.click('#btn-ai-submit'); await page.waitForTimeout(300);
  check('final check popup shown, nothing saved yet', (await vis('#ai-final-modal')) && tables.orders.length === before);
  const conf = await page.innerText('#ai-final-modal');
  check('final check lists rows + (합) / 책임 / 중복', conf.includes('(합)고랭 울 팬츠 / 블랙 / M / 1개') && conf.includes('박민수') && conf.includes('(합) 합배송 2건') && conf.includes('책임질 수 없습니다') && conf.includes('최근 3일안에') && conf.includes('총 3건, 이대로 접수하시겠습니까?'), conf.slice(0, 300));
  await page.locator('#ai-final-modal > div').screenshot({ path: path.join(__dirname, 'out', 'shot-ai-final-check.png') });
  await page.click('#btn-ai-final-cancel'); await page.waitForTimeout(200);
  check('다시 확인할게요 → closes, not saved, table kept', !(await vis('#ai-final-modal')) && tables.orders.length === before && (await vis('#ai-result')));
  await page.click('#btn-ai-submit'); await page.waitForTimeout(300);
  await page.click('#btn-ai-final-ok'); await page.waitForTimeout(800);
  const added = tables.orders.slice(before);
  check('3 orders saved', added.length === 3, String(added.length));
  const o1 = added[0] || {};
  check('sender/cs phone rules', added.every(o => o.sender_name === '밤낮딜리버리(애플샵)' && o.cs_phone === '010-7777-8888' && o.seller_company === '애플샵'), JSON.stringify(o1));
  check('fields from file', o1.recipient === '박민수' && o1.phone === '010-1234-5678' && o1.zipcode === '06000' && o1.address === '서울 강남구 테헤란로 1 101호' && o1.memo === '문 앞', JSON.stringify(o1));
  check('product text = (합) + name / option', o1.product === '(합)고랭 울 팬츠 / 블랙 / M / 1개' && added[1].product === '(합)니트 머플러 / 2개' && added[1].qty === 2 && added[2].product === '가디건 / 아이보리 / 1개', added.map(o => o.product).join(' | '));
  check('wholesale saved (match / typed / unknown)', o1.wholesale_company === '청평화A' && added[1].wholesale_company === '신평화B' && added[1].wholesale_product === '머플러' && added[2].wholesale_company === '가디건 / 아이보리' && added[2].wholesale_product === '가디건 / 아이보리');
  check('excel-type id + 접수대기 + keep', added.every(o => o.id.startsWith('ORD-EXCEL-') && o.status === '접수대기' && o.keep_request === '없음'));
  check('success message + table reset', (await page.innerText('#leftover-title')).includes('총 3건') && (await vis('#leftover-modal')) && (await vis('#ai-drop-zone')) && !(await vis('#ai-result')));
  check('new orders in my list', (await page.textContent('#seller-order-list')).includes('박민수'));

  // AI 오류 메세지
  aiReply = { error: 'AI 분석이 아직 준비 중입니다.' };
  await page.setInputFiles('#ai-file-input', file); await page.waitForTimeout(800);
  check('AI error shown in zone', (await page.innerText('#ai-status')).includes('준비 중') && !(await vis('#ai-result')));

  // 에이블리 발송관리 양식 (맨 위가 바로 제목줄) + 저장된 칸 정보의 제목줄 위치가 이번 파일과 다른 경우 (2026-11-16 거래처 오류)
  const ably = [
    ['결제일', '상품주문번호', '주문번호', '택배사', '택배사 코드', '송장번호', '상품명', '판매자 상품코드', '옵션 정보', '수량', '주문자명', '연락처', '판매채널', '수취인명', '수취인 연락처', '우편번호', '배송지 주소', '배송 메모', '주문상태', '배송타입', '솔루션사 고유코드', '개인통관고유부호'],
    ['2026-11-15 23:41:34', '600000001', '1700000000001', 'CJ대한통운', '1', '', '테스트 맨투맨세트', '맨투맨', '블랙/FREE', '1', '가나다', '010-1000-2000', '4910', '가나다', '010-1000-2000', '12345', '서울 중구 테스트로 1 101호', '문 앞', '상품 준비중', '일반배송', '', ''],
    ['2026-11-15 22:56:10', '600000002', '1700000000002', 'CJ대한통운', '1', '', '테스트 집업자켓', '자켓', '차콜/FREE', '1', 'buyer_1', '010-3000-4000', '4910', '라마바', '010-3000-4000', '23456', '경기 광명시 테스트로 2', '', '상품 준비중', '일반배송', '', ''],
  ];
  const ablyWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(ablyWb, XLSX.utils.aoa_to_sheet(ably), '에이블리_발송 관리');
  const ablyFile = path.join(__dirname, 'out', 'ably-orders.xlsx');
  XLSX.writeFile(ablyWb, ablyFile);
  const ablyCols = { recipient: 13, phone: 14, phone2: -1, zipcode: 15, address: 16, address_detail: -1, product: 6, option: 8, qty: 9, memo: 17, order_no: 1 };
  const aiBodies = [];
  aiReply = b => { aiBodies.push(b); return { cached: true, platform: '에이블리', mapping: { header_row: 5, columns: ablyCols } }; };
  await page.setInputFiles('#ai-file-input', ablyFile); await page.waitForTimeout(1200);
  let ablyText = await page.innerText('#ai-result').catch(() => '');
  check('ably: saved header row off → still reads rows', (await vis('#ai-result')) && ablyText.includes('주문 2건') && ablyText.includes('가나다') && ablyText.includes('라마바'), (await page.innerText('#ai-status')) + ablyText.slice(0, 200));
  await page.evaluate(() => aiReset && aiReset()).catch(() => {});
  // 저장된 칸 정보가 아예 엉뚱하면 → AI 에 새로 물어봄 (fresh)
  aiBodies.length = 0;
  aiReply = b => { aiBodies.push(b); return b.fresh ? { cached: false, platform: '에이블리', mapping: { header_row: 0, columns: ablyCols } } : { cached: true, platform: '에이블리', mapping: { header_row: 0, columns: { ...ablyCols, recipient: 20, address: 21, product: 5 } } }; };
  await page.setInputFiles('#ai-file-input', ablyFile); await page.waitForTimeout(1200);
  ablyText = await page.innerText('#ai-result').catch(() => '');
  check('ably: bad saved mapping → asks AI fresh once', aiBodies.length === 2 && !aiBodies[0].fresh && aiBodies[1].fresh === true && ablyText.includes('주문 2건'), JSON.stringify(aiBodies.map(b => !!b.fresh)) + ' ' + (await page.innerText('#ai-status')));

  // 우리 옛 '사입발송대행 요청서' 양식: 앞쪽 안내 시트가 주문 시트보다 길어도 주문 시트를 읽어야 함 (2026-11-16 거래처 오류)
  const guideWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(guideWb, XLSX.utils.aoa_to_sheet([['이용안내'], ['입금계좌 안내']]), '밤낮딜리버리 이용안내');
  XLSX.utils.book_append_sheet(guideWb, XLSX.utils.aoa_to_sheet(Array.from({ length: 40 }, (_, i) => [`작성 안내 문장 ${i + 1} 입니다`])), '발송대행(풀필먼트)작성안내');
  XLSX.utils.book_append_sheet(guideWb, XLSX.utils.aoa_to_sheet([
    ['풀필요청서) 아래 작성해서 전달주시면 되세요', '초록색은 고정값'],
    ['송화인명(보내는사람)', '대표님C/S연락처', '수화인명(받는사람)', '전화번호,휴대폰(받는사람)', '우편번호', '주소', '상품명', '컬러/사이즈', '밤낮딜리버리 전달메세지', '수량(값 고정)'],
    ['밤낮딜리버리(애플샵)', '070-1111-2222', '가나다', '01012345678', '12345', '서울 중구 테스트로 1', '(하의만)심스후드집업', '블랙/FREE', '', '1'],
    ['밤낮딜리버리(애플샵)', '070-1111-2222', '마바사', '01022223333', '23456', '부산 진구 테스트로 2', '다이아 보아 맨투맨세트', '그레이/FREE', '', '2'],
    ['밤낮딜리버리(애플샵)', '070-1111-2222', '아자차', '01044445555', '34567', '경기 성남시 테스트로 3', '12번면슬렉스', '화이트/S', '', '1'],
  ]), '발송대행(풀필먼트)주문서');
  const guideFile = path.join(__dirname, 'out', 'old-request-form.xlsx');
  XLSX.writeFile(guideWb, guideFile);
  aiBodies.length = 0;
  aiReply = b => { aiBodies.push(b); return { cached: false, platform: '', mapping: { header_row: 1, columns: { recipient: 2, phone: 3, phone2: -1, zipcode: 4, address: 5, address_detail: -1, product: 6, option: 7, qty: 9, memo: 8, order_no: -1 } } }; };
  await page.setInputFiles('#ai-file-input', guideFile); await page.waitForTimeout(1200);
  const gText = await page.innerText('#ai-result').catch(() => '');
  await page.evaluate(() => document.getElementById('leftover-modal').classList.add('hidden'));
  await page.locator('#ai-result').screenshot({ path: path.join(__dirname, 'out', 'shot-ai-product-text.png') });
  check('old request form: order sheet picked (not guide sheet)', aiBodies[0] && aiBodies[0].signature.includes('수화인명') && gText.includes('주문 3건') && gText.includes('다이아 보아 맨투맨세트 / 그레이 / FREE / 2개') && gText.includes('가나다') && gText.includes("'발송대행(풀필먼트)주문서' 시트를 읽었어요"), aiBodies[0] && aiBodies[0].signature);

  // 예시 시트에도 제목줄 + 예시 주문(홍길동)이 있고 줄이 더 많아도 → 진짜 주문서 시트를 읽음 + 읽은 시트 이름 표시
  const exWb = XLSX.utils.book_new();
  const head = ['수취인명', '수취인연락처', '주소', '상품명', '옵션', '수량'];
  XLSX.utils.book_append_sheet(exWb, XLSX.utils.aoa_to_sheet([head, ...Array.from({ length: 6 }, () => ['홍길동', '010-0000-0000', '서울 예시로 1', '예시 상품', '블랙', '1'])]), '주문서 작성법');
  XLSX.utils.book_append_sheet(exWb, XLSX.utils.aoa_to_sheet([['작성예시) 이렇게 적어주세요'], head, ...Array.from({ length: 6 }, () => ['김예시', '010-0000-0000', '서울 예시로 1', '예시 상품', '블랙', '1'])]), 'Sheet2');
  XLSX.utils.book_append_sheet(exWb, XLSX.utils.aoa_to_sheet([head, ['진짜고객', '010-9999-8888', '부산 진짜로 5', '진짜 상품', '화이트', '2'], ['', '', '', '', '', '1'], ['', '', '', '', '', '1']]), 'Sheet3');
  const exFile = path.join(__dirname, 'out', 'example-sheets.xlsx');
  XLSX.writeFile(exWb, exFile);
  aiBodies.length = 0;
  aiReply = b => { aiBodies.push(b); return { cached: false, platform: '', mapping: { header_row: 0, columns: { recipient: 0, phone: 1, phone2: -1, zipcode: -1, address: 2, address_detail: -1, product: 3, option: 4, qty: 5, memo: -1, order_no: -1 } } }; };
  await page.setInputFiles('#ai-file-input', exFile); await page.waitForTimeout(1200);
  const exText = await page.innerText('#ai-result').catch(() => '');
  check('example sheets skipped, real sheet read, blank rows ignored', exText.includes('주문 1건') && exText.includes('진짜고객') && !exText.includes('홍길동') && exText.includes("'Sheet3' 시트를 읽었어요"), exText.slice(0, 200));

  // ---------- 3. 관리자 AI 사용료 ----------
  await page.evaluate(() => logout()); await page.waitForTimeout(800);
  await page.click('#tab-btn-seller').catch(() => {});
  await page.fill('#login-email', 'admin@x.com'); await page.fill('#login-pw', 'adminpass1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  check('admin order list shown', await vis('#admin-orders-panel'));
  await page.click('#admin-group-sellers'); await page.waitForTimeout(200);
  check('거래처 group no longer has AI 사용료 tab', (await vis('#admin-sellers-panel')) && !(await vis('#admin-tab-aicost')));
  await page.click('#admin-group-aicost'); await page.waitForTimeout(1500);
  check('AI 사용료 is its own menu', (await vis('#admin-aicost-panel')) && !(await vis('#admin-subtabs')) && (await page.getAttribute('#admin-aicost-frame', 'src')) === 'ai-cost.html?embed=1');
  const frame = page.frameLocator('#admin-aicost-frame');
  const ftext = await frame.locator('body').innerText().catch(e => 'ERR ' + e.message);
  check('cost page: total of order AI + chat ($0.030 = 42원)', ftext.includes('$0.030') && ftext.includes('42원'), ftext.slice(0, 300));
  const place = await frame.locator('#by-place').innerText();
  check('cost page: by place (주문서 14원, 홈페이지 상담 28원, 사이트 상담 0)', /셀러 주문서 읽기[\s\S]*1[\s\S]*14원[\s\S]*33%/.test(place) && /홈페이지[\s\S]*1[\s\S]*28원[\s\S]*67%/.test(place) && /주문접수 사이트[\s\S]*0[\s\S]*0원/.test(place), place);
  const recent = await frame.locator('#recent').innerText();
  check('cost page: recent shows where + what', recent.includes('카드로 결제할 수 있어요?') && recent.includes('AI 상담 · 홈페이지') && recent.includes('애플샵 · 스마트스토어.xlsx'), recent);
  check('cost page: company + formats still shown', ftext.includes('애플샵') && (await frame.locator('#formats tr').count()) >= 1);
  await page.setViewportSize({ width: 1400, height: 1900 }); await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(__dirname, 'out', 'shot-ai-cost.png'), fullPage: false });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.click('#admin-group-sellers'); await page.waitForTimeout(200);
  check('seller admin tab still works', (await vis('#admin-sellers-panel')) && !(await vis('#admin-aicost-panel')));

  check('no page script errors', pageErrors.length === 0, pageErrors.join(' | '));
  const fails = results.filter(r => r.startsWith('FAIL'));
  console.log(`\nRESULT: ${results.length - fails.length}/${results.length} passed`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
