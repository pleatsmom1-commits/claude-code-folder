// 상담창 사진 질문 점검 (2026-11-17): [📷 사진]·[🖥️ 화면 캡쳐]·붙여넣기 → 자르기·가리기 → 사진 1장과 함께 질문
// 사용: cd tests && node e2e-chat-photo.js   (SHOT=before|after 로 화면 그림 이름 바꿈)
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const SHOT = process.env.SHOT || 'shot';
const ok = (c, m, x = '') => { console.log(c ? 'PASS ' : 'FAIL ', m, x ? ' -- ' + x : ''); if (!c) process.exitCode = 1; };
fs.mkdirSync(OUT, { recursive: true });
// 예시 사진: 가짜 주문 확인표 그림 (개인정보 아님)
const SAMPLE = path.join(OUT, 'chat-sample.png');
const HOME = `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:sans-serif;background:#f8fafc}header{background:#1e3a8a;color:#fff;padding:14px 24px;font-weight:700}main{padding:24px}table{border-collapse:collapse;background:#fff}td,th{border:1px solid #cbd5e1;padding:8px 12px;font-size:13px}</style></head>
<body><header>밤낮딜리버리 주문접수 (예시 화면)</header><main><h3>쇼핑몰 주문서 확인표</h3><table><tr><th>받는분</th><th>연락처</th><th>상품</th><th>도매처명</th><th>상태</th></tr>
<tr><td>김예시</td><td>010-0000-1111</td><td>니트 머플러 / 블랙</td><td style="background:#fee2e2">(빈칸)</td><td style="color:#e11d48">도매처명 없음</td></tr>
<tr><td>이예시</td><td>010-0000-2222</td><td>울 팬츠 / M</td><td>청평화A</td><td style="color:#059669">OK</td></tr></table></main>
<script src="http://site.test/chat.js" defer></script></body></html>`;

async function routeAll(page, asked) {
  await page.route('**/*', async route => {
    const u = route.request().url();
    if (u.startsWith('http://site.test/api/ask')) {
      asked.push(JSON.parse(route.request().postData()));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ answer: '사진 속 빨간 칸(도매처명)에 도매처 이름을 적거나 [빈 도매처 칸을 쇼핑몰상품명으로 채우기]를 누르면 접수할 수 있어요.', needsHuman: false }) });
    }
    if (u === 'http://site.test/chat.js') return route.fulfill({ body: fs.readFileSync(path.join(ROOT, 'chat.js')), contentType: 'application/javascript; charset=utf-8' });
    if (u === 'http://site.test/') return route.fulfill({ body: HOME, contentType: 'text/html; charset=utf-8' });
    return route.abort();
  });
}

