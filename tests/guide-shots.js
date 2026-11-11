// 초보 셀러용 이용 설명서에 넣을 화면 캡처 (가짜 Supabase · 가짜 데이터만 사용)
// 사용: cd tests && npm install && node guide-shots.js [저장폴더]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const NM = path.join(__dirname, 'node_modules');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'out', 'guide');
const P = f => 'file://' + path.join(ROOT, f);
const LIB = {
  'cdn.tailwindcss.com': '@tailwindcss/browser/dist/index.global.js',
  'xlsx-js-style': 'xlsx-js-style/dist/xlsx.bundle.js',
  'jszip': 'jszip/dist/jszip.min.js',
  'lucide': 'lucide/dist/umd/lucide.min.js',
  'supabase-js': '@supabase/supabase-js/dist/umd/supabase.js',
};
const ids = { seller: '00000000-0000-0000-0000-00000000000a', wait: '00000000-0000-0000-0000-0000000000c1' };
const users = {
  'seller@x.com': { id: ids.seller, pw: 'password1', profile: { id: ids.seller, email: 'seller@example.com', company: '예시샵', name: '김예시', phone: '010-1234-5678', role: 'seller', status: 'approved', zipcode: '04563', address: '서울 중구 마장로 1', detail_address: '3층 301호', created_at: '2026-09-01T00:00:00Z' } },
  'wait@x.com': { id: ids.wait, pw: 'waitpass1', profile: { id: ids.wait, email: 'new@example.com', company: '새가게', name: '박새롬', phone: '010-9999-0000', role: 'seller', status: 'pending', created_at: '2026-11-10T00:00:00Z' } },
};
const ago = h => new Date(Date.now() - h * 3600000).toISOString();
const O = (n, extra) => ({ id: 'ORD-' + n, seller_id: ids.seller, seller_company: '예시샵', sender_name: '밤낮딜리버리(예시샵)', cs_phone: '010-1234-5678', status: '접수대기', ship_status: '미출고', order_type: 'fulfillment', order_no: n, item_no: 1, seller_order_no: n, qty: 1, created_at: ago(n), ...extra });
const tables = {
  orders: [
    O(1, { recipient: '홍길동', phone: '010-2222-3333', zipcode: '06000', address: '서울 강남구 테헤란로 1 101호', product: '(합)울 와이드 팬츠 / 블랙 / 1개', wholesale_company: '청평화 가나', wholesale_product: '울PT', bamnat_memo: '' }),
    O(2, { recipient: '홍길동', phone: '010-2222-3333', zipcode: '06000', address: '서울 강남구 테헤란로 1 101호', product: '(합)니트 머플러 / 아이보리 / 1개', wholesale_company: '디오트 다라', wholesale_product: '머플러' }),
    O(3, { recipient: '이영희', phone: '010-5555-6666', zipcode: '48100', address: '부산 수영구 광안로 2', product: '꽃무늬 원피스 / 베이지 / 1개', wholesale_company: '신평화 마바', wholesale_product: '플라워OPS', status: '접수완료', ship_status: '출고완료', courier: '우체국택배', tracking_no: '6091234567890' }),
    O(4, { order_type: 'store_post', recipient: '예시샵', phone: '010-1234-5678', zipcode: '04563', address: '서울 중구 마장로 1 3층 301호', product: '', bamnat_memo: '풀필먼트 출고건을 제외하고 나머지 상품을 보내주세요', status: '접수완료', ship_status: '미출고' }),
  ],
  pickup_requests: [
    { id: 'p1', seller_id: ids.seller, seller_company: '예시샵', orderer_name: '예시샵', orderer_phone: '010-1234-5678', store_name: '가나', store_location: '청평화 2층 A-12', store_phone: '010-1111-0000', prepay: true, prepay_misong: true, agreed: true, memo: '울PT 블랙 2장', status: '접수', created_at: ago(1) },
    { id: 'p2', seller_id: ids.seller, seller_company: '예시샵', orderer_name: '예시샵', orderer_phone: '010-1234-5678', store_name: '다라', store_location: '디오트 1층 B-3', store_phone: '010-2222-0000', prepay: false, prepay_misong: false, agreed: false, memo: '', status: '완료', created_at: ago(26) },
  ],
  products: [
    { id: 1, code: 'P000001', company: '예시샵', wholesale_company: '청평화 가나', wholesale_product: '울PT', color: '블랙', size: 'M', mall_names: [{ platform: '스마트스토어', name: '울 와이드 팬츠' }], photo_url: '', memo: '', deleted_at: null, delete_requested_at: null, created_at: ago(100), updated_at: ago(100) },
    { id: 2, code: 'P000002', company: '예시샵', wholesale_company: '디오트 다라', wholesale_product: '머플러', color: '아이보리', size: 'F', mall_names: [{ platform: '지그재그', name: '니트 머플러' }], photo_url: '', memo: '', deleted_at: null, delete_requested_at: null, created_at: ago(90), updated_at: ago(90) },
  ],
  inventory: [{ product_id: 1, company: '예시샵', qty_a: 3 }],
  stock_items: [
    { id: 1, company: '예시샵', wholesale_company: '청평화 가나', wholesale_product: '울PT', retail_product: '울 와이드 팬츠', color: '블랙', size: 'M', quantity: 3, location: 'A-1', stocked_on: '2026-11-05', shipped_on: null, shipped_note: '', customer: '' },
    { id: 2, company: '예시샵', wholesale_company: '신평화 마바', wholesale_product: '플라워OPS', retail_product: '', color: '베이지', size: 'F', quantity: 1, location: 'A-2', stocked_on: '2026-11-03', shipped_on: null, shipped_note: '', customer: '반품 이영희' },
    { id: 3, company: '예시샵', wholesale_company: '디오트 다라', wholesale_product: '머플러', retail_product: '', color: '아이보리', size: 'F', quantity: 1, location: 'A-1', stocked_on: '2026-10-28', shipped_on: '2026-11-02', shipped_note: '', customer: '' },
  ],
  product_logs: [], order_file_formats: [], couriers: [{ id: 'c1', name: '우체국택배', sort_order: 1 }],
  address_book: [{ id: 'a1', seller_id: ids.seller, label: '단골 홍길동', recipient: '홍길동', phone: '010-2222-3333', zipcode: '06000', address: '서울 강남구 테헤란로 1', detail_address: '101호', created_at: ago(200) }],
  settlements: [], settle_contacts: [],
};
const settleRows = [
  { settle_date: '2026-11-10', total: 186500, result: '청구', token: 't1', data: { pickupStores: 3, pickupCost: 9000, unsentStores: 1, unsentCost: 2000, shippingFee: 7000, fulfillCount: 12, fulfillCost: 36000, etcCost: 0, serviceTotal: 54000, vat: 5400, prepaid: 127100, paid: 0 } },
  { settle_date: '2026-11-07', total: 0, result: '완납', token: 't2', data: { pickupStores: 2, pickupCost: 6000, unsentStores: 0, unsentCost: 0, shippingFee: 3500, fulfillCount: 8, fulfillCost: 24000, etcCost: 0, serviceTotal: 33500, vat: 3350, prepaid: 88000, paid: 124850 } },
];
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
fs.mkdirSync(OUT, { recursive: true });
const pageErrors = [];

