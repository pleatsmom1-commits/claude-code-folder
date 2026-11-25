// 관리자 [선택수정] 합배송 묶기 / 부분출고로 바꾸기. 주문은 내 PC PostgreSQL(bt DB, schema.sql + order_combine.sql)에서 실제 함수로 처리.
// 사용: cd tests && npm install && node e2e-combine.js
// 실제 Supabase 대신 메모리 속 가짜 서버를 씁니다. 사용: cd tests && npm install && node e2e-hidden.js
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
insert into public.profiles(id,company,role) values (${lit(ids.seller)},'대륙의실수샵','seller'),(${lit(ids.admin)},'밤낮','admin') on conflict (id) do update set role=excluded.role, company=excluded.company;
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
    if (url.pathname === '/rest/v1/rpc/admin_set_combined') {
      try {
        const out = pg(`select coalesce(json_agg(o), '[]') from public.admin_set_combined(array[${body.p_ids.map(lit).join(',')}]::text[], ${lit(body.p_mode)}) o`, who ? who.id : '');
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
  const shot = (n, clip) => page.screenshot({ path: path.join(OUT, n), ...(clip ? { clip, fullPage: true } : {}) });
  const tick = async ids => { await page.evaluate(() => document.querySelectorAll('.admin-chk-item').forEach(c => c.checked = false)); for (const id of ids) await page.check(`.admin-chk-item[value="${id}"]`); };
  const row = id => pgOrders().find(o => o.id === id);

  await page.goto(PAGE); await page.waitForTimeout(800);
  await page.click('#tab-btn-admin');
  await page.fill('#login-email', 'admin@x.com'); await page.fill('#login-pw', 'adminpass1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  const tableBox = async () => { const b = await page.locator('#admin-order-list').boundingBox(); return { x: 0, y: Math.max(0, b.y - 60), width: 1600, height: b.height + 60 }; };
  await tick(['ORD-159', 'ORD-158']);
  await shot('1_before_list.png', await tableBox());

  // 2개 체크 → 선택수정 → 합배송 창
  await page.click('#btn-edit-selected'); await page.waitForTimeout(300);
  check('2개 선택수정 → 합배송/부분출고 창', await page.isVisible('#combine-modal'));
  check('같은 받는분이라 경고 없음', await page.isHidden('#combine-modal-warn'));
  await shot('2_combine_modal.png');
  await page.click('#btn-combine'); await page.waitForTimeout(800);
  const a = row('ORD-158'), b = row('ORD-159');
  check('DB: 158·159 같은 주문 번호로 묶임', a.order_no === b.order_no && a.item_no === 1 && b.item_no === 2 && a.seller_order_no === b.seller_order_no, JSON.stringify([a.order_no, a.item_no, b.order_no, b.item_no]));
  check('DB: 상품명 앞에 (합)', a.product.startsWith('(합)') && b.product.startsWith('(합)'));
  const txt = (await page.textContent('#admin-order-list')).replace(/\s+/g, ' ');
  check('화면: 158-1, 158-2 + 합배송 표시', txt.includes('158-1') && txt.includes('158-2') && txt.includes('합배송'), txt.slice(0, 400));
  check('완료 안내창', dialogs.some(d => d.includes('[합배송으로 묶기] 했습니다')));
  await page.evaluate(() => document.querySelectorAll('.admin-chk-item').forEach(c => c.checked = false));
  await shot('3_after_list.png', await tableBox());

  // 1개 선택수정 → 수정창에 합배송 표시 + 부분출고 버튼
  await tick(['ORD-159']);
  await page.click('#btn-edit-selected'); await page.waitForTimeout(300);
  const box = await page.textContent('#eo-combine-box');
  check('1개 선택수정: 수정창에 합배송 안내', await page.isVisible('#eo-combine-box') && box.includes('합배송') && box.includes('2개 묶음'), box);
  await shot('4_edit_modal_combined.png');
  await page.click('#eo-combine-box button'); await page.waitForTimeout(800);
  const a2 = row('ORD-158'), b2 = row('ORD-159');
  check('부분출고로 바꾸기: 159가 새 번호, (합) 떼짐', a2.order_no !== b2.order_no && !b2.product.includes('(합)') && b2.item_no === 1, JSON.stringify(b2));
  check('남은 158은 158-1 그대로', a2.order_no === 158 && a2.item_no === 1);

  // 다른 받는분과 묶으려 하면 경고
  await tick(['ORD-160', 'ORD-158']);
  await page.click('#btn-edit-selected'); await page.waitForTimeout(300);
  check('받는분 다르면 경고', (await page.textContent('#combine-modal-warn')).includes('받는분'));
  await page.click('#combine-modal button:has-text("닫기")');

  // 다시 묶었다가 2개 모두 부분출고로
  await tick(['ORD-158', 'ORD-159']);
  await page.click('#btn-edit-selected'); await page.waitForTimeout(300);
  await page.click('#btn-combine'); await page.waitForTimeout(800);
  await tick(['ORD-158', 'ORD-159']);
  await page.click('#btn-edit-selected'); await page.waitForTimeout(300);
  await page.click('#btn-split'); await page.waitForTimeout(800);
  const a3 = row('ORD-158'), b3 = row('ORD-159');
  check('둘 다 부분출고: 158은 원래 번호, 159는 새 번호, (합) 없음', a3.order_no === 158 && b3.order_no !== 158 && !a3.product.includes('(합)') && !b3.product.includes('(합)'), JSON.stringify([a3.order_no, b3.order_no]));

  // 단독 주문 1개 선택수정 → 기존 수정창 그대로
  await tick(['ORD-157']);
  await page.click('#btn-edit-selected'); await page.waitForTimeout(300);
  check('단독 주문: 기존 수정창 + 단독 안내', await page.isVisible('#edit-modal') && (await page.textContent('#eo-combine-box')).includes('단독'));
  await page.click('#edit-modal button:has(i[data-lucide="x"]), #edit-modal button:has(svg)').catch(() => {});
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
  console.log(results.filter(r => r.startsWith('FAIL')).length ? 'SOME FAILED' : 'ALL PASS');
})();