(async () => {
  const browser = await chromium.launch();
  // 예시 사진 만들기
  { const p = await browser.newPage({ viewport: { width: 900, height: 330 } }); await p.setContent(HOME.replace(/<script.*<\/script>/, '')); await p.screenshot({ path: SAMPLE }); await p.close(); }

  // ---------- PC ----------
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  // 화면 캡쳐(getDisplayMedia)는 자동 점검에서 진짜 화면을 못 고르므로, 예시 그림을 비추는 가짜 화면으로 대신함
  await page.addInitScript(() => {
    // 점검용 주소(http)는 보안 주소가 아니라 mediaDevices 가 없음 → 실제 사이트(https)처럼 만들어 줌
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
    navigator.mediaDevices.getDisplayMedia = async () => {
      const c = document.createElement('canvas'); c.width = 1200; c.height = 700;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 700); x.fillStyle = '#1e3a8a'; x.fillRect(0, 0, 1200, 60);
      x.fillStyle = '#111'; x.font = '28px sans-serif'; x.fillText('쇼핑몰 관리자 화면 (예시)', 40, 140);
      const s = c.captureStream(10); const t = setInterval(() => { x.fillRect(0, 690, 1, 1); }, 50); s.getTracks()[0].addEventListener('ended', () => clearInterval(t));
      window.__shotAsked = (window.__shotAsked || 0) + 1; return s;
    };
  });
  const asked = [];
  await routeAll(page, asked);
  await page.goto('http://site.test/'); await page.waitForSelector('#bn-chat-btn');
  await page.click('#bn-chat-btn'); await page.waitForTimeout(200);
  const chatShot = name => page.screenshot({ path: path.join(OUT, `${SHOT}-${name}.png`), clip: { x: 1280 - 420, y: 820 - 700, width: 420, height: 700 } });
  await chatShot('chat-open');
  const hasTools = await page.isVisible('#bn-chat .bn-photo');
  if (!hasTools) { console.log('(사진 기능 없음: 이전 화면 그림만 찍음)'); await browser.close(); return; }
  ok(await page.isVisible('#bn-chat .bn-screen'), 'PC: 화면 캡쳐 button shown');
  ok((await page.innerText('#bn-chat .bn-tool-hint')).includes('Ctrl+V'), 'PC hint');

  // 사진 고르기 → 편집창
  await page.setInputFiles('#bn-chat .bn-file', SAMPLE); await page.waitForSelector('#bn-shot.open');
  ok(await page.isVisible('#bn-shot canvas'), 'editor opens after choosing photo');
  const cv = await page.locator('#bn-shot canvas').boundingBox();
  const W = 900, k = cv.width / W;
  // 가리기(기본): 연락처 칸 두 개 칠하기
  await page.mouse.move(cv.x + 95 * k, cv.y + 172 * k); await page.mouse.down(); await page.mouse.move(cv.x + 200 * k, cv.y + 240 * k, { steps: 5 }); await page.mouse.up();
  // 모자이크: 칠한 곳 안의 작은 칸들이 같은 색(블록)으로 바뀜
  const mos = await page.evaluate(() => { const c = document.querySelector('#bn-shot canvas'); const x = c.getContext('2d');
    const at = (a, b) => [...x.getImageData(Math.round(a), Math.round(b), 1, 1).data].slice(0, 3).join(',');
    const px = 98, py = 175; return { same: at(px, py) === at(px + 3, py + 3), text: document.querySelector('#bn-shot [data-mode=cover]').textContent }; });
  ok(mos.same && mos.text.includes('모자이크'), 'cover = mosaic blocks', JSON.stringify(mos));
  await page.screenshot({ path: path.join(OUT, `${SHOT}-chat-editor.png`) });
  // 되돌리기 → 다시 칠하기
  await page.click('#bn-shot .bn-shot-undo');
  const back = await page.evaluate(() => { const c = document.querySelector('#bn-shot canvas'); const d = c.getContext('2d').getImageData(Math.round(c.width * 0.19), Math.round(c.height * 0.5), 1, 1).data; return d[0] + d[1] + d[2]; });
  ok(back > 0, 'undo works');
  await page.mouse.move(cv.x + 95 * k, cv.y + 172 * k); await page.mouse.down(); await page.mouse.move(cv.x + 200 * k, cv.y + 240 * k, { steps: 5 }); await page.mouse.up();
  // 자르기: 위쪽 머리줄 빼고 표 부분만
  await page.click('#bn-shot [data-mode=crop]');
  await page.mouse.move(cv.x + 5 * k, cv.y + 60 * k); await page.mouse.down(); await page.mouse.move(cv.x + 700 * k, cv.y + 220 * k, { steps: 5 }); await page.mouse.up();
  const size = await page.evaluate(() => { const c = document.querySelector('#bn-shot canvas'); return [c.width, c.height]; });
  ok(size[0] < 720 && size[0] > 650 && size[1] < 180, 'crop keeps selected part', size.join('x'));
  await page.click('#bn-shot .bn-shot-ok');
  ok(!(await page.isVisible('#bn-shot')) && await page.isVisible('#bn-chat .bn-attach.on'), 'attach chip shown');
  await chatShot('chat-attached');
  // 글 없이 사진만 보내기
  await page.click('#bn-chat form button'); await page.waitForSelector('#bn-chat .bn-ai >> text=빨간 칸');
  const a = asked[0] || {};
  ok(a.image && a.image.media_type === 'image/jpeg' && a.image.data.length > 1000 && !a.image.data.startsWith('data:'), 'image sent as jpeg base64');
  ok(a.messages && a.messages[a.messages.length - 1].content === '이 화면을 보고 알려 주세요.', 'default question when text empty');
  ok(await page.isVisible('#bn-chat .bn-user img'), 'sent photo shown in chat');
  ok(!(await page.isVisible('#bn-chat .bn-attach.on')), 'attach cleared after send');
  await chatShot('chat-answer');
  // 다음 질문은 사진 없이
  await page.fill('#bn-chat textarea', '고마워요'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  ok(asked[1] && !asked[1].image, 'next question has no image');
  // 화면 캡쳐 버튼
  await page.click('#bn-chat .bn-screen'); await page.waitForSelector('#bn-shot.open', { timeout: 4000 }).catch(() => {});
  ok(await page.evaluate(() => window.__shotAsked >= 1) && await page.isVisible('#bn-shot.open.snip'), 'screen capture → snip mode (캡쳐 도구처럼)');
  ok((await page.innerText('#bn-shot .bn-shot-title')).includes('끌어서 고르세요') && !(await page.isVisible('#bn-shot .bn-shot-ok')), 'snip: drag guide, no send button yet');
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('bn-chat')).visibility !== 'hidden'), 'chat visible again after capture');
  { const b = await page.locator('#bn-shot canvas').boundingBox(); const kk = b.width / 1200;
    await page.mouse.move(b.x + 30 * kk, b.y + 100 * kk); await page.mouse.down(); await page.mouse.move(b.x + 300 * kk, b.y + 160 * kk, { steps: 4 });
    await page.screenshot({ path: path.join(OUT, `${SHOT}-chat-snip.png`) });
    await page.mouse.up(); }
  const snipSize = await page.evaluate(() => { const c = document.querySelector('#bn-shot canvas'); return [c.width, c.height]; });
  ok(!(await page.isVisible('#bn-shot.snip')) && await page.isVisible('#bn-shot.open') && await page.isVisible('#bn-shot .bn-shot-ok'), 'after drag → normal check window');
  ok(Math.abs(snipSize[0] - 270) < 6 && Math.abs(snipSize[1] - 60) < 6, 'snip keeps only selected part (원래 크기)', snipSize.join('x'));
  ok(await page.evaluate(() => document.querySelector('#bn-shot [data-mode=cover]').classList.contains('on')), 'after snip → 모자이크 mode ready');
  await page.screenshot({ path: path.join(OUT, `${SHOT}-chat-snip-done.png`) });
  await page.click('#bn-shot .bn-shot-cancel');
  ok(!(await page.isVisible('#bn-chat .bn-attach.on')), 'cancel → nothing attached');
  // Esc 로도 취소
  await page.click('#bn-chat .bn-screen'); await page.waitForSelector('#bn-shot.open.snip'); await page.keyboard.press('Escape');
  ok(!(await page.isVisible('#bn-shot.open')), 'Esc cancels snip');
  ok(!errors.length, 'no page errors (PC)', errors.join(' | '));

  // ---------- 휴대폰 ----------
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const m = await ctx.newPage(); const mErr = []; m.on('pageerror', e => mErr.push(e.message));
  await routeAll(m, []);
  await m.goto('http://site.test/'); await m.waitForSelector('#bn-chat-btn'); await m.click('#bn-chat-btn'); await m.waitForTimeout(200);
  ok(await m.isVisible('#bn-chat .bn-photo') && !(await m.isVisible('#bn-chat .bn-screen')), 'phone: 사진 only, no 화면 캡쳐');
  ok((await m.innerText('#bn-chat .bn-tool-hint')).includes('전원+음량'), 'phone hint');
  const bx = await m.locator('#bn-chat').boundingBox(); ok(bx.x >= 0 && bx.x + bx.width <= 390, 'phone fits width');
  await m.screenshot({ path: path.join(OUT, `${SHOT}-chat-phone.png`) });
  ok(!mErr.length, 'no page errors (phone)', mErr.join(' | '));
  await browser.close();
})();