async function setup(context) {
  await context.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.protocol === 'file:' || url.protocol === 'about:' || url.protocol === 'data:') return route.continue();
    const lib = Object.entries(LIB).find(([k]) => req.url().includes(k));
    if (lib) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(NM, lib[1])) });
    if (!url.hostname.endsWith('supabase.co')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    const method = req.method(); const headers = req.headers();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
    if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: cors });
    let body = null; try { body = req.postDataJSON(); } catch { body = null; }
    const json = (status, data) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const who = whoFrom(headers);
    if (url.pathname === '/auth/v1/token') {
      const u = users[body.email];
      if (!u || u.pw !== body.password) return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials' });
      return json(200, { access_token: tokenFor(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: userObj(u) });
    }
    if (url.pathname === '/auth/v1/user') return who ? json(200, userObj(who)) : json(401, { msg: 'no' });
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/rest/v1/rpc/company_available') return json(200, true);
    if (url.pathname === '/rest/v1/rpc/get_my_settlements') return json(200, settleRows);
    if (url.pathname === '/rest/v1/rpc/cancel_my_pickup') return json(200, true);
    if (url.pathname === '/rest/v1/profiles') {
      const rows = who ? [who.profile] : [];
      if ((headers['accept'] || '').includes('vnd.pgrst.object')) return rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' });
      return json(200, rows);
    }
    const table = url.pathname.replace('/rest/v1/', '');
    if (tables[table]) {
      let rows = tables[table].filter(r => !('seller_id' in r) || (who && r.seller_id === who.id));
      if (method === 'GET') return json(200, applyFilters(rows, url));
      if (method === 'POST') { const list = (Array.isArray(body) ? body : [body]).map(r => ({ id: 'n' + Math.random(), ...r, seller_id: who && who.id, created_at: new Date().toISOString() })); return json(201, list); }
      return json(200, []);
    }
    return json(200, []);
  });
}
const HIDE = '#bn-chat-btn,#bn-chat-box,#test-site-banner{display:none!important}';

