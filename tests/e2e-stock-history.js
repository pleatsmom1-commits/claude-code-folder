// 재고 증감 내역 (stock-history.html + 관리자 [재고 증감 내역] 탭 + 셀러 [재고 증감] 버튼) E2E
// 실제 Supabase 대신 메모리 속 가짜 서버를 씁니다. 사용: cd tests && npm install && node e2e-stock-history.js [그림폴더]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx-js-style');

const NM = path.join(__dirname, 'node_modules');
const ROOT = process.env.ROOT_DIR || path.join(__dirname, '..');
const NAV_ONLY = !!process.env.NAV_ONLY;
// 셀러 공개 여부: 화면 파일의 SELLER_OPEN 값을 읽어 그에 맞게 확인
const SELLER_OPEN = /const SELLER_OPEN = true/.test(fs.readFileSync(path.join(ROOT, 'stock-history.html'), 'utf8'));
const INDEX = 'file://' + path.join(ROOT, 'index.html') + '?test';
const PAGE = 'file://' + path.join(ROOT, 'stock-history.html');
const SHOTS = process.argv[2] || '';
const LIB = {
  'xlsx-js-style': 'xlsx-js-style/dist/xlsx.bundle.js',
  'jszip': 'jszip/dist/jszip.min.js',
  'lucide': 'lucide/dist/umd/lucide.min.js',
  'supabase-js': '@supabase/supabase-js/dist/umd/supabase.js',
};
const ids = { seller: '00000000-0000-0000-0000-00000000000a', admin: '00000000-0000-0000-0000-0000000000ad' };
const users = {
  'seller@x.com': { id: ids.seller, pw: 'password1', profile: { id: ids.seller, email: 'seller@x.com', company: '예시샵', name: '김', phone: '', role: 'seller', status: 'approved', created_at: '2026-09-01T00:00:00Z' } },
  'admin@x.com': { id: ids.admin, pw: 'adminpass1', profile: { id: ids.admin, email: 'admin@x.com', company: '밤낮', name: '관리', phone: '', role: 'admin', status: 'approved', created_at: '2026-08-01T00:00:00Z' } },
};
const norm = v => String(v || '').replace(/\s/g, '').toLowerCase();
let stockVisible = true;

