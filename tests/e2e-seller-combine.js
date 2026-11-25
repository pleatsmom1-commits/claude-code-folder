// 셀러 [선택수정] 합배송 묶기 / 부분출고로 바꾸기. 주문은 내 PC PostgreSQL(bt DB, schema.sql + seller_combine.sql)에서 실제 함수로 처리.
// 사용: cd tests && npm install && node e2e-combine.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const NM = path.join(__dirname, 'node_modules');
const ROOT = path.join(__dirname, '..');
const PAGE = 'file://' + path.join(ROOT, 'index.html') + '?test';
const SHIP_PAGE = 'file://' + path.join(ROOT, 'ship.html');
const LIB = {
  'cdn.tailwindcss.com': '@tailwindcss/browser/dist/index.global.js',
  'xlsx-js-style': 'xlsx-js-style/dist/xlsx.bundle.js',
  'jszip': 'jszip/dist/jszip.min.js',
  'lucide': 'lucide/dist/umd/lucide.min.js',
  'supabase-js': '@supabase/supabase-js/dist/umd/supabase.js',
};

const ids = { seller: '00000000-0000-0000-0000-00000000000a', admin: '00000000-0000-0000-0000-0000000000ad' };
const users = {
  'seller@x.com': { id: ids.seller, pw: 'password1', profile: { id: ids.seller, email: 'seller@x.com', company: '가나 샵', name: '김', phone: '010-1111-2222', role: 'seller', status: 'approved', created_at: '2026-09-01T00:00:00Z' } },
  'admin@x.com': { id: ids.admin, pw: 'adminpass1', profile: { id: ids.admin, email: 'admin@x.com', company: '밤낮', name: '관리', phone: '', role: 'admin', status: 'approved', created_at: '2026-08-01T00:00:00Z' } },
};
const tables = {
  orders: [{ id: 'ORD-1', seller_id: ids.seller, seller_company: '가나 샵', sender_name: '밤낮딜리버리(가나 샵)', recipient: '홍길동', phone: '010-2222-3333', address: '서울', product: '티셔츠', status: '접수대기', ship_status: '미출고', order_type: 'fulfillment', order_no: 1, item_no: 1, seller_order_no: 1, created_at: new Date().toISOString() },
    { id: 'ORD-2', seller_id: ids.seller, seller_company: '가나 샵', sender_name: '밤낮딜리버리(가나 샵)', recipient: '테스트고객', phone: '010-4444-5555', address: '부산', product: '테스트상품', status: '접수대기', ship_status: '미출고', order_type: 'fulfillment', order_no: 2, item_no: 1, seller_order_no: 2, created_at: '2026-11-11T03:42:00Z', origin_created_at: '2026-11-08T06:45:00Z' }],
  couriers: [{ id: 'c1', name: '우체국택배', sort_order: 1 }],
  address_book: [], pickup_requests: [{ id: 'p1', seller_id: ids.admin, seller_company: '에이치제이', orderer_name: '에이치제이', orderer_phone: '01068626822', store_name: '엑시토', store_location: '벨포스트 3층 12호', store_phone: '01075049991', prepay: true, prepay_misong: false, agreed: true, memo: '비회원 간단접수 #5 오늘 픽업 부탁드립니다', status: '확인', created_at: new Date().toISOString(), origin_created_at: '2026-11-08T06:45:00Z', handled_at: '2026-11-11T09:00:00Z' }], settlements: [], settle_contacts: [{ company: '럭스걸', phone: '01077778888' }, { company: '유어피치', phone: '' }],
  shipments: [], admin_hidden_orders: [], admin_separate_orders: [],
};
let nextShipId = 1;
const requests = [];
const norm = v => String(v || '').replace(/\s/g, '').toLowerCase();

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



