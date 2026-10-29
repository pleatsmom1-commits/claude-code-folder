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
  const asked = [];
  await page.route('**/*', async route => {
    const u = route.request().url();
    const lib = Object.keys(LIB).find(k => u.includes(k));
    if (lib) return route.fulfill({ body: fs.readFileSync(path.join(NM, LIB[lib])), contentType: 'application/javascript' });
    if (u.startsWith('http://site.test/api/ask')) {
      const body = JSON.parse(route.request().postData());
      asked.push(body);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ answer: '픽업비는 매장당 1,800원입니다.' }) });
    }
    if (u.startsWith('http://site.test/')) {
      const f = path.join(ROOT, new URL(u).pathname === '/' ? 'index.html' : new URL(u).pathname);
      if (fs.existsSync(f)) return route.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.js') ? 'application/javascript' : 'text/html' });
    }
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
  ok(errors.length === 0, 'no page script errors', errors.join(' | '));
  await browser.close();
})();
