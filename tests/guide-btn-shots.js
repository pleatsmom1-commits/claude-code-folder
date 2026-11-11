// 위쪽 '이용설명서' 버튼 전/후 그림
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const G = require('./guide-shots.js');
const OUT = process.argv[2];
(async () => {
  const b = await chromium.launch();
  for (const [tag, file] of [['before', 'zz-before.html'], ['after', 'index.html']]) {
    const c = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await G.setup(c); const p = await G.newPage(c);
    await G.go(p, G.P(file)); await p.waitForTimeout(600);
    await p.screenshot({ path: path.join(OUT, `gb_${tag}_login.png`), clip: { x: 0, y: 0, width: 1600, height: 330 } });
    await G.login(p, 'seller@x.com', 'password1'); await p.waitForTimeout(800);
    await p.screenshot({ path: path.join(OUT, `gb_${tag}_pc.png`), clip: { x: 0, y: 0, width: 1600, height: 260 } });
    const m = await b.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 });
    await G.setup(m); const mp = await G.newPage(m);
    await G.go(mp, G.P(file)); await G.login(mp, 'seller@x.com', 'password1'); await mp.waitForTimeout(800);
    await mp.screenshot({ path: path.join(OUT, `gb_${tag}_m.png`) });
  }
  console.log(G.pageErrors.length ? G.pageErrors.join('\n') : 'no page errors');
  await b.close();
})();
