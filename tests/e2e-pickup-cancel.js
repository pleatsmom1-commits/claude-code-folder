// 셀러 [사입팀 픽업요청] > 내 픽업요청 내역: [취소] / [재등록] E2E
// 실제 Supabase 대신 메모리 속 가짜 서버를 씁니다. 사용: cd tests && npm install && node e2e-pickup-cancel.js [파일이름앞부분]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const NM = path.join(__dirname, 'node_modules');
const ROOT = path.join(__dirname, '..');
const INDEX = 'file://' + path.join(ROOT, 'index.html') + '?test';
const SHOT = process.argv[2] || 'shot-pickup';
const LIB = {
  'cdn.tailwindcss.com': '@tailwindcss/browser/dist/index.global.js',
  'xlsx-js-style': 'xlsx-js-style/dist/xlsx.bundle.js',
  'jszip': 'jszip/dist/jszip.min.js',
  'lucide': 'lucide/dist/umd/lucide.min.js',
  'supabase-js': '@supabase/supabase-js/dist/umd/supabase.js',
};
const ids = { seller: '00000000-0000-0000-0000-00000000000a', other: '00000000-0000-0000-0000-00000000000b' };
const users = {
  'seller@x.com': { id: ids.seller, pw: 'password1', profile: { id: ids.seller, email: 'seller@x.com', company: '가나샵', name: '김', phone: '010-1111-2222', role: 'seller', status: 'approved', created_at: '2026-09-01T00:00:00Z' } },
};
const ago = h => new Date(Date.now() - h * 3600000).toISOString();
const R = (id, store, loc, phone, status, h, extra = {}) => ({ id, seller_id: ids.seller, seller_company: '가나샵', orderer_name: '가나샵', orderer_phone: '010-1111-2222', store_name: store, store_location: loc, store_phone: phone, prepay: true, prepay_misong: true, agreed: true, memo: null, status, created_at: ago(h), ...extra });
const tables = {
  pickup_requests: [
    R('p1', '블레싱', '신평화 4층 A445', '010-6664-1112', '접수', 1, { memo: '검정 니트 2장' }),
    R('p2', '오케이', '디오트 2층 B 1호', '010-4446-3214', '취소', 30, { prepay: false, prepay_misong: false, agreed: false }),
    R('p3', '라라', '청평화 1층 12호', '010-2222-3333', '완료', 60),
    R('p9', '남의매장', '어딘가', '010', '접수', 2, { seller_id: ids.other }),
  ],
};
const requests = [];
const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenFor = u => b64url({ alg: 'HS256', typ: 'JWT' }) + '.' + b64url({ sub: u.id, email: u.profile.email, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated', aud: 'authenticated' }) + '.sig';
const userObj = u => ({ id: u.id, email: u.profile.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
function whoFrom(headers) {
  const parts = (headers['authorization'] || '').replace('Bearer ', '').split('.');
  if (parts.length !== 3) return null;
  try { const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); return Object.values(users).find(u => u.id === p.sub) || null; } catch { return null; }
}
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: Number(process.env.VW || 900), height: 900 } });
  await context.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.protocol === 'file:' || url.protocol === 'about:') return route.continue();
    const lib = Object.entries(LIB).find(([k]) => req.url().includes(k));
    if (lib) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(NM, lib[1])) });
    if (!url.hostname.endsWith('supabase.co')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    const method = req.method();
    const headers = req.headers();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
    if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: cors });
    let body = null; try { body = req.postDataJSON(); } catch { body = null; }
    requests.push({ method, path: url.pathname, body });
    const json = (status, data) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const who = whoFrom(headers);
    const wantsObject = (headers['accept'] || '').includes('vnd.pgrst.object');
    if (url.pathname === '/auth/v1/token') {
      const u = users[body.email];
      if (!u || u.pw !== body.password) return json(400, { error: 'invalid_grant', msg: 'Invalid login credentials' });
      return json(200, { access_token: tokenFor(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: userObj(u) });
    }
    if (url.pathname === '/auth/v1/user') return who ? json(200, userObj(who)) : json(401, { msg: 'no' });
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/rest/v1/profiles') {
      const rows = who ? [who.profile] : [];
      if (wantsObject) return rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no rows' });
      return json(200, rows);
    }
    // supabase/pickup_cancel.sql 흉내: 내 요청 + '접수' 상태일 때만 취소
    if (url.pathname === '/rest/v1/rpc/cancel_my_pickup') {
      const r = tables.pickup_requests.find(x => x.id === body.p_id && who && x.seller_id === who.id && x.status === '접수');
      if (r) { r.status = '취소'; r.canceled_at = new Date().toISOString(); }
      return json(200, !!r);
    }
    if (url.pathname === '/rest/v1/pickup_requests') {
      if (method === 'GET') return json(200, tables.pickup_requests.filter(r => who && r.seller_id === who.id).sort((a, b) => b.created_at.localeCompare(a.created_at)));
      if (method === 'POST') {
        const rows = (Array.isArray(body) ? body : [body]).map((b, i) => ({ id: 'n' + Date.now() + i, seller_id: who.id, status: '접수', created_at: new Date().toISOString(), ...b }));
        tables.pickup_requests.push(...rows);
        return json(201, rows);
      }
      return json(403, { code: '42501', message: 'permission denied' });
    }
    if (method === 'GET') return json(200, []);
    return json(404, { message: 'unmocked ' + url.pathname });
  });

  const page = await context.newPage();
  const pageErrors = [];
  const dialogs = [];
  page.on('pageerror', e => { pageErrors.push(e.message); console.log('PAGE ERROR:', e.message); });
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  const results = [];
  const check = (name, cond, extra = '') => { const l = `${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`; results.push(l); console.log(l); };
  const shot = async name => {
    const el = await page.$('#pickup-my-list');
    const card = await el.evaluateHandle(e => e.closest('.bg-white') || e.parentElement);
    await card.screenshot({ path: path.join(__dirname, 'out', `${SHOT}-${name}.png`) });
  };

  await page.goto(INDEX); await page.waitForTimeout(800);
  await page.fill('#login-email', 'seller@x.com'); await page.fill('#login-pw', 'password1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  await page.click('#nav-pickup-btn'); await page.waitForTimeout(1200);
  const list = () => page.innerText('#pickup-my-list');
  check('my list shows only my 3 requests', (await list()).includes('블레싱') && (await list()).includes('라라') && !(await list()).includes('남의매장'));
  await shot('list');

  const hasNew = await page.$('[data-pk-cancel]');
  if (!hasNew) { console.log('(이전 버전: 버튼 없음 — 화면만 찍음)'); await browser.close(); return; }

  // 취소 버튼은 '접수' 상태에만
  check('cancel button only on 접수 row', (await page.$$('[data-pk-cancel]')).length === 1);
  check('re-register button on every row', (await page.$$('[data-pk-redo]')).length === 3);
  await page.click('[data-pk-cancel="p1"]'); await page.waitForTimeout(800);
  check('cancel asks confirm', dialogs.some(d => d.includes('취소할까요')), dialogs.join(' / '));
  check('p1 now 취소 in DB', tables.pickup_requests.find(r => r.id === 'p1').status === '취소');
  check('after cancel no cancel button', (await page.$$('[data-pk-cancel]')).length === 0);
  check('cancel used rpc', requests.some(r => r.path === '/rest/v1/rpc/cancel_my_pickup' && r.body.p_id === 'p1'));
  await shot('after-cancel');

  // 재등록: 폼에 채워지고, 접수 버튼을 눌러야 새로 접수됨
  const before = tables.pickup_requests.length;
  await page.click('[data-pk-redo="p1"]'); await page.waitForTimeout(500);
  check('redo fills store name', (await page.inputValue('#pk-store-name')) === '블레싱');
  check('redo fills location/phone/memo', (await page.inputValue('#pk-store-location')) === '신평화 4층 A445' && (await page.inputValue('#pk-store-phone')) === '010-6664-1112' && (await page.inputValue('#pk-memo')) === '검정 니트 2장');
  check('redo checks prepay/misong yes', await page.isChecked('input[name="pk-prepay"][value="yes"]') && await page.isChecked('input[name="pk-misong"][value="yes"]'));
  check('agree box shown but NOT auto-checked', await page.isVisible('#pk-agree-box') && !(await page.isChecked('#pk-agree')));
  check('no new row yet', tables.pickup_requests.length === before);
  await page.screenshot({ path: path.join(__dirname, 'out', `${SHOT}-redo-form.png`) });
  await page.check('#pk-agree');
  await page.click('#btn-pickup-submit'); await page.waitForTimeout(1000);
  const nr = tables.pickup_requests[tables.pickup_requests.length - 1];
  check('submit creates new request with same content', tables.pickup_requests.length === before + 1 && nr.store_name === '블레싱' && nr.prepay === true && nr.memo === '검정 니트 2장');
  check('new row has cancel button', (await page.$$('[data-pk-cancel]')).length === 1);

  // 대납없음 요청 재등록 → '아니오' 선택
  await page.click('[data-pk-redo="p2"]'); await page.waitForTimeout(400);
  check('redo p2 checks no/no', await page.isChecked('input[name="pk-prepay"][value="no"]') && await page.isChecked('input[name="pk-misong"][value="no"]') && !(await page.isVisible('#pk-agree-box')));
  check('redo p2 clears memo', (await page.inputValue('#pk-memo')) === '');

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
  const fail = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - fail} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