// 내 PC PostgreSQL 에 SQL 실행 (주문 표는 진짜 DB 함수로 처리)
const pg = (sql, sub = '') => execFileSync('sudo', ['-u', 'postgres', 'psql', '-d', 'bt', '-qtAX', '-v', 'ON_ERROR_STOP=1', '-c', (sub ? `set request.jwt.claim.sub='${sub}'; ` : '') + sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const pgOrders = () => JSON.parse(pg(`select coalesce(json_agg(o order by order_no desc, item_no), '[]') from public.orders o`) || '[]');
const lit = s => "'" + String(s).replace(/'/g, "''") + "'";
pg(`delete from public.orders; insert into auth.users(id,email) values (${lit(ids.seller)},'s@x'),(${lit(ids.admin)},'a@x') on conflict do nothing;
insert into public.profiles(id,company,role,status) values (${lit(ids.seller)},'대륙의실수샵','seller','approved'),(${lit(ids.admin)},'밤낮','admin','approved') on conflict (id) do update set role=excluded.role, company=excluded.company, status='approved';
select setval('public.orders_order_no_seq', 155);`);
const ins = [['ORD-156','최준현','01027796263','경기 안양시 만안구','(하의만)심스후드집업'],['ORD-157','김현민','01088455793','부산 부산진구','선 니트 후드집업'],
  ['ORD-158','주민혁','010-4542-0432','전남광주통합특별시 서구 상촌동 1310 하모니타운 401호','다이아 보아 맨투맨세트 블랙/FREE'],['ORD-159','주민혁','010-4542-0432','전남광주통합특별시 서구 상촌동 1310 하모니타운 401호','다이아 보아 맨투맨세트 그레이/FREE'],
  ['ORD-160','김민건','010-2407-7693','경남 거제시 고현동','12번번슬렉스 화이트/S']];
ins.forEach(([id, r, p, a, pr], i) => pg(`insert into public.orders(id,seller_id,recipient,phone,address,product,status,created_at) values (${lit(id)},${lit(ids.seller)},${lit(r)},${lit(p)},${lit(a)},${lit(pr)},'접수대기', now() - interval '${10 - i} minute')`, ids.seller));

fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const dialogs = [];
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
    const json = (status, data) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const who = whoFrom(headers);
    if (url.pathname === '/auth/v1/token') {
      const u = users[body.email];
      if (!u || u.pw !== body.password) return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials' });
      return json(200, { access_token: tokenFor(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: userObj(u) });
    }
    if (url.pathname === '/auth/v1/user') return who ? json(200, userObj(who)) : json(401, { msg: 'no' });
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/rest/v1/profiles') {
      const isAdmin = who && who.profile.role === 'admin';
      let rows = Object.values(users).map(u => u.profile).filter(p => isAdmin || (who && p.id === who.id));
      rows = applyFilters(rows, url);
      if ((headers['accept'] || '').includes('vnd.pgrst.object')) return rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' });
      return json(200, rows);
    }
    const rpcm = url.pathname.match(/^\/rest\/v1\/rpc\/(admin|seller)_set_combined$/);
    if (rpcm) {
      try {
        const out = pg(`select coalesce(json_agg(o), '[]') from public.${rpcm[1]}_set_combined(array[${body.p_ids.map(lit).join(',')}]::text[], ${lit(body.p_mode)}) o`, who ? who.id : '');
        return json(200, JSON.parse(out));
      } catch (e) { return json(400, { code: 'P0001', message: String(e.stderr || e.message).split('\n').find(l => l.includes('ERROR')) || String(e) }); }
    }
    if (url.pathname === '/rest/v1/orders' && method === 'GET') {
      let rows = pgOrders();
      if (!(who && who.profile.role === 'admin')) rows = rows.filter(r => who && r.seller_id === who.id);
      return json(200, applyFilters(rows, url));
    }
    const table = url.pathname.replace('/rest/v1/', '');
    if (tables[table] && method === 'GET') return json(200, table === 'orders' ? [] : applyFilters(tables[table], url));
    return json(404, { message: 'unmocked ' + url.pathname });
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => { pageErrors.push(e.message); console.log('PAGE ERROR:', e.message); });
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  const results = [];
  const check = (name, cond, extra = '') => { const l = `${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`; results.push(l); console.log(l); };
  const OUT = process.env.SHOT_DIR || path.join(__dirname, 'out');
  const tick = async ids => { await page.evaluate(() => document.querySelectorAll('.seller-chk-item').forEach(c => c.checked = false)); for (const id of ids) await page.check(`.seller-chk-item[value="${id}"]`); };
  const row = id => pgOrders().find(o => o.id === id);
  const btn = '#btn-seller-edit-selected';

  await page.goto(PAGE); await page.waitForTimeout(800);
  await page.fill('#login-email', 'seller@x.com'); await page.fill('#login-pw', 'password1');
  await page.click('#btn-login'); await page.waitForTimeout(1800);
  await page.evaluate(() => document.getElementById('test-site-banner')?.remove());
  check('셀러 화면에 사용법 안내줄', await page.isVisible('#seller-edit-hint'));
  const abs = sel => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return r.top + window.scrollY; }, sel);
  const clip = async () => { const t = (await abs(btn)) - 50; const b = await abs('#seller-order-list'); return { x: 0, y: t, width: 1600, height: b + 330 - t }; };
  const shot = async n => page.screenshot({ path: path.join(OUT, n), clip: await clip(), fullPage: true });

  await page.click(btn); await page.waitForTimeout(200);
  check('0개: 사용법 알림', dialogs.some(d => d.includes('1개만 체크') && d.includes('2개 이상 체크')));
  await tick(['ORD-157']);
  check('1개 체크: 버튼 글자', (await page.textContent(btn)).includes('1개: 주문 수정'));
  await shot('seller_1.png');
  await tick(['ORD-158', 'ORD-159']);
  check('2개 체크: 버튼 글자', (await page.textContent(btn)).includes('2개: 합배송/부분출고'));
  await shot('seller_2.png');
  await page.click(btn); await page.waitForTimeout(300);
  check('2개 선택수정 → 합배송 창', await page.isVisible('#combine-modal'));
  await page.screenshot({ path: path.join(OUT, 'seller_modal.png') });
  await page.click('#btn-combine'); await page.waitForTimeout(800);
  const a = row('ORD-158'), b = row('ORD-159');
  check('DB: 셀러가 158·159 묶음', a.order_no === b.order_no && b.item_no === 2 && a.product.startsWith('(합)') && b.product.startsWith('(합)'), JSON.stringify([a.order_no, a.item_no, b.order_no, b.item_no]));
  check('화면: 셀러 번호 3-1, 3-2', (await page.textContent('#seller-order-list')).includes('3-2'));

  await tick(['ORD-159']);
  await page.click(btn); await page.waitForTimeout(300);
  check('1개 선택수정: 수정창에 합배송 + 부분출고 버튼', (await page.textContent('#eo-combine-box')).includes('2개 묶음') && await page.isVisible('#eo-combine-box button'));
  await page.screenshot({ path: path.join(OUT, 'seller_edit.png') });
  await page.click('#eo-combine-box button'); await page.waitForTimeout(800);
  check('부분출고: 159 새 번호, (합) 없음', row('ORD-159').order_no !== row('ORD-158').order_no && !row('ORD-159').product.includes('(합)'));

  await tick(['ORD-160', 'ORD-158']);
  await page.click(btn); await page.waitForTimeout(300);
  check('받는분 다르면 셀러는 묶기 버튼 막힘', await page.isDisabled('#btn-combine') && (await page.textContent('#combine-modal-warn')).includes('묶을 수 없습니다'));
  await page.click('#combine-modal button:has-text("닫기")');

  pg(`update public.orders set status='접수완료' where id='ORD-156'`);
  const before156 = row('ORD-156').order_no;
  const r = JSON.parse(pg(`select count(*) from public.orders`));
  let err = '';
  try { pg(`select * from public.seller_set_combined(array['ORD-156','ORD-157'], 'combine')`, ids.seller); } catch (e) { err = String(e.stderr || e.message); }
  check('DB: 접수완료 주문은 셀러가 못 묶음', err.includes('이미 접수') && row('ORD-156').order_no === before156, err.split('\n')[0]);
  err = '';
  try { pg(`select * from public.admin_set_combined(array['ORD-157','ORD-160'], 'combine')`, ids.seller); } catch (e) { err = String(e.stderr || e.message); }
  check('DB: 셀러가 관리자 함수 직접 호출 막힘', err.includes('관리자만'));
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
  console.log(results.filter(r => r.startsWith('FAIL')).length ? 'SOME FAILED' : 'ALL PASS');
})();
