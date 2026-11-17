// 직원 아이디 + 작업 기록 E2E (supabase/staff_activity.sql)
// 실제 Supabase 대신 메모리 속 가짜 서버를 씁니다. 사용: cd tests && npm install && node e2e-hidden.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const NM = path.join(__dirname, 'node_modules');
const ROOT = path.join(__dirname, '..');
const PAGE = 'file://' + path.join(process.env.ROOT_DIR || ROOT, 'index.html') + '?test';
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
  'admin@x.com': { id: ids.admin, pw: 'adminpass1', profile: { id: ids.admin, email: 'admin@x.com', company: '밤낮', name: '이현재', phone: '', role: 'admin', admin_level: 'owner', status: 'approved', created_at: '2026-08-01T00:00:00Z' } },
  'old@x.com': { id: '00000000-0000-0000-0000-0000000000c1', pw: 'oldpass11', profile: { id: '00000000-0000-0000-0000-0000000000c1', email: 'old@x.com', company: '직원:old@x.com', name: '이전직원', phone: '', role: 'seller', admin_level: 'staff', status: 'suspended', created_at: '2026-10-01T00:00:00Z' } },
};
const tables = {
  orders: [{ id: 'ORD-1', seller_id: ids.seller, seller_company: '가나 샵', sender_name: '밤낮딜리버리(가나 샵)', recipient: '홍길동', phone: '010-2222-3333', address: '서울', product: '티셔츠', status: '접수대기', ship_status: '미출고', order_type: 'fulfillment', order_no: 1, item_no: 1, seller_order_no: 1, created_at: new Date().toISOString() },
    { id: 'ORD-2', seller_id: ids.seller, seller_company: '가나 샵', sender_name: '밤낮딜리버리(가나 샵)', recipient: '테스트고객', phone: '010-4444-5555', address: '부산', product: '테스트상품', status: '접수대기', ship_status: '미출고', order_type: 'fulfillment', order_no: 2, item_no: 1, seller_order_no: 2, created_at: '2026-11-11T03:42:00Z', origin_created_at: '2026-11-08T06:45:00Z' }],
  couriers: [{ id: 'c1', name: '우체국택배', sort_order: 1 }],
  address_book: [], pickup_requests: [{ id: 'p1', seller_id: ids.admin, seller_company: '에이치제이', orderer_name: '에이치제이', orderer_phone: '01068626822', store_name: '엑시토', store_location: '벨포스트 3층 12호', store_phone: '01075049991', prepay: true, prepay_misong: false, agreed: true, memo: '비회원 간단접수 #5 오늘 픽업 부탁드립니다', status: '확인', created_at: new Date().toISOString(), origin_created_at: '2026-11-08T06:45:00Z', handled_at: '2026-11-11T09:00:00Z' }], settlements: [], settle_contacts: [{ company: '럭스걸', phone: '01077778888' }, { company: '유어피치', phone: '' }],
  shipments: [], admin_hidden_orders: [], admin_separate_orders: [],
};
let nextShipId = 1;
const signups = [], recovers = [], activityQueries = [];
const now = Date.now();
const iso = m => new Date(now - m * 60000).toISOString();
const activity = [
  ...[1,2,3].map(i => ({ id: 10 + i, at: iso(1), tx: 900, actor_id: '00000000-0000-0000-0000-0000000000c1', actor_name: '김민지', actor_level: 'staff', table_name: 'orders', action: 'update', row_key: 'ORD-' + i, info: { seller_company: '가나 샵', recipient: '고객' + i, product: '니트 블랙', order_no: 100 + i, item_no: 1 }, changes: { status: ['접수대기', '접수완료'], accepted_at: [null, iso(1)] } })),
  { id: 5, at: iso(2), tx: 800, actor_id: '00000000-0000-0000-0000-0000000000ad', actor_name: '이현재', actor_level: 'owner', table_name: 'inventory', action: 'update', row_key: '55', info: { company: '럭스걸', qty_a: 3 }, changes: { qty_a: [5, 3] } },
  { id: 4, at: iso(3), tx: 700, actor_id: '00000000-0000-0000-0000-0000000000c1', actor_name: '김민지', actor_level: 'staff', table_name: 'pickup_requests', action: 'update', row_key: 'p1', info: { seller_company: '에이치제이', store_name: '엑시토', status: '완료' }, changes: { status: ['확인', '완료'] } },
  { id: 3, at: iso(4), tx: 600, actor_id: '00000000-0000-0000-0000-0000000000ad', actor_name: '이현재', actor_level: 'owner', table_name: 'orders', action: 'delete', row_key: 'ORD-9', info: { seller_company: '유어피치', recipient: '박고객', product: '청바지', order_no: 88, item_no: 1 } },
];
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


fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
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
    requests.push({ method, path: url.pathname, search: url.search, body });
    const json = (status, data) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const who = whoFrom(headers);

    if (url.pathname === '/auth/v1/token') {
      const u = users[body.email];
      if (!u || u.pw !== body.password) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
      return json(200, { access_token: tokenFor(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: userObj(u) });
    }
    if (url.pathname === '/auth/v1/user') return who ? json(200, userObj(who)) : json(401, { msg: 'no' });
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });

    if (url.pathname === '/auth/v1/signup') {
      signups.push(body);
      const id = '00000000-0000-0000-0000-0000000000' + (10 + signups.length);
      users[body.email] = { id, pw: body.password, profile: { id, email: body.email, company: body.data.company, name: body.data.name, phone: '', role: 'seller', admin_level: null, status: 'pending', created_at: new Date().toISOString() } };
      return json(200, { id, email: body.email, aud: 'authenticated', role: 'authenticated', identities: [{}], user_metadata: body.data, created_at: new Date().toISOString() });
    }
    if (url.pathname === '/auth/v1/recover') { recovers.push(body.email); return json(200, {}); }
    if (url.pathname === '/rest/v1/rpc/staff_set') {
      if (!(who && who.profile.role === 'admin' && who.profile.admin_level === 'owner')) return json(400, { code: 'P0001', message: '대표 아이디만 직원을 관리할 수 있습니다.' });
      const u = users[body.p_email]; if (!u) return json(400, { code: 'P0001', message: '가입된 아이디를 찾지 못했습니다' });
      Object.assign(u.profile, body.p_on ? { role: 'admin', admin_level: 'staff', status: 'approved' } : { role: 'seller', admin_level: 'staff', status: 'suspended' });
      if (body.p_name) u.profile.name = body.p_name;
      return json(200, { id: u.id, on: body.p_on });
    }
    if (url.pathname === '/rest/v1/admin_activity') {
      activityQueries.push(url.search);
      if (!(who && who.profile.admin_level === 'owner')) return json(200, []);
      let rows = applyFilters(activity, url);
      for (const [k, v] of url.searchParams) {
        if (v.startsWith('gte.')) rows = rows.filter(r => r[k] >= decodeURIComponent(v.slice(4)));
        if (v.startsWith('lt.')) rows = rows.filter(r => r[k] < decodeURIComponent(v.slice(3)));
      }
      return json(200, rows);
    }
    if (url.pathname === '/rest/v1/profiles') {
      const isAdmin = who && who.profile.role === 'admin';
      let rows = Object.values(users).map(u => u.profile).filter(p => isAdmin || (who && p.id === who.id));
      rows = applyFilters(rows, url);
      if ((headers['accept'] || '').includes('vnd.pgrst.object')) return rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' });
      return json(200, rows);
    }
    if (url.pathname === '/rest/v1/rpc/get_shipment') {
      const s = tables.shipments.find(x => x.token === body.p_token);
      return json(200, s ? { company: s.company, ship_date: s.ship_date, items: s.items, parcel_count: s.parcel_count, unshipped_count: s.unshipped_count, extra_fee: s.extra_fee } : null);
    }
    if (url.pathname === '/rest/v1/shipments') {
      const isAdmin = who && who.profile.role === 'admin';
      if (!isAdmin) return json(401, { message: 'permission denied' });
      if (method === 'GET') return json(200, applyFilters(tables.shipments, url));
      if (method === 'POST') {
        const list = Array.isArray(body) ? body : [body];
        for (const r of list) {
          const old = tables.shipments.find(x => x.company === r.company && x.ship_date === r.ship_date);
          if (old) Object.assign(old, r); else tables.shipments.push({ id: nextShipId++, sent_at: null, send_status: null, send_error: null, ...r });
        }
        return json(201, list);
      }
      if (method === 'PATCH') { const rows = applyFilters(tables.shipments, url); rows.forEach(r => Object.assign(r, body)); return json(200, rows); }
      if (method === 'DELETE') { const rows = applyFilters(tables.shipments, url); tables.shipments = tables.shipments.filter(r => !rows.includes(r)); return json(200, rows); }
    }
    const table = url.pathname.replace('/rest/v1/', '');
    if (['admin_hidden_orders', 'admin_separate_orders'].includes(table) && !(who && who.profile.role === 'admin')) return json(401, { message: 'permission denied' });
    if (tables[table]) {
      if (method === 'GET') return json(200, applyFilters(tables[table], url));
      if (method === 'POST') { const list = Array.isArray(body) ? body : [body]; list.forEach(r => { if (!tables[table].some(x => x.order_id === r.order_id)) tables[table].push(r); }); return json(201, list); }
      if (method === 'PATCH') { const rows = applyFilters(tables[table], url); rows.forEach(r => Object.assign(r, body)); return json(200, rows); }
      if (method === 'DELETE') { const rows = applyFilters(tables[table], url); tables[table] = tables[table].filter(r => !rows.includes(r)); return json(200, rows); }
    }
    return json(404, { message: 'unmocked ' + url.pathname });
  });



  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => { pageErrors.push(e.message); console.log('PAGE ERROR:', e.message); });
  page.on('dialog', async d => { dialogs.push(d.message()); if (d.type() === 'prompt') await d.accept('민지 매니저'); else await d.accept(); });
  const results = [];
  const check = (name, cond, extra = '') => { const l = `${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`; results.push(l); console.log(l); };
  const OUT = process.env.OUT_DIR || path.join(__dirname, 'out');
  fs.mkdirSync(OUT, { recursive: true });
  const login = async (email, pw) => {
    await page.goto(PAGE); await page.waitForTimeout(800);
    await page.click('#tab-btn-admin');
    await page.fill('#login-email', email); await page.fill('#login-pw', pw);
    await page.click('#btn-login'); await page.waitForTimeout(1500);
  };
  await login('admin@x.com', 'adminpass1');
  await page.screenshot({ path: path.join(OUT, 'staff-0-admin-top.png'), clip: { x: 0, y: 0, width: 1400, height: 350 } });
  if (process.env.BEFORE_ONLY) { await browser.close(); return; }
  check('owner sees [직원 관리] group', await page.isVisible('#admin-group-staff'));
  check('header shows 대표 name', (await page.textContent('#nav-user-area')).includes('이현재 대표'));
  await page.click('#admin-group-staff'); await page.waitForTimeout(800);
  check('activity tab opens first', await page.isVisible('#admin-activity-panel') && await page.isVisible('#admin-tab-staff'));
  const act = (await page.textContent('#activity-list')).replace(/\s+/g, ' ');
  check('activity grouped: 3건 한 번에 수정 by 김민지 직원', act.includes('3건 한 번에 수정') && act.includes('김민지') && act.includes('접수대기') && act.includes('접수완료'), act.slice(0, 300));
  check('activity: inventory + delete rows', act.includes('재고표') && act.includes('상품화') && act.includes('삭제') && act.includes('박고객'));
  await page.screenshot({ path: path.join(OUT, 'staff-2-activity.png'), fullPage: false });
  await page.selectOption('#activity-actor', '00000000-0000-0000-0000-0000000000c1');
  await page.click('#admin-activity-panel button:has-text("조회")'); await page.waitForTimeout(600);
  check('actor filter sent', activityQueries[activityQueries.length - 1].includes('actor_id=eq.00000000-0000-0000-0000-0000000000c1'));
  await page.fill('#activity-search', '엑시토'); await page.waitForTimeout(200);
  check('search filter', (await page.textContent('#activity-count')).startsWith('1건'), await page.textContent('#activity-count'));

  await page.click('#admin-tab-staff'); await page.waitForTimeout(800);
  const st = (await page.textContent('#staff-list')).replace(/\s+/g, ' ');
  check('staff list shows owner + old staff (꺼짐)', st.includes('대표') && st.includes('이현재') && st.includes('이전직원') && st.includes('꺼짐'), st);
  await page.fill('#staff-add-name', '김민지'); await page.fill('#staff-add-email', 'minji@x.com');
  await page.click('#staff-add-btn'); await page.waitForTimeout(1500);
  check('signup called via temp client', signups.length === 1 && signups[0].email === 'minji@x.com' && signups[0].data.name === '김민지', JSON.stringify(signups));
  check('staff_set → staff admin', users['minji@x.com'] && users['minji@x.com'].profile.role === 'admin' && users['minji@x.com'].profile.admin_level === 'staff');
  check('password mail sent', recovers.includes('minji@x.com'));
  check('owner still logged in as owner', (await page.textContent('#nav-user-area')).includes('이현재 대표'));
  const st2 = (await page.textContent('#staff-list')).replace(/\s+/g, ' ');
  check('new staff row 사용 중', st2.includes('김민지') && st2.includes('minji@x.com') && st2.includes('사용 중'), st2);
  check('seller list excludes staff', !(await page.textContent('#seller-admin-list')).includes('minji@x.com'));
  await page.screenshot({ path: path.join(OUT, 'staff-1-staff-tab.png'), fullPage: false });
  check('last dialog explains mail', dialogs[dialogs.length - 1].includes('비밀번호 재설정'), dialogs[dialogs.length - 1]);

  // 다시 켜기 (이전직원)
  await page.click('#staff-list tr:has-text("이전직원") button:has-text("다시 켜기")'); await page.waitForTimeout(800);
  check('turn on old staff', users['old@x.com'].profile.role === 'admin');
  await page.click('#staff-list tr:has-text("이전직원") button:has-text("끄기")'); await page.waitForTimeout(800);
  check('turn off again', users['old@x.com'].profile.role === 'seller');

  // 꺼진 직원 로그인 막기
  await page.evaluate(() => logout()); await page.waitForTimeout(800);
  await login('old@x.com', 'oldpass11');
  check('turned-off staff blocked', dialogs.some(d => d.includes('꺼져 있습니다')) && !(await page.isVisible('#admin-dashboard')));

  // 직원 로그인: 관리자 화면 OK, [직원 관리] 안 보임
  users['minji@x.com'].pw = 'minjipass1';
  await login('minji@x.com', 'minjipass1');
  check('staff enters admin dashboard', await page.isVisible('#admin-dashboard'));
  check('staff does not see [직원 관리]', !(await page.isVisible('#admin-group-staff')));
  check('header shows 김민지 직원', (await page.textContent('#nav-user-area')).includes('김민지 직원'));
  await page.screenshot({ path: path.join(OUT, 'staff-3-staff-login.png'), clip: { x: 0, y: 0, width: 1400, height: 350 } });

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
  console.log(results.filter(r => r.startsWith('FAIL')).length ? 'SOME FAILED' : 'ALL PASS');
})();
