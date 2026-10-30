// "궁금한 점 물어보기" AI 상담창 화면 점검 (AI 답변은 가짜로 대신함). 사용: cd tests && node e2e-chat.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const NM = path.join(__dirname, 'node_modules');
const LIB = {
  'cdn.tailwindcss.com': '@tailwindcss/browser/dist/index.global.js',
  'xlsx-js-style': 'xlsx-js-style/dist/xlsx.bundle.js',
  'jszip': 'jszip/dist/jszip.min.js',
  'lucide': 'lucide/dist/umd/lucide.min.js',
  'supabase-js': '@supabase/supabase-js/dist/umd/supabase.js',
};
const ok = (c, m, x = '') => { console.log(c ? 'PASS ' : 'FAIL ', m, x ? ' -- ' + x : ''); if (!c) process.exitCode = 1; };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const asked = [], leads = [];
  await page.route('**/*', async route => {
    const u = route.request().url();
    const lib = Object.keys(LIB).find(k => u.includes(k));
    if (lib) return route.fulfill({ body: fs.readFileSync(path.join(NM, LIB[lib])), contentType: 'application/javascript' });
    if (u.startsWith('http://site.test/api/ask')) {
      const body = JSON.parse(route.request().postData());
      asked.push(body);
      const human = body.messages[body.messages.length - 1].content.includes('견적');
      return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(human ? { answer: '이 부분은 대표님이 직접 확인해서 연락드릴게요.', needsHuman: true } : { answer: '픽업비는 매장당 1,800원입니다.', needsHuman: false }) });
    }
    if (u.startsWith('http://site.test/api/inquiry')) {
      leads.push(JSON.parse(route.request().postData()));
      return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ status: 'saved' }) });
    }
    if (u.startsWith('http://site.test/')) {
      const f = path.join(ROOT, new URL(u).pathname === '/' ? 'index.html' : new URL(u).pathname);
      if (fs.existsSync(f)) return route.fulfill({ body: fs.readFileSync(f), contentType: (f.endsWith('.js') ? 'application/javascript' : 'text/html') + '; charset=utf-8' });
    }
    if (u === 'http://www.bamnatdelivery.com/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<html><body><h1>밤낮딜리버리 홈</h1><a href="#" class="bn-chat-open" id="newbiz">신규업체 상담전용</a><script src="http://site.test/chat.js" data-bottom="90" defer></script></body></html>' });
    if (u.includes('supabase.co')) return route.fulfill({ contentType: 'application/json', body: '[]' });
    return route.abort();
  });
  await page.goto('http://site.test/');
  await page.waitForTimeout(1500);
  ok(await page.isVisible('#bn-chat-btn'), 'chat button visible on login screen');
  ok(await page.locator('text=로그인').first().isVisible(), 'login screen still shows');
  await page.click('#bn-chat-btn');
  ok(await page.isVisible('#bn-chat'), 'chat opens');
  await page.click('#bn-chat .bn-quick button >> nth=0');
  await page.waitForSelector('#bn-chat .bn-ai >> text=1,800원');
  ok(asked.length === 1 && asked[0].messages[0].content.includes('픽업비'), 'quick question sent');
  await page.fill('#bn-chat textarea', '당일택배 지역은?');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#bn-chat .bn-ai').length >= 3 && !document.querySelector('#bn-chat form button').disabled);
  ok(asked[1].messages.length === 3 && asked[1].messages[1].role === 'assistant', 'history sent with follow-up', JSON.stringify(asked[1].messages.map(m => m.role)));
  await page.screenshot({ path: path.join(__dirname, 'chat.png') });
  const box = await page.locator('#bn-chat').boundingBox();
  ok(box.x >= 0 && box.x + box.width <= 390, 'fits phone width');
  await page.click('#bn-chat header button');
  ok(!(await page.isVisible('#bn-chat')), 'chat closes');
  // 홈페이지에 한 줄로 붙였을 때: 질문이 상담창 파일을 올린 사이트(/api/ask)로 가는지
  await page.goto('http://www.bamnatdelivery.com/');
  await page.waitForSelector('#bn-chat-btn');
  await page.click('#bn-chat-btn');
  await page.fill('#bn-chat textarea', '풀필먼트 요금?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#bn-chat .bn-ai >> text=1,800원');
  ok(asked.length === 3, 'homepage embed asks the site API');
  const bb = await page.locator('#bn-chat-btn').boundingBox();
  ok(Math.round(800 - bb.y - bb.height) === 90, 'data-bottom raises floating button', String(800 - bb.y - bb.height));
  // AI 가 모르는 질문 → 연락처 남기기
  await page.fill('#bn-chat textarea', '100건 견적 받을 수 있나요?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#bn-chat .bn-lead');
  ok((await page.inputValue('#bn-chat .bn-lead [name=question]')) === '100건 견적 받을 수 있나요?', 'lead form opens with question');
  await page.fill('#bn-chat .bn-lead [name=company]', '새샵');
  await page.fill('#bn-chat .bn-lead [name=phone]', '010-1234-5678');
  await page.click('#bn-chat .bn-lead .bn-send');
  ok((await page.textContent('#bn-chat .bn-lead .bn-err')).includes('동의') && leads.length === 0, 'consent required');
  await page.check('#bn-chat .bn-lead [name=consent]');
  await page.screenshot({ path: path.join(__dirname, 'out', 'chat-lead.png') });
  await page.click('#bn-chat .bn-lead .bn-send');
  await page.waitForSelector('#bn-chat .bn-ai >> text=문의가 접수됐어요');
  ok(leads.length === 1 && leads[0].phone === '01012345678' && leads[0].consent === true && leads[0].chatLog.length === 4 && leads[0].source.includes('bamnatdelivery'), 'lead sent with chat log', JSON.stringify(leads[0]).slice(0, 200));
  // 홈페이지 버튼(class="bn-chat-open")으로 열기
  await page.click('#bn-chat header button');
  await page.click('#newbiz');
  ok(await page.isVisible('#bn-chat'), 'bn-chat-open button opens chat');
  ok(errors.length === 0, 'no page script errors', errors.join(' | '));
  await browser.close();
})();
