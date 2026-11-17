// [재고/상품/출고관리] 사용설명서(관리자용·셀러용)에 넣을 화면 캡처
// 가짜 Supabase · 가짜 데이터만 씁니다 (실제 DB 에 연결하지 않음, 개인정보 없음).
// 사용: cd tests && npm install && node guide-stock-shots.js [저장폴더]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx-js-style');

const NM = path.join(__dirname, 'node_modules');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, 'out', 'stock-guide');
const P = f => 'file://' + path.join(ROOT, f);
const LIB = {
  'xlsx-js-style': 'xlsx-js-style/dist/xlsx.bundle.js',
  'jszip': 'jszip/dist/jszip.min.js',
  'lucide': 'lucide/dist/umd/lucide.min.js',
  'supabase-js': '@supabase/supabase-js/dist/umd/supabase.js',
};
const norm = v => String(v ?? '').replace(/\s+/g, '').toLowerCase();
const pad = n => String(n).padStart(2, '0');
const kst = (d = new Date()) => new Date(d.getTime() + 9 * 3600000);
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const TODAY = ymd(kst()), YDAY = ymd(kst(new Date(Date.now() - 86400000)));
const ago = h => new Date(Date.now() - h * 3600000).toISOString();

const ids = { seller: '00000000-0000-0000-0000-00000000000a', seller2: '00000000-0000-0000-0000-00000000000b', admin: '00000000-0000-0000-0000-0000000000ad' };
const users = {
  'seller@x.com': { id: ids.seller, pw: 'password1', profile: { id: ids.seller, email: 'seller@example.com', company: '예시샵', name: '김예시', phone: '010-0000-0000', role: 'seller', status: 'approved', created_at: '2026-09-01T00:00:00Z' } },
  'seller2@x.com': { id: ids.seller2, pw: 'password2', profile: { id: ids.seller2, email: 'haru@example.com', company: '하루상회', name: '이하루', phone: '010-0000-0001', role: 'seller', status: 'approved', created_at: '2026-09-05T00:00:00Z' } },
  'admin@x.com': { id: ids.admin, pw: 'adminpass1', profile: { id: ids.admin, email: 'admin@example.com', company: '밤낮딜리버리', name: '관리자', phone: '', role: 'admin', status: 'approved', created_at: '2026-08-01T00:00:00Z' } },
};