async function newPage(context) {
  const page = await context.newPage();
  page.on('pageerror', e => { pageErrors.push(page.url().split('/').pop() + ': ' + e.message); });
  page.on('dialog', d => d.accept());
  await page.exposeFunction('__aiReply', () => ({ cached: false, platform: '스마트스토어', mapping: { header_row: 1, columns: { recipient: 2, phone: 3, phone2: -1, zipcode: 4, address: 5, address_detail: 6, product: 7, option: 8, qty: 9, memo: 10, order_no: 0 } } }));
  await page.addInitScript(() => {
    const orig = window.fetch;
    window.fetch = async (input, init = {}) => {
      const u = String(input);
      if (!u.startsWith('/api/')) return orig(input, init);
      const reply = u === '/api/order-ai' ? await window.__aiReply() : { status: 'sent' };
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  });
  return page;
}
async function go(page, url) { await page.goto(url); await page.addStyleTag({ content: HIDE }); await page.waitForTimeout(900); await page.addStyleTag({ content: HIDE }); }
const shot = (page, name, sel, opt = {}) => (sel ? page.locator(sel).first().screenshot({ path: path.join(OUT, name + '.png'), ...opt }) : page.screenshot({ path: path.join(OUT, name + '.png'), ...opt }));
async function login(page, email, pw) {
  await go(page, P('index.html'));
  await page.fill('#login-email', email); await page.fill('#login-pw', pw);
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  await page.addStyleTag({ content: HIDE });
}

module.exports = { setup, newPage, go, shot, login, P, OUT, tables, users, pageErrors, HIDE, NM };

if (require.main === module) (async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await setup(ctx);
  const page = await newPage(ctx);

  // 1. 로그인 · 회원가입
  await go(page, P('index.html'));
  await shot(page, '01_로그인', null);
  await page.evaluate(() => showSignupModal()); await page.waitForTimeout(400);
  await page.fill('#signup-company', '예시샵'); await page.click('#btn-signup-company-check'); await page.waitForTimeout(400);
  await page.fill('#signup-email', 'seller@example.com'); await page.fill('#signup-pw', 'abcd1234!'); await page.fill('#signup-pw-confirm', 'abcd1234!');
  await page.fill('#signup-name', '김예시'); await page.fill('#signup-phone', '010-1234-5678');
  await page.evaluate(() => { document.getElementById('signup-zipcode').value = '04563'; document.getElementById('signup-address').value = '서울 중구 마장로 1'; });
  await page.fill('#signup-detail-address', '3층 301호');
  const modal = page.locator('#signup-company').locator('xpath=ancestor::div[contains(@class,"max-w")][1]');
  await modal.evaluate(e => { e.style.maxHeight = 'none'; e.style.overflow = 'visible'; e.querySelectorAll('*').forEach(c => { if (getComputedStyle(c).overflowY === 'auto') { c.style.maxHeight = 'none'; c.style.overflow = 'visible'; } }); });
  await modal.screenshot({ path: path.join(OUT, '02_회원가입창.png') });
  await page.evaluate(() => typeof showKakaoDoneModal === 'function' && showKakaoDoneModal('회원가입 완료! (상호명: 예시샵)', '회원가입 했습니다\n상호: 예시샵\n연락처: 010-1234-5678')); await page.waitForTimeout(300);
  if (await page.isVisible('#kakao-done-modal')) await shot(page, '03_가입후_카톡안내', '#kakao-done-modal > div');
  await ctx.clearCookies();
  await page.evaluate(() => localStorage.clear());

  // 2. 승인 대기
  await login(page, 'wait@x.com', 'waitpass1');
  await shot(page, '04_승인대기', null);
  await page.evaluate(() => logout()); await page.waitForTimeout(800);
  await page.evaluate(() => localStorage.clear());

  // 3. 셀러 첫 화면
  await login(page, 'seller@x.com', 'password1');
  await shot(page, '05_셀러_첫화면', null);
  await shot(page, '06_상단메뉴', 'nav');
  await shot(page, '07_보관요청칸', '#keep-request-box');
  // 매장/사무실 택배접수
  await page.evaluate(() => switchSellerMode('store')); await page.waitForTimeout(300);
  await page.fill('#st-recipient', '예시샵').catch(() => {}); await page.fill('#st-phone', '010-1234-5678').catch(() => {});
  await page.evaluate(() => { const z = document.getElementById('st-zipcode'); if (z) { z.value = '04563'; document.getElementById('st-address').value = '서울 중구 마장로 1'; } });
  await page.fill('#st-detail-address', '3층 301호').catch(() => {});
  await page.fill('#st-bamnat-memo', '풀필먼트 출고건을 제외하고 나머지 상품을 보내주세요').catch(() => {});
  await shot(page, '08_매장사무실_접수', '#store-section');
  // 고객풀필먼트 단건
  await page.evaluate(() => switchSellerMode('fulfillment')); await page.waitForTimeout(300);
  await page.click('#reg-tab-single'); await page.waitForTimeout(200);
  await page.fill('#so-recipient', '홍길동'); await page.fill('#so-phone', '010-2222-3333');
  await page.fill('#so-product', '(합)울 와이드 팬츠 / 블랙 / 1개');
  await page.fill('#so-wholesale-company', '청평화 가나'); await page.fill('#so-wholesale-product', '울PT');
  await page.evaluate(() => { document.getElementById('so-zipcode').value = '06000'; document.getElementById('so-address').value = '서울 강남구 테헤란로 1'; });
  await page.fill('#so-detail-address', '101호'); await page.fill('#so-memo', '문 앞에 놓아주세요');
  await shot(page, '09_풀필먼트_단건', '#fulfillment-section');
  await page.click('#reg-tab-batch'); await page.waitForTimeout(200);
  await shot(page, '10_풀필먼트_엑셀일괄', '#fulfillment-section');
  // 쇼핑몰 주문서 그대로 올리기
  await page.click('#reg-tab-ai'); await page.waitForTimeout(200);
  await shot(page, '11_쇼핑몰주문서_올리기', '#fulfillment-section');
  const XLSX = require(path.join(NM, 'xlsx-js-style'));
  const aoa = [['스마트스토어 발주발송관리'],
    ['상품주문번호', '구매자명', '수취인명', '수취인연락처1', '우편번호', '기본배송지', '상세배송지', '상품명', '옵션정보', '수량', '배송메세지'],
    ['2026111000001', '홍구매', '홍길동', '010-2222-3333', '06000', '서울 강남구 테헤란로 1', '101호', '울 와이드 팬츠', '컬러: 블랙 / 사이즈: M', 1, '문 앞'],
    ['2026111000002', '홍구매', '홍길동', '010-2222-3333', '06000', '서울 강남구 테헤란로 1', '101호', '니트 머플러', '아이보리', 1, '문 앞'],
    ['2026111000003', '최구매', '정수진', '', '48000', '부산 해운대구 해운대로 3', '', '꽃무늬 원피스', '베이지', 1, '']];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '발주발송관리');
  const file = path.join(OUT, '..', 'guide-smartstore.xlsx'); XLSX.writeFile(wb, file);
  await page.setInputFiles('#ai-file-input', file); await page.waitForTimeout(1500);
  await page.addStyleTag({ content: HIDE });
  await shot(page, '12_쇼핑몰주문서_확인표', '#ai-result');
  // 주문 목록
  await page.evaluate(() => fetchOrdersFromDB && fetchOrdersFromDB()); await page.waitForTimeout(800);
  const listCard = page.locator('#seller-order-list').locator('xpath=ancestor::div[contains(@class,"bg-white")][1]');
  await listCard.screenshot({ path: path.join(OUT, '13_내접수주문목록.png') });
  // 내 정보
  await page.evaluate(() => openMyPage()); await page.waitForTimeout(500);
  const my = page.locator('#mypage-name').locator('xpath=ancestor::div[contains(@class,"max-w")][1]');
  await my.screenshot({ path: path.join(OUT, '14_내정보.png') }).catch(e => console.log('mypage', e.message));
  await page.evaluate(() => closeMyPage());
  // 사입팀 픽업요청
  await page.click('#nav-pickup-btn'); await page.waitForTimeout(1200);
  await page.fill('#pk-store-name', '가나'); await page.fill('#pk-store-location', '청평화 2층 A-12'); await page.fill('#pk-store-phone', '010-1111-0000');
  await page.check('input[name="pk-prepay"][value="yes"]'); await page.check('input[name="pk-misong"][value="yes"]');
  await page.fill('#pk-memo', '울PT 블랙 2장'); await page.check('#pk-agree');
  await shot(page, '15_픽업요청_접수', '#pickup-form');
  const pkList = page.locator('#pickup-my-list').locator('xpath=..');
  await pkList.screenshot({ path: path.join(OUT, '16_내픽업요청내역.png') });
  await shot(page, '15b_픽업요청_공지', '#pickup-screen > div:nth-child(2)');

  // 다른 화면들
  await go(page, P('stock.html')); await page.waitForTimeout(800);
  await shot(page, '17_재고확인', null, { fullPage: true });
  await go(page, P('usage.html')); await page.waitForTimeout(800);
  await shot(page, '18_이용현황', null, { fullPage: true });
  await go(page, P('products.html')); await page.waitForTimeout(800);
  await shot(page, '19_상품관리', null, { fullPage: true });

  // 휴대폰 화면
  const m = await browser.newContext({ ...require('/opt/node22/lib/node_modules/playwright').devices['iPhone 13'], locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await setup(m);
  const mp = await newPage(m);
  await go(mp, P('index.html'));
  await shot(mp, '20_휴대폰_로그인', null);
  await mp.fill('#login-email', 'seller@x.com'); await mp.fill('#login-pw', 'password1'); await mp.click('#btn-login'); await mp.waitForTimeout(1500);
  await mp.addStyleTag({ content: HIDE });
  await shot(mp, '21_휴대폰_첫화면', null);
  await mp.click('#nav-pickup-btn'); await mp.waitForTimeout(1200);
  await shot(mp, '22_휴대폰_픽업요청', null, { fullPage: true });

  await browser.close();
  console.log('saved to', OUT);
  console.log(pageErrors.length ? 'PAGE ERRORS:\n' + pageErrors.join('\n') : 'no page errors');
})();
