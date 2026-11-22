// 관리자 > AI 상담 > 답변하지 못한 질문 E2E (supabase/ai_unanswered.sql)
// 실제 Supabase 대신 메모리 속 가짜 서버를 씁니다. 사용: cd tests && npm install && node e2e-unanswered.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const NM = path.join(__dirname, 'node_modules');
const ROOT = process.env.ROOT_DIR || path.join(__dirname, '..');
const PAGE = 'file://' + path.join(ROOT, 'index.html') + '?test';
const LIB = {
  'cdn.tailwindcss.com': '@tailwindcss/browser/dist/index.global.js',
  'xlsx-js-style': 'xlsx-js-style/dist/xlsx.bundle.js',
  'jszip': 'jszip/dist/jszip.min.js',
  'lucide': 'lucide/dist/umd/lucide.min.js',
  'supabase-js': '@supabase/supabase-js/dist/umd/supabase.js',
};
const admin = { id: '00000000-0000-0000-0000-0000000000ad', pw: 'adminpass1', profile: { id: '00000000-0000-0000-0000-0000000000ad', email: 'admin@x.com', company: '밤낮', name: '대표', phone: '', role: 'admin', admin_level: 'owner', status: 'approved', created_at: '2026-08-01T00:00:00Z' } };
const H = h => new Date(Date.now() - h * 3600000).toISOString();
const MSG = '이 부분은 관리자가 직접 확인해 드려야 해요. 아래 노란 \'관리자와 상담하기\' 버튼을 누르면 카카오톡 채널로 바로 상담하실 수 있어요.';
const tables = {
  ai_faq: [{ id: 1, question: '토요일에도 픽업하나요?', answer: '네, 토요일도 픽업합니다.', active: true }],
  ai_chat_logs: [
    { id: 1, created_at: H(30), chat_id: 'c1', question: '반품 접수는 어떻게 하나요?', answer: MSG, needs_human: true, source: 'https://www.bamnatdelivery.com/' },
    { id: 2, created_at: H(5), chat_id: 'c2', question: '반품 접수는 어떻게 하나요', answer: MSG, needs_human: true, source: 'https://bamnat-delivery.bamnat.workers.dev/' },
    { id: 3, created_at: H(2), chat_id: 'c3', question: '반품 접수는 어떻게 하나요??', answer: MSG, needs_human: true, source: 'https://bamnat1.dothome.co.kr/' },
    { id: 4, created_at: H(48), chat_id: 'c4', question: '제주도도 당일택배 되나요?', answer: MSG, needs_human: true, source: 'https://www.bamnatdelivery.com/' },
    { id: 5, created_at: H(47.9), chat_id: 'c4', question: '그럼 제주도 추가 요금은요?', answer: MSG, needs_human: true, source: 'https://www.bamnatdelivery.com/' },
    { id: 6, created_at: H(3), chat_id: 'c5', question: '이 화면에서 뭘 눌러야 하나요?\n[사진 1장]', answer: '사진이 흐려서 잘 안 보여요. 관리자와 상담하기로 문의해 주세요.', needs_human: true, source: 'https://bamnat-delivery.bamnat.workers.dev/' },
    { id: 7, created_at: H(1), chat_id: 'c6', question: '토요일에도 픽업 하나요', answer: MSG, needs_human: true, source: 'https://bamnat-delivery.bamnat.workers.dev/' },
    { id: 8, created_at: H(1.9), chat_id: 'c3', question: '픽업비는 얼마예요?', answer: '매장당 1,800원입니다.', needs_human: false, source: 'https://bamnat1.dothome.co.kr/' },
  ].map(r => ({ resolved_at: null, resolved_how: null, faq_id: null, ...r })),
};

