// 방문 통계 기록 스크립트(track.js) 점검: 조회·클릭·머문 시간이 /api/track 으로 가는지, 표 안·관리자 클릭은 안 가는지
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');
const TRACK = fs.readFileSync(path.join(__dirname, '..', 'track.js'));
const HOME = `<!doctype html><html><head><title>밤낮딜리버리 홈</title><script src="https://bamnat-delivery.bamnat.workers.dev/track.js" defer></script></head>
<body><a href="#" id="chat">궁금한 점 물어보기 010-5425-9060</a><button id="b2"><span>요금</span> 안내</button>
<table><tr><td><button id="intable">홍길동 주문</button></td></tr></table><div data-no-track><button id="nt">비밀</button></div><input id="inp"></body></html>`;
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 Chrome/130 Safari/537.36', viewport: { width: 1200, height: 800 } });
  const sent = [];
  await ctx.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.pathname === '/api/track') { sent.push({ host: u.host, origin: route.request().headers()['origin'], ...JSON.parse(route.request().postData()) }); return route.fulfill({ status: 204 }); }
    if (u.pathname === '/track.js') return route.fulfill({ contentType: 'text/javascript', body: TRACK });
    if (u.host === 'www.bamnatdelivery.com') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: HOME });
    return route.fulfill({ status: 404, body: '' });
  });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const ok = (c, m, x = '') => { console.log(c ? 'PASS' : 'FAIL', m, x); if (!c) process.exitCode = 1; };
  await page.goto('https://www.bamnatdelivery.com/?utm=x');
  await page.click('#chat'); await page.click('#b2'); await page.click('#intable'); await page.click('#nt'); await page.click('#inp');
  await page.mouse.move(100, 100);
  await page.waitForTimeout(6500);
  const all = () => sent.flatMap(s => s.events);
  ok(sent.length >= 1 && sent[0].host === 'bamnat-delivery.bamnat.workers.dev' && sent[0].origin === 'https://www.bamnatdelivery.com', 'sent to workers.dev from homepage', JSON.stringify(sent[0] && { h: sent[0].host, o: sent[0].origin }));
  const view = all().find(e => e.kind === 'view');
  ok(view && view.path === '/' && view.title === '밤낮딜리버리 홈' && view.session.length === 12 && view.device === 'pc', 'view event', JSON.stringify(view));
  const labels = all().filter(e => e.kind === 'click').map(e => e.label);
  ok(JSON.stringify(labels) === JSON.stringify(['궁금한 점 물어보기', '요금 안내']), 'clicks: digits removed, table/no-track/input skipped', JSON.stringify(labels));
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }); await page.waitForTimeout(800);
  const t = all().find(e => e.kind === 'time');
  ok(t && t.sec >= 5, 'time sent on leave', JSON.stringify(t));
  // 새 창으로 다시 와도 같은 날이면 방문자 번호는 같고, 방문 묶음(창)은 다름
  const p2 = await ctx.newPage(); await p2.goto('https://www.bamnatdelivery.com/'); await p2.waitForTimeout(6000);
  const v2 = all().filter(e => e.kind === 'view')[1];
  ok(v2 && v2.visitor === view.visitor && v2.session !== view.session, 'same visitor same day, new session', JSON.stringify(v2));
  await p2.evaluate(() => localStorage.setItem('bamnat.visitor', JSON.stringify({ day: '2000-01-01', id: 'oldid' })));
  await p2.reload(); await p2.waitForTimeout(6000);
  const v3 = all().filter(e => e.kind === 'view')[2];
  ok(v3 && v3.visitor !== 'oldid' && v3.visitor !== view.visitor, 'new day → new visitor id', JSON.stringify(v3));
  await p2.close();
  // 관리자 화면 속 작은 창(iframe)은 세지 않음
  const before = all().length;
  await page.setContent(`<iframe src="https://www.bamnatdelivery.com/"></iframe>`); await page.waitForTimeout(6000);
  ok(all().length === before, 'iframe not tracked');
  ok(!errs.length, 'no errors', errs.join('|'));
  await browser.close();
})();
