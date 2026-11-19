// 월별 이용 리포트 (report.html + 셀러 [월별 리포트] 버튼) E2E — 가짜 Supabase 사용
// 사용: cd tests && npm install && node e2e-report.js [그림폴더]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const NM = path.join(__dirname, 'node_modules');
const ROOT = process.env.ROOT_DIR || path.join(__dirname, '..');
const INDEX = 'file://' + path.join(ROOT, 'index.html') + '?test';
const PAGE = 'file://' + path.join(ROOT, 'report.html');
const SHOTS = process.argv[2] || '';
const NAV_ONLY = !!process.env.NAV_ONLY;
const LIB = { 'xlsx-js-style': 'xlsx-js-style/dist/xlsx.bundle.js', 'jszip': 'jszip/dist/jszip.min.js', 'lucide': 'lucide/dist/umd/lucide.min.js', 'supabase-js': '@supabase/supabase-js/dist/umd/supabase.js' };
const ids = { seller: '00000000-0000-0000-0000-00000000000a', other: '00000000-0000-0000-0000-00000000000b', admin: '00000000-0000-0000-0000-0000000000ad' };
const users = {
  'seller@x.com': { id: ids.seller, pw: 'password1', profile: { id: ids.seller, email: 'seller@x.com', company: '예시샵', name: '김', phone: '', role: 'seller', status: 'approved', created_at: '2026-09-01T00:00:00Z' } },
  'admin@x.com': { id: ids.admin, pw: 'adminpass1', profile: { id: ids.admin, email: 'admin@x.com', company: '밤낮', name: '관리', phone: '', role: 'admin', status: 'approved', created_at: '2026-08-01T00:00:00Z' } },
};
// 한국 기준 지난 달 / 그 전 달
const kst = new Date(Date.now() + 9 * 3600e3);
const mk = (y, m) => { const d = new Date(Date.UTC(y, m, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const LAST = mk(kst.getUTCFullYear(), kst.getUTCMonth() - 1), PREV = mk(kst.getUTCFullYear(), kst.getUTCMonth() - 2);
const NAMES = ['플라워 니트/검정/F/1개', '데일리 와이드진/연청/M/1개', '플라워 니트/아이보리/F/1개', '캐시미어 머플러/그레이/1개', '골지 반팔티/화이트/F/1개',
  '부츠컷 슬랙스/블랙/S/1개', '진주 레이어드 목걸이/1개', '울 코트/카멜/F/1개', '스트라이프 셔츠/블루/F/1개', '니트 베스트/네이비/F/1개', '양털 슬리퍼/베이지/240/1개', '체크 스커트/그린/S/1개'];
let seq = 1, rnd = 7;
const rand = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
const orders = [];
function makeMonth(m, n, seller, company) {
  const days = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5), 0)).getUTCDate();
  for (let i = 0; i < n; i++) {
    const d = 1 + Math.floor(rand() * days);
    const dow = new Date(`${m}-${String(d).padStart(2, '0')}T00:00:00Z`).getUTCDay();
    if (dow === 0) continue; // 일요일 쉼
    const name = NAMES[Math.min(NAMES.length - 1, Math.floor(Math.pow(rand(), 1.8) * NAMES.length))];
    const t = 'T' + (seq++);
    const row = { id: 'o' + seq, seller_id: seller, seller_company: company, product: name, qty: rand() < .15 ? 2 : 1, tracking_no: t, ship_status: '출고완료',
      order_type: rand() < .1 ? 'store_post' : 'fulfillment', shipped_at: new Date(`${m}-${String(d).padStart(2, '0')}T15:30:00+09:00`).toISOString() };
    orders.push(row);
    if (rand() < .08) orders.push({ ...row, id: 'o' + (seq++), product: NAMES[4] }); // 합배송(같은 송장)
  }
}
makeMonth(LAST, 260, ids.seller, '예시샵');
makeMonth(PREV, 220, ids.seller, '예시샵');
makeMonth(LAST, 50, ids.other, '다른샵');
orders.push({ id: 'keep1', seller_id: ids.seller, seller_company: '예시샵', product: '보관 상품', qty: 3, tracking_no: 'K1', ship_status: '출고완료', order_type: 'keep', shipped_at: new Date(`${LAST}-10T12:00:00+09:00`).toISOString() });
orders.push({ id: 'unship', seller_id: ids.seller, seller_company: '예시샵', product: '미출고 상품', qty: 1, tracking_no: null, ship_status: '미출고', order_type: 'fulfillment', shipped_at: null });
const settlements = [];
const S = (company, date, d) => settlements.push({ company, settle_date: date, total: 0, result: '청구', token: 't' + settlements.length, data: d });
for (const [m, k] of [[LAST, 1], [PREV, .85]]) for (const day of ['05', '12', '19', '26']) {
  const fulfillCost = Math.round(165000 * k), shippingFee = Math.round(210000 * k), pickupCost = 48000, unsentCost = 12000, etcCost = day === '26' ? 5000 : 0;
  const serviceTotal = fulfillCost + shippingFee + pickupCost + unsentCost + etcCost;
  S('예시샵', `${m}-${day}`, { fulfillCost, shippingFee, pickupCost, unsentCost, etcCost, serviceTotal, vat: Math.round(serviceTotal / 10), prepaid: 830000 });
}
S('다른샵', `${LAST}-05`, { serviceTotal: 999999, vat: 99999 });

