// AI 상담창 "지난 대화 이어 보기" 점검. 사용: cd tests && node e2e-chat-resume.js [그림폴더]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const SHOTS = process.argv[2];
const ok = (c, m, x = '') => { console.log(c ? 'PASS ' : 'FAIL ', m, x ? ' -- ' + x : ''); if (!c) process.exitCode = 1; };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 760 }, deviceScaleFactor: SHOTS ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  const asked = [];
  let fail = false;
  await page.route('**/*', async route => {
    const u = route.request().url();
    if (u.startsWith('http://site.test/api/ask')) {
      const body = JSON.parse(route.request().postData());
      asked.push(body);
      if (fail) return route.abort();
      const q = body.messages[body.messages.length - 1].content;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ answer: q.includes('픽업비') ? '픽업비는 매장당 1,800원이에요.' : '네, 오후 4시까지 접수하시면 당일 출고돼요.', needsHuman: false }) });
    }
    if (u === 'http://site.test/chat.js') return route.fulfill({ body: fs.readFileSync(path.join(ROOT, 'chat.js')), contentType: 'application/javascript; charset=utf-8' });
    if (u.startsWith('http://site.test/')) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<html><body style="font-family:sans-serif;background:#f8fafc"><h2 style="padding:16px">밤낮딜리버리 홈페이지</h2><a href="/m2" id="other">요금안내</a><script src="http://site.test/chat.js" defer></script></body></html>' });
    return route.abort();
  });
  await page.goto('http://site.test/');
  await page.click('#bn-chat-btn');
  ok(await page.isHidden('#bn-chat .bn-clear'), 'no clear button when nothing saved');
  await page.click('#bn-chat .bn-quick button >> nth=0');
  await page.waitForSelector('#bn-chat .bn-ai >> text=1,800원');
  await page.fill('#bn-chat textarea', '당일 출고 마감은 몇 시예요?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#bn-chat .bn-ai >> text=오후 4시');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '1_상담중.png') });
  const firstId = asked[0].chatId;

  // 다른 화면으로 갔다가 다시 와서 열기
  await page.goto('http://site.test/m2');
  await page.waitForSelector('#bn-chat-btn', { state: 'attached' });
  await page.click('#bn-chat-btn');
  const texts = await page.$$eval('#bn-chat .bn-msg', els => els.map(e => e.textContent));
  ok(texts.some(t => t.includes('1,800원')) && texts.some(t => t.includes('당일 출고 마감')), 'past chat shown after leaving page', JSON.stringify(texts));
  ok(await page.locator('#bn-chat .bn-day >> text=지난 상담').count() === 1, 'past chat date line');
  ok(await page.locator('#bn-chat .bn-quick').count() === 0, 'quick buttons hidden when continuing');
  ok(await page.isVisible('#bn-chat .bn-clear'), 'clear button shown');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '2_다시들어온뒤_이어보기.png') });

  await page.fill('#bn-chat textarea', '픽업비는 매장마다 따로예요?');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#bn-chat form button').disabled);
  const last = asked[asked.length - 1];
  ok(last.messages.length === 5 && last.messages[0].content.includes('픽업비'), 'AI gets earlier conversation as context', JSON.stringify(last.messages.map(m => m.role)));
  ok(last.chatId === firstId, 'same chat id continues for 상담 기록');

  // 답을 못 받은 질문은 보관 안 함
  fail = true;
  await page.fill('#bn-chat textarea', '연결 실패 질문');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#bn-chat form button').disabled);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bnChatSaved.v1')));
  ok(stored.msgs.length === 6 && !stored.msgs.some(m => m.content.includes('연결 실패')), 'failed question not saved', stored.msgs.length);
  fail = false;

  // 30일 지난 대화는 지워짐
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('bnChatSaved.v1')); d.at = Date.now() - 31 * 86400000; localStorage.setItem('bnChatSaved.v1', JSON.stringify(d)); });
  await page.reload();
  await page.click('#bn-chat-btn');
  ok(await page.locator('#bn-chat .bn-past').count() === 0 && await page.evaluate(() => localStorage.getItem('bnChatSaved.v1')) === null, 'chat older than 30 days removed');

  // 대화 지우기
  await page.click('#bn-chat .bn-quick button >> nth=0');
  await page.waitForSelector('#bn-chat .bn-ai >> text=1,800원');
  await page.reload();
  await page.click('#bn-chat-btn');
  ok(await page.locator('#bn-chat .bn-past').count() === 2, 'saved again after new chat');
  await page.click('#bn-chat .bn-clear');
  ok(await page.locator('#bn-chat .bn-past').count() === 0 && await page.evaluate(() => localStorage.getItem('bnChatSaved.v1')) === null, 'clear removes saved chat');
  ok(await page.locator('#bn-chat .bn-quick').count() === 1 && await page.isHidden('#bn-chat .bn-clear'), 'quick buttons back after clear');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '3_대화지우기_누른뒤.png') });
  await page.reload();
  await page.click('#bn-chat-btn');
  ok(await page.locator('#bn-chat .bn-past').count() === 0, 'stays cleared after reload');
  ok(errors.length === 0, 'no page errors', errors.join(' | '));
  await browser.close();
})();