// 사진 대신 색 상자 (가짜)
const photo = (bg, label) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="${bg}"/><text x="60" y="68" font-size="18" text-anchor="middle" fill="#fff" font-family="sans-serif">${label}</text></svg>`);
let codeSeq = 100;
const prod = (id, company, wc, wp, color, size, names, extra = {}) => ({ id, code: 'P' + String(++codeSeq).padStart(6, '0'), company, wholesale_company: wc, wholesale_product: wp, color, size,
  mall_names: names.map(([platform, name]) => ({ platform, name })), photo_url: '', memo: '', deleted_at: null, delete_requested_at: null, delete_request_reason: '', created_at: ago(300), updated_at: ago(300), ...extra });
const products = [
  prod(1, '예시샵', '청평화 가나', '울PT', '블랙', 'M', [['스마트스토어', '울 와이드 팬츠'], ['지그재그', '[당일출고] 울 팬츠']], { photo_url: photo('#1f2937', 'PANTS') }),
  prod(2, '예시샵', '디오트 다라', '머플러', '아이보리', 'F', [['지그재그', '니트 머플러']], { photo_url: photo('#d6c7a1', 'MUFFLER') }),
  prod(3, '예시샵', '신평화 마바', '플라워OPS', '베이지', 'F', [['스마트스토어', '꽃무늬 원피스']], { photo_url: photo('#c8a97e', 'DRESS') }),
  prod(4, '예시샵', '청평화 가나', '울PT', '그레이', 'M', [['스마트스토어', '울 와이드 팬츠']]),
  prod(5, '예시샵', 'apM 사아', '골지니트', '크림', 'F', [['에이블리', '골지 라운드 니트']], { delete_requested_at: ago(5), delete_request_reason: '판매 종료한 상품입니다' }),
  prod(6, '하루상회', '남평화 자차', '레더백', '브라운', 'F', [['에이블리', '미니 레더백']], { photo_url: photo('#7c4a2d', 'BAG') }),
  prod(7, '하루상회', '남평화 자차', '레더백', '블랙', 'F', []),
  prod(8, '하루상회', '테크노 카타', '와이드데님', '연청', 'S', [['쿠팡', '와이드 데님 팬츠']]),
  prod(9, '모노룸', '청평화 하파', '셔츠원피스', '화이트', 'F', [['카페24', '린넨 셔츠 원피스']]),
];
const inv = (product_id, a, b, d, location) => ({ product_id, company: products.find(p => p.id === product_id).company, qty_a: a, qty_b: b, qty_defect: d, location, memo: '' });
const O = (n, company, product, qty, extra = {}) => ({ id: 'ORD-' + n, seller_company: company, recipient: ['홍길동', '김철수', '이영희', '박민수', '최지우', '정하나'][n % 6], product, qty, order_no: 100 + n, item_no: 1,
  created_at: ago(6 - n * 0.5), order_type: 'fulfillment', ship_status: '미출고', wholesale_company: '', wholesale_product: '', ...extra });
const S = (id, company, wc, wp, retail, color, size, quantity, location, stocked_on, extra = {}) => ({ id, company, wholesale_company: wc, wholesale_product: wp, retail_product: retail, color, size, quantity, location, stocked_on, shipped_on: null, shipped_note: '', customer: '', label: '', memo: '', ...extra });

const tables = {
  products,
  inventory: [inv(1, 3, 2, 0, 'A-1'), inv(2, 1, 0, 1, 'A-2'), inv(3, 0, 2, 0, 'A-3'), inv(4, 2, 0, 0, 'A-1'), inv(6, 4, 0, 0, 'B-1'), inv(7, 0, 1, 0, 'B-1'), inv(8, 2, 0, 1, 'B-2'), inv(9, 1, 3, 0, 'C-1')],
  inventory_moves: [],
  product_logs: [
    { id: 2, product_id: 1, action: '수정', actor_name: '김예시', at: ago(40), before: { mall_names: [{ platform: '스마트스토어', name: '울 와이드 팬츠' }] }, after: { mall_names: [{ platform: '스마트스토어', name: '울 와이드 팬츠' }, { platform: '지그재그', name: '[당일출고] 울 팬츠' }] } },
    { id: 1, product_id: 1, action: '등록', actor_name: '김예시', at: ago(300), before: null, after: null },
  ],
  product_aliases: [], order_stock_picks: [],
  orders: [
    O(1, '예시샵', '울 와이드 팬츠 / 블랙 / M', 1),
    O(2, '예시샵', '니트 머플러', 2),
    O(3, '예시샵', '꽃무늬 원피스', 1),
    O(4, '하루상회', '미니 레더백', 1),
    O(5, '하루상회', '와이드 데님 팬츠', 1),
    O(6, '하루상회', '가을 가디건 (오트밀)', 1),
  ],
  stock_items: [
    S(1, '예시샵', '청평화 가나', '울PT', '울 와이드 팬츠', '블랙', 'M', 3, 'A-1', '2026-11-05', { label: 'o' }),
    S(2, '예시샵', '신평화 마바', '플라워OPS', '꽃무늬 원피스', '베이지', 'F', 1, 'A-3', '2026-11-03', { customer: '반품 이영희' }),
    S(3, '예시샵', '디오트 다라', '머플러', '니트 머플러', '아이보리', 'F', 1, 'A-2', '2026-10-28', { shipped_on: '2026-11-02' }),
    S(4, '예시샵', '청평화 가나', '울PT', '울 와이드 팬츠', '그레이', 'M', 2, 'A-1', '2026-10-30'),
    S(5, '하루상회', '남평화 자차', '레더백', '미니 레더백', '브라운', 'F', 4, 'B-1', '2026-11-04'),
    S(6, '하루상회', '테크노 카타', '와이드데님', '와이드 데님 팬츠', '연청', 'S', 2, 'B-2', '2026-11-01'),
    S(7, '하루상회', '남평화 자차', '레더백', '', '블랙', 'F', 1, 'B-1', '2026-10-25', { shipped_note: '11/6매장반품' }),
    S(8, '모노룸', '청평화 하파', '셔츠원피스', '린넨 셔츠 원피스', '화이트', 'F', 4, 'C-1', '2026-11-02'),
  ],
  stock_visibility: [{ company_key: '*', company: '', hidden: false }, { company_key: norm('모노룸'), company: '모노룸', hidden: true }],
  orders_dummy: [], couriers: [], address_book: [], pickup_requests: [], settlements: [], settle_contacts: [],
};
// 재고 증감 내역용: 최근 7일 기록 (가짜)
{
  const at = (d, h) => new Date(Date.now() - d * 86400000 - (new Date().getUTCHours() + 9) % 24 * 3600000 + h * 3600000).toISOString();
  let mid = 10;
  const mv = (d, h, pid, kind, da, db, dd, reason) => { const p = products.find(x => x.id === pid);
    tables.inventory_moves.push({ id: mid++, product_id: pid, company: p.company, code: p.code, kind, d_a: da, d_b: db, d_defect: dd, a_after: 0, b_after: 0, defect_after: 0, reason, actor_name: '관리자', at: at(d, h) }); };
  mv(6, 11, 1, '입고', 0, 4, 0, '사입 입고'); mv(6, 11, 6, '입고', 0, 5, 0, '사입 입고'); mv(6, 15, 1, '라벨완료', 4, -4, 0, '');
  mv(5, 10, 8, '입고', 0, 3, 0, '사입 입고'); mv(5, 16, 8, '라벨완료', 3, -3, 0, ''); mv(5, 17, 6, '라벨완료', 5, -5, 0, '');
  mv(4, 9, 1, '출고', -1, 0, 0, '주문 출고확정'); mv(4, 9, 6, '출고', -1, 0, 0, '주문 출고확정'); mv(4, 18, 2, '조정', 0, 0, 1, '검수 중 불량 발견');
  mv(3, 9, 8, '출고', -1, 0, 0, '주문 출고확정'); mv(3, 13, 3, '입고', 0, 2, 0, '반품 입고'); mv(3, 14, 9, '입고', 0, 3, 0, '사입 입고');
  mv(2, 9, 4, '최종재고', 2, 0, 0, '11월 최종재고'); mv(2, 9, 7, '최종재고', 0, 1, 0, '11월 최종재고');
  mv(1, 9, 1, '출고', -2, 0, 0, '주문 출고확정'); mv(1, 9, 8, '출고', -1, 0, 0, '주문 출고확정'); mv(1, 17, 2, '입고', 0, 1, 0, '사입 입고'); mv(1, 17, 2, '라벨완료', 1, -1, 0, '');
  mv(0, 9, 6, '출고', -1, 0, 0, '주문 출고확정'); mv(0, 10, 1, '조정', -1, 0, 0, '재고 실사: 1개 부족'); mv(0, 10, 9, '입고', 0, 1, 0, '사입 입고');
}
// 바뀐 뒤 재고: 지금 재고에서 거꾸로 계산, 최신순 정렬
{
  const list = tables.inventory_moves.sort((x, y) => y.at.localeCompare(x.at));
  const cur = new Map(tables.inventory.map(r => [r.product_id, { a: r.qty_a, b: r.qty_b, d: r.qty_defect }]));
  for (const m of list) {
    const c = cur.get(m.product_id) || { a: 0, b: 0, d: 0 };
    m.a_after = c.a; m.b_after = c.b; m.defect_after = c.d;
    cur.set(m.product_id, { a: Math.max(0, c.a - m.d_a), b: Math.max(0, c.b - m.d_b), d: Math.max(0, c.d - m.d_defect) });
  }
}
const day = { day: TODAY, now_kst: TODAY + 'T10:30:00', confirmed_at: null, confirmer: null, auto: false, times: 0, changes_after: 0, last_day: YDAY, last_confirmed_at: YDAY + 'T09:40:00Z' };
let sellerStockVisible = true;

const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenFor = u => b64url({ alg: 'HS256', typ: 'JWT' }) + '.' + b64url({ sub: u.id, email: u.profile.email, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated', aud: 'authenticated' }) + '.sig';
const userObj = u => ({ id: u.id, email: u.profile.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: u.meta || {}, created_at: '2026-01-01T00:00:00Z' });
function whoFrom(headers) {
  const parts = (headers['authorization'] || '').replace('Bearer ', '').split('.');
  if (parts.length !== 3) return null;
  try { const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); return Object.values(users).find(u => u.id === p.sub) || null; } catch { return null; }
}
function applyFilters(rows, url) {
  for (const [k, v] of url.searchParams) {
    if (['select', 'order', 'offset', 'limit', 'columns', 'on_conflict'].includes(k)) continue;
    if (v.startsWith('eq.')) rows = rows.filter(r => String(r[k]) === decodeURIComponent(v.slice(3)));
    else if (v.startsWith('gte.')) rows = rows.filter(r => String(r[k]) >= new Date(decodeURIComponent(v.slice(4))).toISOString());
    else if (v.startsWith('lt.')) rows = rows.filter(r => String(r[k]) < new Date(decodeURIComponent(v.slice(3))).toISOString());
    else if (v === 'is.null') rows = rows.filter(r => r[k] == null);
    else if (v.startsWith('in.(')) { const list = decodeURIComponent(v.slice(4, -1)).split(',').map(x => x.replace(/^"|"$/g, '')); rows = rows.filter(r => list.includes(String(r[k]))); }
  }
  return rows;
}
fs.mkdirSync(OUT, { recursive: true });
const pageErrors = [];

async function setup(context) {
  await context.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (['file:', 'about:', 'data:'].includes(url.protocol)) return route.continue();
    const lib = Object.entries(LIB).find(([k]) => req.url().includes(k));
    if (lib) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(NM, lib[1])) });
    if (!url.hostname.endsWith('supabase.co')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    const method = req.method(); const headers = req.headers();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
    if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: cors });
    let body = null; try { body = req.postDataJSON(); } catch { body = null; }
    const json = (status, data) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const who = whoFrom(headers);
    const isAdmin = who && who.profile.role === 'admin';
    if (url.pathname === '/auth/v1/token') {
      const u = users[body.email];
      if (!u || u.pw !== body.password) return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials' });
      return json(200, { access_token: tokenFor(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: userObj(u) });
    }
    if (url.pathname === '/auth/v1/user') {
      if (!who) return json(401, { msg: 'no' });
      if (method === 'PUT' && body && body.data) who.meta = { ...(who.meta || {}), ...body.data };
      return json(200, userObj(who));
    }
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = url.pathname.slice('/rest/v1/rpc/'.length);
      if (fn === 'inventory_today') return json(200, day);
      if (fn === 'my_stock_visible') return json(200, sellerStockVisible);
      if (fn === 'stock_hidden_for') return json(200, false);
      if (fn === 'inventory_move') {
        const r = tables.inventory.find(x => x.product_id === body.p_product_id);
        if (r) { r.qty_a += body.p_da || 0; r.qty_b += body.p_db || 0; r.qty_defect += body.p_dd || 0; }
        return json(200, r || {});
      }
      if (fn === 'inventory_confirm') { day.confirmed_at = new Date().toISOString(); day.confirmer = '관리자'; day.times = 1; return json(200, true); }
      return json(200, true);
    }
    if (url.pathname === '/rest/v1/profiles') {
      const all = Object.values(users).map(u => u.profile);
      let rows = isAdmin ? all : who ? [who.profile] : [];
      rows = applyFilters(rows, url);
      if ((headers['accept'] || '').includes('vnd.pgrst.object')) return rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' });
      return json(200, rows);
    }
    const table = url.pathname.replace('/rest/v1/', '');
    if (tables[table]) {
      // 셀러는 자기 상호 줄만 (DB 규칙 흉내)
      let rows = tables[table].filter(r => isAdmin || !('company' in r) || (who && norm(r.company) === norm(who.profile.company)));
      if (method === 'GET') { rows = applyFilters(rows, url); if ((headers['accept'] || '').includes('vnd.pgrst.object')) return json(200, rows[0] || null); return json(200, rows); }
      if (method === 'POST') { const list = (Array.isArray(body) ? body : [body]).map(r => ({ id: Math.floor(Math.random() * 1e6), ...r, created_at: new Date().toISOString() })); tables[table].push(...list); return json(201, list); }
      if (method === 'PATCH') { const hit = applyFilters(rows, url); hit.forEach(r => Object.assign(r, body)); return json(200, hit); }
      return json(200, []);
    }
    return json(200, []);
  });
}
const HIDE = '#bn-chat-btn,#bn-chat-box,#test-site-banner{display:none!important}';

async function newPage(context) {
  const page = await context.newPage();
  page.on('pageerror', e => { pageErrors.push(page.url().split('/').pop() + ': ' + e.message); });
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? (page.__prompt || '') : undefined));
  return page;
}
async function go(page, url, wait = 1000) { await page.goto(url); await page.addStyleTag({ content: HIDE }); await page.waitForTimeout(wait); }
const file = name => path.join(OUT, name + '.png');
async function shot(page, name, sel, opt = {}) {
  if (sel) await page.locator(sel).first().screenshot({ path: file(name), ...opt });
  else await page.screenshot({ path: file(name), ...opt });
  console.log('찍음', name);
}
async function login(page, email, pw) {
  await go(page, P('index.html'));
  await page.fill('#login-email', email); await page.fill('#login-pw', pw);
  await page.click('#btn-login'); await page.waitForTimeout(1800);
  await page.addStyleTag({ content: HIDE });
}
// 화면 안의 칸(iframe) 내용에도 숨김 스타일
async function frameOf(page, id) { const f = page.frame({ url: u => String(u).includes(id) }); return f; }
// 강조 표시 (빨간 테두리)
async function mark(target, sel, on = true) {
  await target.evaluate(([s, o]) => document.querySelectorAll(s).forEach(el => { el.style.outline = o ? '3px solid #ef4444' : ''; el.style.outlineOffset = o ? '2px' : ''; }), [sel, on]);
}
async function download(page, click) {
  const [d] = await Promise.all([page.waitForEvent('download'), click()]);
  const p = path.join(OUT, '..', 'dl_' + d.suggestedFilename());
  await d.saveAs(p);
  return p;
}

(async () => {
  const browser = await chromium.launch();
  const mk = async (opt = {}) => { const c = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2, locale: 'ko-KR', timezoneId: 'Asia/Seoul', acceptDownloads: true, ...opt }); await setup(c); return c; };

  // ================= 관리자 =================
  const actx = await mk();
  const a = await newPage(actx);
  await login(a, 'admin@x.com', 'adminpass1');
  await a.click('#admin-group-stock'); await a.waitForTimeout(1500);
  await a.addStyleTag({ content: HIDE });
  // 메뉴 위치
  await mark(a, '#admin-group-stock');
  await shot(a, 'a_menu', null, { clip: { x: 0, y: 0, width: 1360, height: 330 } });
  await mark(a, '#admin-group-stock', false);

  // 1. 재고관리 탭
  await shot(a, 'a1_hide_box', '#stock-hide-box');
  await a.fill('#stock-hide-q', '하루'); await a.waitForTimeout(300);
  await shot(a, 'a1_hide_search', '#stock-hide-box');
  await a.fill('#stock-hide-q', ''); await a.waitForTimeout(200);
  await a.evaluate(() => renderStockHide());
  const stockCard = '#admin-stock-panel > div:nth-child(2)';
  await shot(a, 'a1_stock_list', stockCard);
  await shot(a, 'a1_company_summary', '#admin-stock-panel > div:nth-child(3)');
  // 업체 고르기 → 미리보기 버튼
  await a.selectOption('#stock-f-company', { index: 1 }); await a.waitForTimeout(300);
  await a.evaluate(() => { const c = document.querySelectorAll('#stock-list input[type=checkbox]'); if (c[0]) { c[0].checked = true; c[0].dispatchEvent(new Event('change')); } });
  await mark(a, '#stock-preview-btn');
  await shot(a, 'a1_company_pick', stockCard);
  await mark(a, '#stock-preview-btn', false);
  await a.evaluate(() => openStockEdit(null)); await a.waitForTimeout(400);
  await shot(a, 'a1_stock_add', '#stock-edit-modal > *');
  await a.evaluate(() => closeStockEdit());

  // 2. 상품관리 탭 (화면 안 칸)
  await a.click('#admin-tab-products'); await a.waitForTimeout(2500);
  await shot(a, 'a2_products_tab', null);
  const pf = a.frame({ url: u => String(u).includes('products.html') });
  await pf.addStyleTag({ content: HIDE });
  await shot(pf, 'a2_products_list', '#app > div');
  await pf.evaluate(() => openEdit(1)); await pf.waitForTimeout(400);
  await shot(pf, 'a2_product_edit', '#edit-modal > form');
  await pf.evaluate(() => closeModal('edit-modal'));
  await pf.evaluate(() => openLogs(1)); await pf.waitForTimeout(500);
  await shot(pf, 'a2_product_logs', '#log-modal > *');
  await pf.evaluate(() => closeModal('log-modal'));
  // 삭제 요청
  await pf.selectOption('#f-status', 'requested'); await pf.waitForTimeout(300);
  await shot(pf, 'a2_delete_requests', '#app > div');
  await pf.selectOption('#f-status', 'active'); await pf.waitForTimeout(200);

  // 상품관리 단독 화면 (엑셀 등록 확인창용)
  const ap = await newPage(actx);
  await go(ap, P('products.html'), 1500);
  const formPath = await download(ap, () => ap.click('text=등록 양식 받기'));
  {
    const wb = XLSX.readFile(formPath); const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const head = rows[0];
    const row = o => head.map(h => o[String(h).replace(/\s|\*/g, '')] ?? '');
    const data = [head,
      row({ 거래처명: '예시샵', 도매업체명: '청평화 가나', 도매상품명: '울PT', 컬러: '블랙', 사이즈: 'M', 플랫폼: '에이블리', 쇼핑몰상품명: '울 와이드 슬랙스' }),
      row({ 거래처명: '예시샵', 도매업체명: '디오트 라마', 도매상품명: '케이블가디건', 컬러: '오트밀', 사이즈: 'F', 플랫폼: '스마트스토어', 쇼핑몰상품명: '케이블 가디건' }),
      row({ 거래처명: '하루상회', 도매업체명: '남평화 자차', 도매상품명: '토트백', 컬러: '카멜', 사이즈: 'F', 플랫폼: '쿠팡', 쇼핑몰상품명: '데일리 토트백' })];
    console.log('양식 머리줄:', head.join(','));
    const up = path.join(OUT, '..', 'up_products.xlsx');
    const nwb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(nwb, XLSX.utils.aoa_to_sheet(data), wb.SheetNames[0]); XLSX.writeFile(nwb, up);
    await ap.setInputFiles('#upload-input', up); await ap.waitForTimeout(800);
    await shot(ap, 'a2_products_upload', '#upload-modal > *');
    await ap.evaluate(() => closeModal('upload-modal'));
  }

  // 3. 재고표 탭
  await a.click('#admin-tab-inventory'); await a.waitForTimeout(2500);
  const inf = a.frame({ url: u => String(u).includes('inventory.html') });
  await inf.addStyleTag({ content: HIDE });
  await shot(inf, 'a3_inventory_top', '#app');
  // 수량 바꾸기 → 저장 줄
  await inf.evaluate(() => { bump(1, 'a', -1); });
  await inf.waitForTimeout(300);
  await inf.fill('#save-reason', '재고 실사: 1개 부족');
  const ai = await newPage(actx);
  await go(ai, P('inventory.html'), 1500);
  await ai.evaluate(() => { bump(1, 'a', -1); }); await ai.waitForTimeout(200);
  await ai.fill('#save-reason', '재고 실사: 1개 부족');
  await shot(ai, 'a3_inventory_edit', null);
  await ai.evaluate(() => resetPending()); await ai.waitForTimeout(200);
  await ai.evaluate(() => openIntake()); await ai.waitForTimeout(300);
  await ai.fill('#i-company', '예시샵'); await ai.fill('#i-name', '울 와이드'); await ai.evaluate(() => suggest()); await ai.waitForTimeout(300);
  await shot(ai, 'a3_intake_search', '#intake-modal > *');
  await ai.evaluate(() => { const b = document.querySelector('#i-suggest button'); if (b) b.click(); }); await ai.waitForTimeout(300);
  await ai.fill('#i-qty', '3'); await ai.fill('#i-location', 'A-1'); await ai.fill('#i-reason', '사입 입고');
  await shot(ai, 'a3_intake_picked', '#intake-modal > *');
  await ai.evaluate(() => closeModal('intake-modal'));
  await ai.evaluate(() => openLogs(1)); await ai.waitForTimeout(500);
  await shot(ai, 'a3_inventory_logs', '#log-modal > *');
  await ai.evaluate(() => closeModal('log-modal'));
  // 최종재고 올리기
  const tplPath = await download(ai, () => ai.click('text=최종재고 양식 받기'));
  {
    const wb = XLSX.readFile(tplPath); const name = wb.SheetNames.includes('최종재고') ? '최종재고' : wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
    const h = rows[0].map(x => String(x).replace(/\s+/g, ''));
    console.log('최종재고 머리줄:', h.join(','));
    const ia = h.indexOf('상품화수량'), ib = h.indexOf('미상품화수량');
    rows.slice(1).forEach((r, i) => { if (ia >= 0 && r[ia] !== '' && i % 2 === 0) r[ia] = Number(r[ia] || 0) + 1; });
    const ic = h.indexOf('거래처명'), iw = h.indexOf('도매업체명'), ip = h.indexOf('도매상품명'), icol = h.indexOf('컬러'), isz = h.indexOf('사이즈');
    const extra = new Array(h.length).fill(''); extra[ic] = '예시샵'; extra[iw] = '디오트 라마'; extra[ip] = '케이블가디건'; if (icol >= 0) extra[icol] = '오트밀'; if (isz >= 0) extra[isz] = 'F'; if (ib >= 0) extra[ib] = 2;
    rows.push(extra);
    const up = path.join(OUT, '..', 'up_final.xlsx');
    const nwb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(nwb, XLSX.utils.aoa_to_sheet(rows), '최종재고'); XLSX.writeFile(nwb, up);
    await ai.setInputFiles('#upload-input', up); await ai.waitForTimeout(800);
    await shot(ai, 'a3_final_upload', '#upload-modal > *');
    await ai.evaluate(() => closeModal('upload-modal'));
  }
  // 확정 후 띠
  day.confirmed_at = ago(0.2); day.confirmer = '관리자'; day.times = 1;
  await go(ai, P('inventory.html'), 1500);
  await shot(ai, 'a3_confirmed', '#day-banner');
  day.confirmed_at = null; day.times = 0;

  // 4. 재고출고 탭
  await a.click('#admin-tab-picking'); await a.waitForTimeout(2500);
  const pk = await newPage(actx);
  await go(pk, P('picking.html'), 1800);
  await shot(pk, 'a4_picking_top', '#app > div:nth-child(1)');
  await shot(pk, 'a4_picking_check', '#check-box');
  await shot(pk, 'a4_picking_pick', '#app > div:nth-child(3)');
  await shot(pk, 'a4_picking_buy', '#app > div:nth-child(4)');
  await shot(pk, 'a4_picking_full', null, { fullPage: true });

  // 업체 화면 미리보기 (재고 확인)
  const pv = await newPage(actx);
  await pv.setViewportSize({ width: 1000, height: 760 });
  await go(pv, P('stock.html') + '?company=' + encodeURIComponent('예시샵'), 1500);
  await shot(pv, 'a5_preview_stock', null);
  await go(pv, P('products.html') + '?company=' + encodeURIComponent('예시샵'), 1500);
  await shot(pv, 'a5_preview_products', null);

  // 5. 재고 증감 내역 탭
  await a.click('#admin-tab-history'); await a.waitForTimeout(2500);
  await a.addStyleTag({ content: HIDE });
  await mark(a, '#admin-tab-history');
  await shot(a, 'a6_history_tab', null, { clip: { x: 0, y: 0, width: 1360, height: 900 } });
  await mark(a, '#admin-tab-history', false);
  const hs = await newPage(actx);
  await go(hs, P('stock-history.html'), 1500);
  await hs.click('#quick-range button[data-range="7"]'); await hs.waitForTimeout(800);
  await shot(hs, 'a6_history_day', '#app');
  await hs.click('#view-tabs button[data-view="company"]'); await hs.waitForTimeout(400);
  await shot(hs, 'a6_history_company', '#app > div:nth-child(3)');
  await hs.click('#view-tabs button[data-view="product"]'); await hs.waitForTimeout(400);
  await shot(hs, 'a6_history_product', '#app > div:nth-child(3)');
  await hs.click('#view-tabs button[data-view="detail"]'); await hs.waitForTimeout(400);
  await shot(hs, 'a6_history_detail', '#app > div:nth-child(3)');
  await hs.click('#view-tabs button[data-view="company"]'); await hs.waitForTimeout(300);
  await hs.locator('#tbody tr').first().click(); await hs.waitForTimeout(500);
  await shot(hs, 'a6_history_focus', '#app > div:nth-child(3)');
  await actx.close();

  // ================= 셀러 =================
  const sctx = await mk();
  const s = await newPage(sctx);
  await login(s, 'seller@x.com', 'password1');
  await mark(s, '#nav-stock-btn'); await mark(s, '#nav-history-btn'); await mark(s, '#nav-products-btn');
  await shot(s, 's_nav', null, { clip: { x: 0, y: 0, width: 1360, height: 260 } });
  await mark(s, '#nav-stock-btn', false); await mark(s, '#nav-history-btn', false); await mark(s, '#nav-products-btn', false);
  await go(s, P('stock-history.html'), 1500);
  await s.click('#quick-range button[data-range="7"]'); await s.waitForTimeout(800);
  await shot(s, 's3_history_day', '#app');
  await s.click('#view-tabs button[data-view="detail"]'); await s.waitForTimeout(400);
  await shot(s, 's3_history_detail', '#app > div:nth-child(3)');
  await s.setViewportSize({ width: 1000, height: 760 });
  await go(s, P('stock.html'), 1500);
  await shot(s, 's1_stock_kept', null);
  await s.click('#tab-shipped'); await s.waitForTimeout(300);
  await shot(s, 's1_stock_shipped', null);
  sellerStockVisible = false;
  await go(s, P('stock.html'), 1200);
  await shot(s, 's1_stock_hidden', null, { clip: { x: 0, y: 0, width: 1000, height: 330 } });
  sellerStockVisible = true;
  await s.setViewportSize({ width: 1360, height: 900 });
  await go(s, P('products.html'), 1500);
  await shot(s, 's2_products_list', '#app > div');
  await s.evaluate(() => openEdit(null)); await s.waitForTimeout(300);
  await s.fill('#e-wholesale_company', '디오트 라마'); await s.fill('#e-wholesale_product', '케이블가디건');
  await s.fill('#e-color', '오트밀'); await s.fill('#e-size', 'F');
  await s.evaluate(() => { const r = document.querySelectorAll('#e-names input'); if (r[0]) r[0].value = '스마트스토어'; if (r[1]) r[1].value = '케이블 가디건'; });
  await shot(s, 's2_product_add', '#edit-modal > form');
  await s.evaluate(() => closeModal('edit-modal'));
  await s.evaluate(() => openEdit(2)); await s.waitForTimeout(300);
  await mark(s, '#e-request');
  await shot(s, 's2_product_edit', '#edit-modal > form');
  await s.evaluate(() => closeModal('edit-modal'));
  // 휴대폰
  const mctx = await mk({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await newPage(mctx);
  await login(m, 'seller@x.com', 'password1');
  await go(m, P('stock.html'), 1500);
  await shot(m, 's1_stock_mobile', null);
  await go(m, P('stock-history.html') + '?range=7', 1800);
  await shot(m, 's3_history_mobile', null);
  await go(m, P('products.html'), 1500);
  await shot(m, 's2_products_mobile', null);

  console.log(pageErrors.length ? '화면 오류:\n' + pageErrors.join('\n') : '화면 오류 없음');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