const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenFor = u => b64url({ alg: 'HS256', typ: 'JWT' }) + '.' + b64url({ sub: u.id, email: u.profile.email, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated', aud: 'authenticated' }) + '.sig';
const userObj = u => ({ id: u.id, email: u.profile.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
function whoFrom(h) { const p = (h['authorization'] || '').replace('Bearer ', '').split('.'); if (p.length !== 3) return null; try { const j = JSON.parse(Buffer.from(p[1], 'base64url').toString()); return Object.values(users).find(u => u.id === j.sub) || null; } catch { return null; } }
function applyFilters(rows, url) {
  for (const [k, v] of url.searchParams) {
    if (['select', 'order', 'offset', 'limit', 'columns', 'on_conflict'].includes(k)) continue;
    if (v.startsWith('eq.')) rows = rows.filter(r => String(r[k]) === decodeURIComponent(v.slice(3)));
    else if (v.startsWith('gte.')) rows = rows.filter(r => r[k] && Date.parse(r[k]) >= Date.parse(v.slice(4)));
    else if (v.startsWith('lt.')) rows = rows.filter(r => r[k] && Date.parse(r[k]) < Date.parse(v.slice(3)));
  }
  const off = +(url.searchParams.get('offset') || 0), lim = url.searchParams.get('limit');
  return lim ? rows.slice(off, off + +lim) : rows;
}
const orderQueries = [];
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', async route => {
    const req = route.request(); const url = new URL(req.url());
    if (url.protocol === 'file:') return route.continue();
    const lib = Object.entries(LIB).find(([k]) => req.url().includes(k));
    if (lib) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(NM, lib[1])) });
    if (!url.hostname.endsWith('supabase.co')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    const method = req.method(), headers = req.headers();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
    if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: cors });
    let body = null; try { body = req.postDataJSON(); } catch { body = null; }
    const json = (s, d) => route.fulfill({ status: s, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(d) });
    const who = whoFrom(headers); const isAdmin = who && who.profile.role === 'admin';
    if (url.pathname === '/auth/v1/token') { const u = users[body.email]; if (!u || u.pw !== body.password) return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials' }); return json(200, { access_token: tokenFor(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: userObj(u) }); }
    if (url.pathname === '/auth/v1/user') return who ? json(200, userObj(who)) : json(401, { msg: 'no' });
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/rest/v1/profiles') { const rows = applyFilters(Object.values(users).map(u => u.profile).filter(p => isAdmin || (who && p.id === who.id)), url); if ((headers['accept'] || '').includes('vnd.pgrst.object')) return rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116' }); return json(200, rows); }
    if (url.pathname === '/rest/v1/rpc/get_my_settlements') {
      const key = isAdmin ? body.p_company : who && who.profile.company;
      return json(200, settlements.filter(s => s.company === key && s.settle_date >= body.p_from && s.settle_date <= body.p_to));
    }
    if (url.pathname === '/rest/v1/rpc/my_stock_visible') return json(200, true);
    if (url.pathname.startsWith('/rest/v1/rpc/')) return json(200, null);
    if (url.pathname === '/rest/v1/orders' && method === 'GET') {
      orderQueries.push({ admin: isAdmin, q: decodeURIComponent(url.search) });
      return json(200, applyFilters(orders.filter(o => isAdmin || (who && o.seller_id === who.id)), url));
    }
    return json(200, []);
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => { errors.push(e.message); console.log('PAGE ERROR:', e.message); });
  const results = []; const check = (n, c, x = '') => { const l = `${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  -- ' + x : ''}`; results.push(l); console.log(l); };
  const shot = async (name, opts = {}) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), ...opts }); };
  const login = async (email, pw, admin) => { await page.goto(INDEX); await page.waitForTimeout(800); if (admin) await page.click('#tab-btn-admin'); await page.fill('#login-email', email); await page.fill('#login-pw', pw); await page.click('#btn-login'); await page.waitForTimeout(1800); };

  await login('seller@x.com', 'password1', false);
  await shot((NAV_ONLY ? '전' : '후') + '_셀러_위쪽버튼_PC.png', { clip: { x: 0, y: 40, width: 1280, height: 120 } });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(INDEX); await page.waitForTimeout(1800);
  const nb = await page.locator('#nav-seller-btns').boundingBox();
  await shot((NAV_ONLY ? '전' : '후') + '_셀러_위쪽버튼_휴대폰.png', { clip: { x: 0, y: Math.max(0, nb.y - 60), width: 390, height: nb.height + 80 } });
  await page.setViewportSize({ width: 1280, height: 900 });
  if (NAV_ONLY) { await browser.close(); return; }
  check('seller sees [월별 리포트] button', await page.isVisible('#nav-report-btn'));
  check('seller order screen still shows', await page.isVisible('#seller-dashboard').catch(() => false) || (await page.textContent('body')).includes('주문'));

  await page.goto(PAGE); await page.waitForTimeout(2000);
  const text = await page.textContent('#result');
  const mine = orders.filter(o => o.seller_id === ids.seller && o.ship_status === '출고완료' && o.order_type !== 'keep' && o.shipped_at.startsWith(LAST.slice(0, 4)) && new Date(Date.parse(o.shipped_at) + 9 * 3600e3).toISOString().startsWith(LAST));
  const boxes = new Set(mine.map(o => o.tracking_no)).size, qty = mine.reduce((n, o) => n + o.qty, 0);
  check('default month = last month', text.includes(`${+LAST.slice(0, 4)}년 ${+LAST.slice(5)}월`));
  check('ship count = distinct tracking', text.includes(`${boxes.toLocaleString('ko-KR')}건`), String(boxes));
  check('qty sum excludes keep', text.includes(`${qty.toLocaleString('ko-KR')}개`), String(qty));
  check('other seller cost not included', !text.includes('999,999'));
  check('top products shown', (await page.locator('.rank li').count()) === 10);
  check('chart bars drawn', (await page.locator('#day-chart path.bar').count()) > 15);
  check('compare with prev month', text.includes('지난달보다'));
  await shot('후_월별리포트_PC.png', { fullPage: true });
  await page.hover('#day-chart rect.hit >> nth=9'); await page.waitForTimeout(200);
  check('tooltip on hover', await page.isVisible('#tip'));
  await page.click('#prev-btn'); await page.waitForTimeout(1500);
  check('prev month loads', (await page.textContent('#result')).includes(`${+PREV.slice(5)}월`));
  // 보기 바꾸기
  await page.click('#modes button[data-mode="year"]'); await page.waitForTimeout(1500);
  let yt = await page.textContent('#result');
  check('year view: monthly chart 12 bars area + table', yt.includes('월별 출고 건수') && (await page.locator('#day-chart rect.hit').count()) === 12, String(await page.locator('#day-chart rect.hit').count()));
  await shot('후_연도별리포트_PC.png', { fullPage: true });
  await page.click('#modes button[data-mode="quarter"]'); await page.waitForTimeout(1500);
  check('quarter view: weekly chart', (await page.textContent('#result')).includes('주별 출고 건수'));
  await page.click('#modes button[data-mode="day"]'); await page.waitForTimeout(1500);
  await page.fill('#p-day', mine[0] ? new Date(Date.parse(mine[0].shipped_at) + 9 * 3600e3).toISOString().slice(0, 10) : LAST + '-02');
  await page.dispatchEvent('#p-day', 'change'); await page.waitForTimeout(1500);
  const dt = await page.textContent('#result');
  check('day view shows count and 전날 compare, no chart', dt.includes('출고 건수') && dt.includes('전날') && !(await page.isVisible('#day-chart')));
  await shot('후_일별리포트_PC.png', { fullPage: true });
  await page.click('#modes button[data-mode="range"]'); await page.waitForTimeout(1500);
  await page.fill('#p-from', LAST + '-01'); await page.fill('#p-to', LAST + '-15'); await page.click('#picker button:has-text("조회")'); await page.waitForTimeout(1500);
  check('range view label', (await page.textContent('#result')).includes('(15일)'));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("엑셀 받기")')]);
  const xp = path.join(__dirname, 'out', 'report.xlsx'); fs.mkdirSync(path.dirname(xp), { recursive: true }); await dl.saveAs(xp);
  const XLSX = require('xlsx-js-style'); const wb = XLSX.readFile(xp);
  check('excel sheets 요약/날짜별/상품별', ['요약', '날짜별', '상품별'].every(n => wb.SheetNames.includes(n)), wb.SheetNames.join());
  await page.click('#modes button[data-mode="month"]'); await page.waitForTimeout(1500);
  await page.click('button.more'); await page.waitForTimeout(200);
  check('show all products', (await page.locator('.rank li').count()) > 10);
  await page.emulateMedia({ media: 'print' }); await shot('후_월별리포트_인쇄모양.png', { fullPage: true }); await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(PAGE); await page.waitForTimeout(2000);
  await shot('후_월별리포트_휴대폰.png', { fullPage: true });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check('no horizontal scroll on phone', sw <= 390, String(sw));
  await page.setViewportSize({ width: 1280, height: 900 });

  // 관리자 [화면 보기]
  await page.evaluate(() => localStorage.clear());
  await login('admin@x.com', 'adminpass1', true);
  check('admin dashboard shows', await page.isVisible('#admin-dashboard'));
  orderQueries.length = 0;
  await page.goto(PAGE + `?company=${encodeURIComponent('예시샵')}&view=1&uid=${ids.seller}`); await page.waitForTimeout(2000);
  check('admin view-as filters by seller_id', orderQueries.length && orderQueries.every(q => q.q.includes(`seller_id=eq.${ids.seller}`)));
  check('admin view-as same count', (await page.textContent('#result')).includes(`${boxes.toLocaleString('ko-KR')}건`));
  check('view-as bar shown', await page.isVisible('#view-as-bar'));
  check('no page errors', !errors.length, errors.join(' | '));
  await browser.close();
  const fails = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - fails}/${results.length} passed`); process.exit(fails ? 1 : 0);
})();