const P = (id, company, wc, wp, color, size, mall) => ({ id, code: 'P' + String(id).padStart(6, '0'), company, wholesale_company: wc, wholesale_product: wp, color, size, mall_names: mall ? [{ platform: '스마트스토어', name: mall }] : [], deleted_at: null });
const products = [
  P(1, '예시샵', '도매A', '꽃니트', '검정', 'F', '플라워 니트'),
  P(2, '예시샵', '도매A', '꽃니트', '아이보리', 'F', '플라워 니트'),
  P(3, '예시샵', '도매B', '와이드 데님', '연청', 'M', '데일리 와이드진'),
  P(4, '하루상회', '도매C', '진주 목걸이', '', '', '진주 레이어드 목걸이'),
  P(5, '하루상회', '도매C', '실버 반지', '', '11호', ''),
  P(6, '모노룸', '도매D', '울 머플러', '그레이', '', '포근 머플러'),
];
const inventory = [
  { product_id: 1, company: '예시샵', qty_a: 4, qty_b: 1, qty_defect: 0 }, { product_id: 2, company: '예시샵', qty_a: 3, qty_b: 0, qty_defect: 0 },
  { product_id: 3, company: '예시샵', qty_a: 5, qty_b: 0, qty_defect: 1 }, { product_id: 4, company: '하루상회', qty_a: 8, qty_b: 0, qty_defect: 0 },
  { product_id: 5, company: '하루상회', qty_a: 2, qty_b: 0, qty_defect: 0 }, { product_id: 6, company: '모노룸', qty_a: 6, qty_b: 0, qty_defect: 0 },
];
// 한국 날짜 기준 오늘/어제/3일 전 기록
const kstToday = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const day = n => { const d = new Date(kstToday + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const at = (n, hm) => new Date(`${day(n)}T${hm}:00+09:00`).toISOString();
let mid = 1;
const M = (pid, kind, da, db, dd, after, reason, when) => { const p = products.find(x => x.id === pid); return { id: mid++, product_id: pid, company: p.company, code: p.code, kind, d_a: da, d_b: db, d_defect: dd, a_after: after[0], b_after: after[1], defect_after: after[2], reason, actor_name: '관리', at: when }; };
const moves = [
  M(1, '최종재고', 0, 0, 0, [5, 1, 0], '최종재고 엑셀', at(3, '10:00')),          // 수량 그대로 → 화면에서 뺌
  M(3, '입고', 0, 6, 0, [0, 6, 0], '도매B 입고', at(3, '14:10')),
  M(3, '라벨완료', 6, -6, 0, [6, 0, 0], '라벨 작업 완료', at(1, '09:30')),
  M(4, '입고', 10, 0, 0, [10, 0, 0], '입고', at(1, '11:00')),
  M(6, '최종재고', -2, 0, 0, [6, 0, 0], '최종재고 엑셀', at(1, '18:00')),
  M(1, '출고', -1, 0, 0, [4, 1, 0], '주문 예시샵 #12', at(0, '08:40')),
  M(2, '출고', -2, 0, 0, [3, 0, 0], '주문 예시샵 #13', at(0, '08:41')),
  M(4, '출고', -2, 0, 0, [8, 0, 0], '주문 하루상회 #7', at(0, '08:45')),
  M(3, '조정', -1, 0, 1, [5, 0, 1], '불량 발견', at(0, '10:20')),
  M(5, '입고', 2, 0, 0, [2, 0, 0], '입고', at(0, '13:05')),
  M(2, '입고', 2, 0, 0, [5, 0, 0], '추가 입고', at(0, '15:30')),
];
const tables = { orders: [], couriers: [], address_book: [], pickup_requests: [], settlements: [], settle_contacts: [], products, inventory, inventory_moves: moves };

const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenFor = u => b64url({ alg: 'HS256', typ: 'JWT' }) + '.' + b64url({ sub: u.id, email: u.profile.email, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated', aud: 'authenticated' }) + '.sig';
const userObj = u => ({ id: u.id, email: u.profile.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
function whoFrom(headers) {
  const parts = (headers['authorization'] || '').replace('Bearer ', '').split('.');
  if (parts.length !== 3) return null;
  try { const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); return Object.values(users).find(u => u.id === p.sub) || null; } catch { return null; }
}
const queries = [];
function applyFilters(rows, url) {
  for (const [k, v] of url.searchParams) {
    if (['select', 'order', 'offset', 'limit', 'columns', 'on_conflict'].includes(k)) continue;
    if (v.startsWith('eq.')) rows = rows.filter(r => String(r[k]) === decodeURIComponent(v.slice(3)));
    else if (v.startsWith('gte.')) rows = rows.filter(r => Date.parse(r[k]) >= Date.parse(v.slice(4)));
    else if (v.startsWith('lt.')) rows = rows.filter(r => Date.parse(r[k]) < Date.parse(v.slice(3)));
    else if (v === 'is.null') rows = rows.filter(r => r[k] == null);
  }
  return rows;
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
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
    const mine = r => who && norm(r.company) === norm(who.profile.company) && stockVisible;
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
    if (url.pathname === '/rest/v1/rpc/my_stock_visible') return json(200, stockVisible);
    if (url.pathname.startsWith('/rest/v1/rpc/')) return json(200, null);
    const t = url.pathname.replace('/rest/v1/', '');
    if (['products', 'inventory', 'inventory_moves'].includes(t)) {
      if (t === 'inventory_moves') queries.push({ who: who && who.profile.role, q: url.search });
      let rows = applyFilters(tables[t].filter(r => isAdmin || mine(r)), url);
      if (t === 'inventory_moves') rows = rows.slice().sort((a, b) => b.at.localeCompare(a.at));
      return json(200, rows);
    }
    if (tables[t] && method === 'GET') return json(200, applyFilters(tables[t], url));
    return json(200, []);
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => { pageErrors.push(e.message); console.log('PAGE ERROR:', e.message); });
  page.on('dialog', d => d.accept());
  const results = [];
  const check = (name, cond, extra = '') => { const l = `${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`; results.push(l); console.log(l); };
  const shot = async (name, p = page, opts = {}) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name), ...opts }); };
  const login = async (email, pw, admin) => {
    await page.goto(INDEX); await page.waitForTimeout(800);
    if (admin) await page.click('#tab-btn-admin');
    await page.fill('#login-email', email); await page.fill('#login-pw', pw);
    await page.click('#btn-login'); await page.waitForTimeout(1800);
  };

  // ---------- 1. 관리자: 재고 그룹에 [재고 증감 내역] 탭 ----------
  await login('admin@x.com', 'adminpass1', true);
  check('admin dashboard shows', await page.isVisible('#admin-dashboard'));
  await page.click('#admin-group-stock'); await page.waitForTimeout(300);
  const navShots = async (pre) => {
    await page.click('#admin-tab-stock'); await page.waitForTimeout(500);
    await shot(pre + '관리자_재고메뉴.png', page, { clip: { x: 0, y: 190, width: 1400, height: 190 } });
    await page.evaluate(() => localStorage.clear());
    await login('seller@x.com', 'password1', false);
    await shot(pre + '셀러_위쪽버튼_PC.png', page, { clip: { x: 0, y: 110, width: 1400, height: 90 } });
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(INDEX); await page.waitForTimeout(1800);
    const box = await page.locator('#nav-seller-btns').boundingBox();
    await shot(pre + '셀러_위쪽버튼_휴대폰.png', page, { clip: { x: 0, y: Math.max(0, box.y - 70), width: 390, height: box.height + 90 } });
    await page.setViewportSize({ width: 1400, height: 900 });
  };
  if (NAV_ONLY) { await navShots('전_'); await browser.close(); process.exit(0); }
  check('history tab visible in stock group', await page.isVisible('#admin-tab-history'));
  await page.click('#admin-tab-history'); await page.waitForTimeout(2200);
  const frame = page.frame({ url: /stock-history\.html\?embed=1/ });
  check('history tab loads page in frame', !!frame);
  const stats = await frame.textContent('#stats');
  // 오늘: 출고 -1 -2 -2, 조정 0(상품화-1 불량+1), 입고 +2 +2 → 늘어남 4, 줄어듦 5
  check('today summary: +4 / -5 / 6 products', stats.includes('+4') && stats.includes('−5') && stats.includes('5개'), stats);
  await frame.click('#quick-range button[data-range="7"]'); await page.waitForTimeout(800);
  const dayRows = await frame.locator('#tbody tr').count();
  check('7 days: 3 dates + total row', dayRows === 4, String(dayRows));
  const dayText = await frame.textContent('#tbody');
  check('unchanged 최종재고 row excluded, note shown', (await frame.textContent('#view-note')).includes('1건은 뺐습니다'));
  check('day rows show 입고 +6 (3 days ago)', dayText.includes('+6'), dayText.slice(0, 200));
  // 거래처별
  await frame.click('#view-tabs button[data-view="company"]'); await page.waitForTimeout(300);
  const ct = await frame.textContent('#tbody');
  check('company view lists 3 companies', ct.includes('예시샵') && ct.includes('하루상회') && ct.includes('모노룸'));
  // 거래처 줄 누르면 그 거래처 내역
  await frame.click('#tbody tr:has-text("하루상회")'); await page.waitForTimeout(300);
  const dt = await frame.textContent('#tbody');
  check('click company → detail only that company', dt.includes('진주 목걸이') && !dt.includes('꽃니트') && await frame.isVisible('#focus-bar'));
  await frame.click('#focus-bar button'); await page.waitForTimeout(200);
  // 거래처 고르기
  await frame.selectOption('#f-company', '예시샵'); await page.waitForTimeout(800);
  check('company filter sent to DB', queries[queries.length - 1].q.includes('company=eq.'));
  await frame.click('#view-tabs button[data-view="product"]'); await page.waitForTimeout(300);
  const pt = await frame.textContent('#tbody');
  check('product view: only 예시샵 products with current stock', pt.includes('와이드 데님') && pt.includes('데일리 와이드진') && !pt.includes('목걸이'));
  await frame.click('#view-tabs button[data-view="detail"]'); await page.waitForTimeout(300);
  await frame.selectOption('#f-company', ''); await page.waitForTimeout(800);
  // 엑셀
  const [dl] = await Promise.all([page.waitForEvent('download'), frame.click('button:has-text("엑셀")')]);
  const xp = path.join(__dirname, 'out', 'stock-history.xlsx'); fs.mkdirSync(path.dirname(xp), { recursive: true }); await dl.saveAs(xp);
  const wb = XLSX.readFile(xp);
  check('excel sheets 날짜별/거래처별/상품별/전체 내역', ['날짜별', '거래처별', '상품별', '전체 내역'].every(n => wb.SheetNames.includes(n)), wb.SheetNames.join());
  const det = XLSX.utils.sheet_to_json(wb.Sheets['전체 내역'], { header: 1 });
  check('excel detail header has 거래처명·도매처명·도매상품명·상품명·컬러·사이즈·증감 수량', ['거래처명', '도매처명', '도매상품명', '상품명(쇼핑몰)', '컬러', '사이즈', '증감 수량', '바뀐 뒤 재고'].every(h => det[0].includes(h)), det[0].join());
  check('excel detail 10 rows (7 days)', det.length - 1 === 10, String(det.length - 1));
  const hRow = det.find(r => r.includes('진주 목걸이') && r.includes(-2)) || [];
  check('excel detail row values', hRow.includes('하루상회') && hRow.includes('도매C') && hRow.includes('진주 레이어드 목걸이') && hRow.includes('출고'), JSON.stringify(hRow));
  const ps = XLSX.utils.sheet_to_json(wb.Sheets['상품별'], { header: 1 });
  const pRow = ps.find(r => r.includes('실버 반지')) || [];
  check('excel product sheet row (실버 반지 11호 +2, 지금 2)', pRow.includes('11호') && pRow[pRow.length - 1] === 2 && pRow[pRow.length - 2] === 2, JSON.stringify(pRow));
  if (SHOTS) {
    // 엑셀 모양 미리보기 그림 (전체 내역 앞 8줄)
    const html = '<html><body style="font-family:Malgun Gothic,sans-serif;margin:16px"><h3 style="margin:0 0 8px">엑셀 [전체 내역] 시트 미리보기</h3><table style="border-collapse:collapse;font-size:12px">' +
      det.slice(0, 9).map((r, i) => '<tr>' + det[0].map((_, c) => `<td style="border:1px solid #cbd5e1;padding:4px 6px;${i === 0 ? 'background:#e2e8f0;font-weight:bold' : ''}">${r[c] ?? ''}</td>`).join('') + '</tr>').join('') + '</table></body></html>';
    const xpPage = await context.newPage(); await xpPage.setViewportSize({ width: 1500, height: 400 }); await xpPage.setContent(html);
    await xpPage.screenshot({ path: path.join(SHOTS, '엑셀_전체내역_미리보기.png'), fullPage: true }); await xpPage.close();
  }
  if (SHOTS) {
    // 화면 그림: 따로 연 재고 증감 내역 화면 (전체 길이)
    const sp = await context.newPage(); await sp.setViewportSize({ width: 1400, height: 900 });
    const views = [['오늘', 'day', ''], ['7', 'day', ''], ['7', 'company', ''], ['7', 'product', '예시샵'], ['7', 'detail', '']];
    for (const [r, v, c] of views) {
      await sp.goto(PAGE + '?range=' + (r === '오늘' ? 'today' : r) + (c ? '&company=' + encodeURIComponent(c) : '')); await sp.waitForTimeout(1400);
      await sp.click(`#view-tabs button[data-view="${v}"]`); await sp.waitForTimeout(300);
      await sp.screenshot({ path: path.join(SHOTS, `관리자_${{ day: '날짜별', company: '거래처별', product: '상품별', detail: '전체내역' }[v]}_${r === '오늘' ? '오늘' : '7일'}${c ? '_' + c : ''}.png`), fullPage: true });
    }
    await sp.close();
  }
  if (SHOTS) { await navShots('후_'); await page.evaluate(() => localStorage.clear()); await login('admin@x.com', 'adminpass1', true); await page.click('#admin-group-stock'); await page.waitForTimeout(300); }
  // 기존 재고 탭들도 그대로
  await page.click('#admin-tab-inventory'); await page.waitForTimeout(1200);
  check('재고표 tab still loads', !!page.frame({ url: /inventory\.html\?embed=1/ }));
  await page.click('#admin-group-order'); await page.waitForTimeout(500);
  check('admin order list still visible', await page.isVisible('#admin-orders-panel'));

  // ---------- 2. 셀러: [재고 증감] 버튼 + 자기 업체만 ----------
  await page.evaluate(() => localStorage.clear());
  await login('seller@x.com', 'password1', false);
  check('seller order form visible', await page.isVisible('#seller-dashboard') || await page.isVisible('#order-form'));
  if (!SELLER_OPEN) {
    check('seller closed: history button hidden', !(await page.isVisible('#nav-history-btn')));
    await page.goto(PAGE); await page.waitForTimeout(1200);
    check('seller closed: page says 준비 중', (await page.textContent('#state')).includes('준비 중'));
    check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
    await browser.close();
    const f = results.filter(r => r.startsWith('FAIL'));
    console.log(`\n${results.length - f.length}/${results.length} passed`);
    process.exit(f.length ? 1 : 0);
  }
  check('seller history button visible', await page.isVisible('#nav-history-btn'));
  await page.goto(PAGE + '?range=7'); await page.waitForTimeout(1500);
  const st = await page.textContent('#tbody');
  check('seller sees only own company moves', !(await page.isVisible('#f-company')) && (await page.textContent('#stats')).includes('+'));
  await page.click('#view-tabs button[data-view="detail"]'); await page.waitForTimeout(300);
  const sd = await page.textContent('#tbody');
  check('seller detail no other company, no 작업자', !sd.includes('목걸이') && !sd.includes('머플러') && !(await page.textContent('#thead')).includes('작업자'));
  await page.click('#view-tabs button[data-view="day"]'); await page.waitForTimeout(300);
  await shot('셀러_날짜별_7일_PC.png', page);
  const [sdl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("엑셀")')]);
  const sxp = path.join(__dirname, 'out', 'stock-history-seller.xlsx'); await sdl.saveAs(sxp);
  const swb = XLSX.readFile(sxp);
  const sdet = XLSX.utils.sheet_to_json(swb.Sheets['전체 내역'], { header: 1 });
  check('seller excel: 거래처명 column, no 거래처별 sheet, own rows only', sdet[0].includes('거래처명') && !swb.SheetNames.includes('거래처별') && sdet.slice(1).every(r => r[2] === '예시샵'), swb.SheetNames.join());
  // 휴대폰
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(PAGE + '?range=7'); await page.waitForTimeout(1500);
  await shot('셀러_휴대폰_날짜별.png', page, { fullPage: true });
  await page.setViewportSize({ width: 1400, height: 900 });

  // ---------- 3. 재고 숨긴 셀러 ----------
  stockVisible = false;
  await page.goto(INDEX); await page.waitForTimeout(1800);
  check('hidden seller: history button hidden', !(await page.isVisible('#nav-history-btn')));
  await page.goto(PAGE); await page.waitForTimeout(1200);
  check('hidden seller: page says 준비 중', (await page.textContent('#state')).includes('준비 중'));

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
  const fails = results.filter(r => r.startsWith('FAIL'));
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
})();