const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = b64url({ alg: 'HS256', typ: 'JWT' }) + '.' + b64url({ sub: admin.id, email: 'admin@x.com', exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated', aud: 'authenticated' }) + '.sig';
const userObj = { id: admin.id, email: 'admin@x.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
function applyFilters(rows, url) {
  for (const [k, v] of url.searchParams) {
    if (['select', 'order', 'offset', 'limit', 'columns', 'on_conflict'].includes(k)) continue;
    if (v === 'is.null') rows = rows.filter(r => r[k] == null);
    else if (v.startsWith('eq.')) rows = rows.filter(r => String(r[k]) === decodeURIComponent(v.slice(3)));
    else if (v.startsWith('in.(')) { const list = v.slice(4, -1).split(',').map(x => x.replace(/^"|"$/g, '')); rows = rows.filter(r => list.includes(String(r[k]))); }
  }
  return rows;
}

(async () => {
  const OUT = process.env.OUT_DIR || path.join(__dirname, 'out');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 1300 }, deviceScaleFactor: Number(process.env.DSF || 1) });
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
    if (url.pathname === '/auth/v1/token') return json(200, { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: userObj });
    if (url.pathname === '/auth/v1/user') return json(200, userObj);
    if (url.pathname === '/rest/v1/profiles') {
      return (headers['accept'] || '').includes('vnd.pgrst.object') ? json(200, admin.profile) : json(200, [admin.profile]);
    }
    const table = url.pathname.replace('/rest/v1/', '');
    if (tables[table]) {
      if (method === 'GET' || method === 'HEAD') {
        let rows = applyFilters(tables[table], url);
        const ord = url.searchParams.get('order');
        if (ord) { const [c, d] = ord.split('.'); rows = rows.slice().sort((a, b) => (a[c] > b[c] ? 1 : -1) * (d === 'desc' ? -1 : 1)); }
        return json(200, rows);
      }
      if (method === 'POST') {
        const list = (Array.isArray(body) ? body : [body]).map(r => ({ id: 100 + tables[table].length, ...r }));
        tables[table].push(...list);
        return (headers['accept'] || '').includes('vnd.pgrst.object') ? json(201, list[0]) : json(201, list);
      }
      if (method === 'PATCH') { const rows = applyFilters(tables[table], url); rows.forEach(r => Object.assign(r, body)); return json(200, rows); }
    }
    if (method === 'HEAD') return route.fulfill({ status: 200, headers: { ...cors, 'content-range': '0-0/0' } });
    return json(200, []);
  });

  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', e => { errs.push(e.message); console.log('PAGE ERROR:', e.message); });
  page.on('dialog', d => d.accept());
  const check = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  -- ' + x : ''}`); if (!c) process.exitCode = 1; };
  await page.goto(PAGE); await page.waitForTimeout(800);
  await page.click('#tab-btn-admin');
  await page.fill('#login-email', 'admin@x.com'); await page.fill('#login-pw', 'adminpass1');
  await page.click('#btn-login'); await page.waitForTimeout(1500);
  await page.click('#admin-group-inquiry'); await page.waitForTimeout(500);
  await page.click('#admin-tab-chatlog'); await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'unanswered-before.png'), clip: { x: 0, y: 0, width: 1400, height: 760 } });
  if (process.env.BEFORE_ONLY) { await browser.close(); return; }

  check('tab badge = 4 groups waiting', (await page.textContent('#admin-unanswered-badge')).trim() === '4', await page.textContent('#admin-unanswered-badge'));
  await page.click('#admin-tab-unanswered'); await page.waitForTimeout(800);
  let cards = await page.$$('[data-unanswered]');
  check('4 groups (반품 3개는 1개로, 토요일은 모음집에 있어 빠짐)', cards.length === 4, String(cards.length));
  const t0 = await cards[0].textContent();
  check('first group = 반품, 3번 물어봄', t0.includes('3번 물어봄') && t0.includes('반품'));
  check('photo tag', (await page.textContent('#unanswered-list')).includes('사진 질문'));
  const jeju = page.locator('[data-unanswered]', { hasText: '제주도도 당일택배' });
  await jeju.locator('summary').click();
  await jeju.locator('text=앞뒤 대화 불러오기').click(); await page.waitForTimeout(400);
  check('context shows same chat', (await jeju.textContent()).includes('추가 요금'));
  await jeju.locator('summary').click();
  await page.fill('[data-unanswered] >> nth=0 >> .un-a', '(예시) 반품은 상담창 아래 노란 [관리자와 상담하기]로 말씀해 주시면 관리자가 반품 접수 방법을 안내해 드립니다.');
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, 'unanswered-after.png'), clip: { x: 0, y: 220, width: 1400, height: 1000 } });

  await page.click('[data-unanswered] >> nth=0 >> text=답변 등록'); await page.waitForTimeout(800);
  const f = tables.ai_faq.find(x => x.question.includes('반품'));
  check('faq inserted (AI 모음집 등록)', !!f && f.answer.includes('반품 접수 방법') && f.active === true);
  check('3 logs resolved with faq_id', f && tables.ai_chat_logs.filter(r => r.faq_id === f.id && r.resolved_how === 'faq').length === 3);
  check('3 cards left', (await page.$$('[data-unanswered]')).length === 3);
  await page.locator('[data-unanswered]', { hasText: '사진 질문' }).locator('text=답 필요 없음').click(); await page.waitForTimeout(800);
  check('skip marks photo question', tables.ai_chat_logs.find(r => r.id === 6).resolved_how === 'skip');
  check('badge now 2', (await page.textContent('#admin-unanswered-badge')).trim() === '2');
  await page.selectOption('#unanswered-filter', 'faq'); await page.waitForTimeout(300);
  const done = await page.textContent('#unanswered-list');
  check('answered filter shows both', done.includes('반품 접수 방법') && done.includes('토요일도 픽업'));
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, 'unanswered-done.png'), clip: { x: 0, y: 220, width: 1400, height: 700 } });
  await page.selectOption('#unanswered-filter', 'skip'); await page.waitForTimeout(300);
  await page.click('text=다시 답변 기다림으로'); await page.waitForTimeout(800);
  check('reopen works', tables.ai_chat_logs.find(r => r.id === 6).resolved_at === null);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.selectOption('#unanswered-filter', 'open'); await page.waitForTimeout(300);
  await page.locator('#admin-unanswered-panel').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, 'unanswered-phone.png') });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check('phone: no sideways scroll', sw <= 392, String(sw));
  check('no page errors', !errs.length, errs.join(' | '));
  await browser.close();
})();
