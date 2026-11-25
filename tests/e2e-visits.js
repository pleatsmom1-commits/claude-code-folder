// 방문 통계 E2E (visits.html, track.js, supabase/site_visits.sql)
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
const statsCalls = [];
// 그림용 예시 숫자 (실제 기록 아님)
function sampleStats(b) {
  const days = []; for (let t = new Date(b.p_from + 'T00:00:00Z'); t <= new Date(b.p_to + 'T00:00:00Z'); t = new Date(t.getTime() + 86400000)) days.push(t.toISOString().slice(0, 10));
  const daily = [];
  days.forEach((d, i) => {
    const wk = new Date(d).getUTCDay();
    const f = wk === 0 ? 0.3 : wk === 6 ? 0.6 : 1;
    daily.push({ day: d, site: 'app', views: Math.round((140 + i * 7) * f), sessions: Math.round((48 + i * 2) * f), visitors: Math.round((31 + i) * f), total_sec: Math.round((48 + i * 2) * f * 410) });
    daily.push({ day: d, site: 'cafe24', views: Math.round((95 + (i % 3) * 12) * f), sessions: Math.round((61 + (i % 3) * 8) * f), visitors: Math.round((52 + (i % 3) * 6) * f), total_sec: Math.round((61 + (i % 3) * 8) * f * 95) });
  });
  const pick = s => b.p_site ? b.p_site === s : true;
  const sum = (s, k) => daily.filter(r => r.site === s).reduce((a, r) => a + r[k], 0);
  const sites = ['app', 'cafe24'].filter(pick).map(s => ({ site: s, views: sum(s, 'views'), sessions: sum(s, 'sessions'), visitors: sum(s, 'visitors'), total_sec: sum(s, 'total_sec') }));
  return {
    sites, daily: daily.filter(r => pick(r.site)),
    pages: [{ site: 'app', path: '/', title: '밤낮딜리버리', views: 910, sessions: 330, total_sec: 910 * 380 }, { site: 'cafe24', path: '/', title: '밤낮딜리버리 홈', views: 520, sessions: 410, total_sec: 520 * 70 },
      { site: 'cafe24', path: '/m2.html', title: '요금안내', views: 210, sessions: 180, total_sec: 210 * 95 }, { site: 'app', path: '/inventory', title: '재고표', views: 160, sessions: 70, total_sec: 160 * 240 },
      { site: 'app', path: '/report', title: '출고 리포트', views: 90, sessions: 40, total_sec: 90 * 150 }, { site: 'cafe24', path: '/m4.html', title: '자주 묻는 질문', views: 85, sessions: 80, total_sec: 85 * 120 }].filter(p => pick(p.site)),
    clicks: [['app', '풀필먼트 접수', 420, 150], ['app', '엑셀 올리기', 260, 120], ['app', '사입팀 픽업요청', 140, 90], ['cafe24', '궁금한 점 물어보기', 120, 100], ['app', '쇼핑몰 주문서 그대로 올리기', 110, 60], ['app', '재고 확인', 95, 55], ['cafe24', '주문접수 바로가기', 80, 75], ['app', '송장번호 엑셀', 60, 40], ['app', '공지사항', 45, 40]]
      .filter(c => pick(c[0])).map(([site, label, clicks, sessions]) => ({ site, label, clicks, sessions, role: 'seller' })),
    referrers: [{ site: 'cafe24', referrer: 'search.naver.com', sessions: 160 }, { site: 'cafe24', referrer: 'm.search.naver.com', sessions: 70 }, { site: 'app', referrer: 'www.bamnatdelivery.com', sessions: 110 }, { site: 'cafe24', referrer: 'www.google.com', sessions: 40 }, { site: 'app', referrer: 'talk.kakao.com', sessions: 35 }].filter(r => pick(r.site)),
    devices: [{ device: 'mobile', sessions: 520 }, { device: 'pc', sessions: 380 }],
    roles: pick('app') ? [{ role: 'seller', sessions: 300 }, { role: 'guest', sessions: 90 }, { role: 'admin', sessions: 40 }] : [],
    hours: Array.from({ length: 24 }, (_, h) => ({ hour: h, views: Math.round(10 + 80 * Math.exp(-((h - 15) ** 2) / 18) + 50 * Math.exp(-((h - 23) ** 2) / 4)) })),
  };
}
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
    if (url.pathname === '/rest/v1/rpc/site_visit_stats') {
      statsCalls.push(body);
      if (!(who && who.profile.role === 'admin')) return json(400, { code: 'P0001', message: '관리자만 볼 수 있습니다.' });
      return json(200, sampleStats(body));
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
  page.on('dialog', d => d.accept());
  const results = [];
  const check = (name, cond, extra = '') => { const l = `${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`; results.push(l); console.log(l); };
  const OUT = process.env.OUT_DIR || path.join(__dirname, 'out');
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto(PAGE); await page.waitForTimeout(800);
  await page.click('#tab-btn-admin');
  await page.fill('#login-email', 'admin@x.com'); await page.fill('#login-pw', 'adminpass1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'visits-0-admin-top.png'), clip: { x: 0, y: 0, width: 1400, height: 330 } });
  if (process.env.BEFORE_ONLY) { await browser.close(); return; }
  check('[방문 통계] group visible', await page.isVisible('#admin-group-visits'));
  await page.click('#admin-group-visits'); await page.waitForTimeout(2000);
  check('visits panel + iframe src', await page.isVisible('#admin-visits-panel') && (await page.getAttribute('#admin-visits-frame', 'src')) === 'visits.html?embed=1');
  const frame = page.frame({ url: /visits\.html/ });
  await frame.waitForSelector('#app:not(.hidden)', { timeout: 5000 }).catch(() => {});
  const txt = (await frame.textContent('body')).replace(/\s+/g, ' ');
  check('stats rpc called (7 days)', statsCalls.length === 1 && statsCalls[0].p_site === null, JSON.stringify(statsCalls));
  check('site cards', txt.includes('주문접수 사이트') && txt.includes('카페24 홈페이지') && txt.includes('새 홈페이지') && txt.includes('아직 기록이 없어요'));
  check('clicks + pages + referrer names', txt.includes('풀필먼트 접수') && txt.includes('택배접수(첫 화면)') && txt.includes('네이버 검색') && txt.includes('구글 검색'), txt.slice(0, 400));
  check('visitors shown (하루 1명)', txt.includes('방문자 수') && txt.includes('1명 하루 1번') && txt.includes('날짜별 방문자 수'));
  check('header hidden in embed', !(await frame.isVisible('#page-header')));
  await page.screenshot({ path: path.join(OUT, 'visits-1-tab.png'), fullPage: true });
  await page.setViewportSize({ width: 1400, height: 2000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'visits-1-tab-long.png'), fullPage: true });
  await page.screenshot({ path: path.join(OUT, 'visits-2-top.png'), clip: { x: 0, y: 380, width: 1400, height: 640 } });
  if (process.env.SHOTS_ONLY) { await browser.close(); return; }
  await frame.selectOption('#f-site', 'cafe24'); await page.waitForTimeout(800);
  check('site filter sent', statsCalls[statsCalls.length - 1].p_site === 'cafe24');
  await frame.click('#range-btns button:has-text("최근 30일")'); await page.waitForTimeout(800);
  const last = statsCalls[statsCalls.length - 1];
  check('30-day range', (new Date(last.p_to) - new Date(last.p_from)) / 86400000 === 29, JSON.stringify(last));
  // 셀러는 탭을 볼 수 없음
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
  const fails = results.filter(r => r.startsWith('FAIL'));
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
})();
