// 위쪽 '밤낮딜리버리 홈페이지' 버튼 전/후 그림 (셀러·관리자·로그인 전·휴대폰)
// 사용: cd tests && node home-btn-shots.js [저장폴더] [이름앞]
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const G = require('./guide-shots.js');
const OUT = process.argv[2]; const TAG = process.argv[3] || 'after';
G.users['boss@x.com'] = { id: '00000000-0000-0000-0000-0000000000ad', pw: 'adminpass1', profile: { id: '00000000-0000-0000-0000-0000000000ad', email: 'admin@example.com', company: '밤낮딜리버리', name: '관리자', role: 'admin', status: 'approved', created_at: '2026-01-01T00:00:00Z' } };
(async () => {
  const b = await chromium.launch();
  for (const w of [1872, 1280]) {
    const c = await b.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await G.setup(c); const p = await G.newPage(c);
    await G.go(p, G.P('index.html')); await p.waitForTimeout(600);
    await p.screenshot({ path: path.join(OUT, `${TAG}_${w}_login.png`), clip: { x: 0, y: 0, width: w, height: 200 } });
    await G.login(p, 'seller@x.com', 'password1'); await p.waitForTimeout(800);
    await p.screenshot({ path: path.join(OUT, `${TAG}_${w}_seller.png`), clip: { x: 0, y: 0, width: w, height: 200 } });
    await c.close();
  }
  const c = await b.newContext({ viewport: { width: 1872, height: 900 }, deviceScaleFactor: 1, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await G.setup(c); const p = await G.newPage(c);
  await G.go(p, G.P('index.html'));
  await p.evaluate(() => switchLoginMode('admin')); await p.waitForTimeout(300);
  const em = await p.$('#admin-email') ? '#admin-email' : '#login-email';
  const pw = await p.$('#admin-pw') ? '#admin-pw' : '#login-pw';
  await p.fill(em, 'boss@x.com'); await p.fill(pw, 'adminpass1');
  await p.click(await p.$('#btn-admin-login') ? '#btn-admin-login' : '#btn-login'); await p.waitForTimeout(1800);
  await p.addStyleTag({ content: G.HIDE });
  await p.screenshot({ path: path.join(OUT, `${TAG}_1872_admin.png`), clip: { x: 0, y: 0, width: 1872, height: 200 } });
  const m = await b.newContext({ ...devices['iPhone 13'] });
  await G.setup(m); const mp = await G.newPage(m);
  await G.login(mp, 'seller@x.com', 'password1'); await mp.waitForTimeout(800);
  await mp.evaluate(() => window.scrollTo(0, 0)); await mp.waitForTimeout(300); await mp.screenshot({ path: path.join(OUT, `${TAG}_m.png`), clip: { x: 0, y: 0, width: 390, height: 420 } });
  const href = await mp.getAttribute('#nav-home-btn', 'href').catch(() => null);
  console.log('home href:', href, 'target:', href && await mp.getAttribute('#nav-home-btn', 'target'));
  const over = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log('mobile horizontal overflow:', over);
  console.log(G.pageErrors.length ? G.pageErrors.join('\n') : 'no page errors');
  await b.close();
})();
