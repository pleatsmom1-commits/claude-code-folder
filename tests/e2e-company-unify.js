// 상호통일 (company-unify.html + 관리자 [상호통일] 탭 + 상품관리·재고표·재고출고 연결) E2E
// 실제 Supabase 대신 메모리 속 가짜 서버를 씁니다. 사용: cd tests && npm install && node e2e-company-unify.js [그림폴더]
//  ROOT_DIR=다른폴더 로 바꾸기 전 화면도 찍을 수 있습니다 (BEFORE=1 이면 탭 줄 그림만).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const NM = path.join(__dirname, 'node_modules');
const ROOT = process.env.ROOT_DIR || path.join(__dirname, '..');
const BEFORE = !!process.env.BEFORE;
const INDEX = 'file://' + path.join(ROOT, 'index.html') + '?test';
const PAGE = 'file://' + path.join(ROOT, 'company-unify.html');
const SHOTS = process.argv[2] || '';
const LIB = {
  'xlsx-js-style': 'xlsx-js-style/dist/xlsx.bundle.js',
  'jszip': 'jszip/dist/jszip.min.js',
  'lucide': 'lucide/dist/umd/lucide.min.js',
  'supabase-js': '@supabase/supabase-js/dist/umd/supabase.js',
};
const ids = { seller: '00000000-0000-0000-0000-00000000000a', admin: '00000000-0000-0000-0000-0000000000ad' };
const users = {
  'seller@x.com': { id: ids.seller, pw: 'password1', profile: { id: ids.seller, email: 'seller@x.com', company: '미닛걸', name: '김', phone: '', role: 'seller', status: 'approved', created_at: '2026-09-01T00:00:00Z' } },
  'admin@x.com': { id: ids.admin, pw: 'adminpass1', profile: { id: ids.admin, email: 'admin@x.com', company: '밤낮', name: '관리', phone: '', role: 'admin', status: 'approved', created_at: '2026-08-01T00:00:00Z' } },
};
const norm = v => String(v || '').replace(/\s/g, '').toLowerCase();
const P = (id, company, wc, wp, color, size, mall) => ({ id, code: 'P' + String(id).padStart(6, '0'), company, wholesale_company: wc, wholesale_product: wp, color, size, mall_names: mall ? [{ platform: '스마트스토어', name: mall }] : [], memo: '', photo_url: '', deleted_at: null, delete_requested_at: null });
const products = [
  P(1, '에스비컴퍼니', '도매A', '꽃니트', '검정', 'F', '플라워 니트'),
  P(2, '에스비컴퍼니', '도매A', '꽃니트', '아이보리', 'F', '플라워 니트'),
  P(3, '미닛걸', '도매B', '와이드 데님', '연청', 'M', '데일리 와이드진'),
  P(4, '하루상회', '도매C', '진주 목걸이', '', '', '진주 레이어드 목걸이'),
];
const inventory = products.map(p => ({ product_id: p.id, company: p.company, qty_a: 3, qty_b: 0, qty_defect: 0, location: '', memo: '' }));
const aliases = [];
let aid = 1;
const tables = { orders: [], couriers: [], address_book: [], pickup_requests: [], settlements: [], settle_contacts: [], products, inventory, inventory_moves: [], product_aliases: [], order_stock_picks: [], inventory_days: [], company_aliases: aliases };
const mainOf = c => { const a = aliases.find(r => norm(r.alias) === norm(c)); return a ? a.main : c; };

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
    else if (v.startsWith('in.(')) { const set = decodeURIComponent(v.slice(4, -1)).split(',').map(x => x.replace(/"/g, '')); rows = rows.filter(r => set.includes(String(r[k]))); }
    else if (v === 'is.null') rows = rows.filter(r => r[k] == null);
  }
  return rows;
}
const applyCalls = [];

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.protocol === 'file:') return route.continue();
    const lib = Object.entries(LIB).find(([k]) => req.url().includes(k));
    if (lib) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(NM, lib[1])) });
    if (!url.hostname.endsWith('supabase.co')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    const method = req.method(), headers = req.headers();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
    if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: cors });
    let body = null; try { body = req.postDataJSON(); } catch { body = null; }
    const json = (status, data) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const who = whoFrom(headers);
    const isAdmin = who && who.profile.role === 'admin';
    const wantsObject = (headers['accept'] || '').includes('vnd.pgrst.object');
    if (url.pathname === '/auth/v1/token') {
      const u = users[body.email];
      if (!u || u.pw !== body.password) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
      return json(200, { access_token: tokenFor(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: userObj(u) });
    }
    if (url.pathname === '/auth/v1/user') return who ? json(200, userObj(who)) : json(401, { msg: 'no' });
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/rest/v1/profiles') {
      const rows = applyFilters(Object.values(users).map(u => u.profile).filter(p => isAdmin || (who && p.id === who.id)), url);
      if (wantsObject) return rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' });
      return json(200, rows);
    }
    if (url.pathname === '/rest/v1/rpc/company_unify_counts') {
      const m = new Map();
      products.filter(p => !p.deleted_at).forEach(p => { const k = norm(p.company); const r = m.get(k) || { company: p.company, products: 0, stock: 0 }; r.products++; const i = inventory.find(x => x.product_id === p.id); r.stock += i ? i.qty_a + i.qty_b + i.qty_defect : 0; m.set(k, r); });
      return json(200, [...m.values()]);
    }
    if (url.pathname === '/rest/v1/rpc/company_unify_apply') {
      applyCalls.push(body);
      let n = 0;
      products.forEach(p => { const m = mainOf(p.company); if (m !== p.company) { p.company = m; n++; } });
      inventory.forEach(i => { i.company = products.find(p => p.id === i.product_id).company; });
      return body.p_merge ? json(200, { products: 0, inventory: 0, moves: 2, other: 0, dups: [{ code: 'P000009', into: 'P000003', qty: 4 }], waiting: [] })
        : json(200, { products: n, inventory: n, moves: 0, other: 0, dups: [], waiting: [{ code: 'P000009', into: 'P000003', name: '도매A 꽃니트 검정 F', qty: 4 }] });
    }
    if (url.pathname === '/rest/v1/rpc/my_stock_visible') return json(200, true);
    if (url.pathname === '/rest/v1/rpc/stock_terms_status') return json(200, true);
    if (url.pathname.startsWith('/rest/v1/rpc/')) return json(200, null);
    const t = url.pathname.replace('/rest/v1/', '');
    if (t === 'company_aliases') {
      if (!isAdmin) return json(200, []);
      if (method === 'POST') { const r = { id: aid++, alias: body.alias, main: body.main, memo: body.memo || '', created_at: new Date().toISOString() }; aliases.push(r); return json(201, [r]); }
      if (method === 'DELETE') { const id = Number(url.searchParams.get('id').slice(3)); const i = aliases.findIndex(r => r.id === id); if (i >= 0) aliases.splice(i, 1); return json(204, []); }
      return json(200, applyFilters(aliases, url));
    }
    if (tables[t] && method === 'GET') return json(200, applyFilters(tables[t].filter(r => isAdmin || norm(r.company) === norm(who && who.profile.company)), url));
    return json(200, []);
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => { pageErrors.push(e.message); console.log('PAGE ERROR:', e.message); });
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  const results = [];
  const check = (name, cond, extra = '') => { const l = `${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`; results.push(l); console.log(l); };
  const shot = async (name, p = page, opts = {}) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name), ...opts }); };
  const login = async (email, pw, admin) => {
    await page.goto(INDEX); await page.waitForTimeout(800);
    if (admin) await page.click('#tab-btn-admin');
    await page.fill('#login-email', email); await page.fill('#login-pw', pw);
    await page.click('#btn-login'); await page.waitForTimeout(1800);
  };

  await login('admin@x.com', 'adminpass1', true);
  check('admin dashboard shows', await page.isVisible('#admin-dashboard'));
  await page.click('#admin-group-stock'); await page.waitForTimeout(300);
  await page.click('#admin-tab-products'); await page.waitForTimeout(1500);
  if (BEFORE) {
    await shot('전_재고메뉴_상품관리.png', page, { clip: { x: 0, y: 0, width: 1400, height: 620 } });
    await browser.close(); process.exit(0);
  }
  check('unify tab visible in stock group', await page.isVisible('#admin-tab-unify'));
  check('applied tabs carry link mark', (await page.locator('#admin-subtabs button[title="상호통일 적용"]').count()) === 4);
  let pf = page.frame({ url: /products\.html\?embed=1/ });
  let opts = await pf.locator('#f-company option').allTextContents();
  check('before: products company list has both 에스비컴퍼니 and 미닛걸', opts.some(o => o.includes('에스비컴퍼니')) && opts.some(o => o.startsWith('미닛걸')), opts.join('|'));
  await shot('전_상품관리_거래처목록.png', page, { clip: { x: 0, y: 0, width: 1400, height: 620 } });

  await page.click('#admin-tab-unify'); await page.waitForTimeout(1500);
  const uf = page.frame({ url: /company-unify\.html\?embed=1/ });
  check('unify page loads in frame', !!uf && await uf.isVisible('#add-form'));
  const applied = await uf.textContent('#applied');
  check('applied list shows 상품관리·재고표·재고출고·재고 증감 내역', ['상품관리', '재고표', '재고출고', '재고 증감 내역', '사입할 상품 목록'].every(t => applied.includes(t)), applied);
  check('not-applied list shows 주문관리·정산서', (await uf.textContent('#not-applied')).includes('정산서'));
  check('empty list message', await uf.isVisible('#empty'));
  await shot('후_상호통일_처음.png', page, { fullPage: false });
  await uf.fill('#a-alias', '에스비컴퍼니'); await uf.fill('#a-main', '미닛걸'); await uf.fill('#a-memo', '같은 대표님, 도매 등록명');
  await page.waitForTimeout(200);
  const pv = await uf.textContent('#a-preview');
  check('preview shows counts and member check', pv.includes('상품 2개') && pv.includes('가입 회원 상호') && pv.includes('옮겨집니다'), pv);
  await shot('후_상호통일_입력중.png', page);
  // 같은 상호 막기
  await uf.fill('#a-main', '에스비 컴퍼니'); await uf.click('#a-save'); await page.waitForTimeout(300);
  check('same name rejected', dialogs[dialogs.length - 1].includes('두 상호가 같습니다'));
  await uf.fill('#a-main', '미닛걸');
  await uf.click('#a-save'); await page.waitForTimeout(1500);
  check('apply first without merge, then merge after 승인', applyCalls.length === 2 && applyCalls[0].p_merge === false && applyCalls[1].p_merge === true, JSON.stringify(applyCalls));
  check('first alert shows moved count + waiting', dialogs.some(d => d.includes('상품 2개') && d.includes('아직 옮기지 않은 상품 1개')));
  check('asks 합치겠습니까 with product list before merging', dialogs.some(d => d.includes('합치겠습니까') && d.includes('도매A 꽃니트 검정 F') && d.includes('재고 4개')));
  check('merged result alert', dialogs[dialogs.length - 1].includes('P000009 → P000003 (수량 4개 더함)'), dialogs[dialogs.length - 1]);
  const tb = await uf.textContent('#tbody');
  check('list shows main/alias/member', tb.includes('미닛걸') && tb.includes('에스비컴퍼니') && tb.includes('회원') && tb.includes('상품 3개'), tb);
  // 메인 상호를 다른 상호로 다시 쓰면 막기
  await uf.fill('#a-alias', '새상호'); await uf.fill('#a-main', '에스비컴퍼니'); await uf.click('#a-save'); await page.waitForTimeout(300);
  check('chain rejected', dialogs[dialogs.length - 1].includes("'미닛걸'"), dialogs[dialogs.length - 1]);
  await uf.fill('#a-alias', ''); await uf.fill('#a-main', ''); await page.waitForTimeout(200);
  await shot('후_상호통일_추가후.png', page);
  if (SHOTS) {
    // 따로 연 화면 전체 그림 (입력 중 미리보기 + 목록)
    const sp = await context.newPage(); await sp.setViewportSize({ width: 1200, height: 900 });
    await sp.goto(PAGE + '?embed=1'); await sp.waitForTimeout(1500);
    await sp.fill('#a-alias', 'SB컴퍼니'); await sp.fill('#a-main', '미닛걸'); await sp.dispatchEvent('#a-main', 'input'); await sp.waitForTimeout(200);
    await sp.screenshot({ path: path.join(SHOTS, '후_상호통일_전체.png'), fullPage: true }); await sp.close();
  }

  // 상품관리: 한 상호로, 다른 상호도 같이 보임, 검색도 됨
  await page.click('#admin-tab-products'); await page.waitForTimeout(300);
  await pf.goto(pf.url()); await page.waitForTimeout(1500);
  pf = page.frame({ url: /products\.html\?embed=1/ });
  opts = await pf.locator('#f-company option').allTextContents();
  check('after: products company list unified', opts.some(o => o === '미닛걸 (+에스비컴퍼니)') && !opts.some(o => o === '에스비컴퍼니'), opts.join('|'));
  await pf.fill('#f-keyword', '에스비컴퍼니'); await pf.dispatchEvent('#f-keyword', 'input'); await page.waitForTimeout(300);
  const ptb = await pf.locator('#list tr, #tbody tr').count().catch(() => -1);
  await pf.fill('#f-keyword', ''); await pf.dispatchEvent('#f-keyword', 'input');
  await pf.selectOption('#f-company', norm('미닛걸')); await page.waitForTimeout(300);
  await shot('후_상품관리_거래처목록.png', page, { clip: { x: 0, y: 0, width: 1400, height: 620 } });
  // 재고표 탭
  await page.click('#admin-tab-inventory'); await page.waitForTimeout(300);
  // 2026-11-22: 묶음을 누르면 재고표가 먼저 열려 이미 불러와 있으므로 상품관리처럼 새로 불러옴
  { const f0 = page.frame({ url: /inventory\.html\?embed=1/ }); await f0.goto(f0.url()); } await page.waitForTimeout(1800);
  const inf = page.frame({ url: /inventory\.html\?embed=1/ });
  const iopts = await inf.locator('#f-company option').allTextContents();
  check('inventory company list unified', iopts.some(o => o === '미닛걸 (+에스비컴퍼니)'), iopts.join('|'));
  await page.click('#admin-tab-picking'); await page.waitForTimeout(1800);
  check('picking tab loads', !!page.frame({ url: /picking\.html\?embed=1/ }));
  await page.click('#admin-tab-history'); await page.waitForTimeout(1500);
  check('history tab loads', !!page.frame({ url: /stock-history\.html\?embed=1/ }));
  await page.click('#admin-group-order'); await page.waitForTimeout(500);
  check('admin order list still visible', await page.isVisible('#admin-orders-panel'));

  // 지우기
  await page.goto(PAGE); await page.waitForTimeout(1500);
  await page.click('#tbody button:has-text("지우기")'); await page.waitForTimeout(1200);
  check('remove alias', aliases.length === 0 && await page.isVisible('#empty'));

  // 셀러: 주문 등록 화면 정상, 상호통일 화면은 못 봄
  await page.evaluate(() => localStorage.clear());
  await login('seller@x.com', 'password1', false);
  check('seller dashboard visible', await page.isVisible('#seller-dashboard') || await page.isVisible('#order-form'));
  await page.goto(PAGE); await page.waitForTimeout(1200);
  check('seller blocked from unify page', (await page.textContent('#state')).includes('관리자만'));
  // 로그아웃 상태 로그인 화면
  await page.evaluate(() => localStorage.clear());
  await page.goto(INDEX); await page.waitForTimeout(1000);
  check('login screen shows', await page.isVisible('#login-email'));
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
  const f = results.filter(r => r.startsWith('FAIL'));
  console.log(`\n${results.length - f.length}/${results.length} passed`);
  process.exit(f.length ? 1 : 0);
})();
