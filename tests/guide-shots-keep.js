// 설명서: 사무실 보관요청 '하루 한 번' 화면 (가짜 데이터)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const G = require('./guide-shots.js');
const OUT = process.argv[2] || G.OUT;
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await G.setup(c);
  const p = await G.newPage(c);
  const S = n => path.join(OUT, n + '.png');
  await G.login(p, 'seller@x.com', 'password1'); await p.waitForTimeout(800);
  await p.locator('#keep-request-box').screenshot({ path: S('40_보관요청_오늘처음') });
  await p.check('input[name=keep-request][value="없음"]'); await p.click('#btn-keep-submit'); await p.waitForTimeout(800);
  await p.locator('#keep-request-box').screenshot({ path: S('41_보관요청_확인됨') });
  console.log(G.pageErrors.length ? G.pageErrors.join('\n') : 'no page errors');
  await b.close();
})();
