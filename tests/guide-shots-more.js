// 설명서 '기능별 사용법'용 추가 화면 (가짜 데이터)
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
  await G.login(p, 'seller@x.com', 'password1');
  await G.go(p, G.P('products.html')); await p.waitForTimeout(800);
  await p.click('button:has-text("+ 상품 등록")'); await p.waitForTimeout(400);
  await p.fill('#e-wholesale_company', '청평화 가나').catch(() => {}); await p.fill('#e-wholesale_product', '울PT').catch(() => {});
  await p.fill('#e-color', '차콜').catch(() => {}); await p.fill('#e-size', 'M').catch(() => {});
  const nm = p.locator('#e-names input'); if (await nm.count() >= 2) { await nm.nth(0).fill('스마트스토어'); await nm.nth(1).fill('울 와이드 팬츠'); }
  await p.locator('#edit-modal form').screenshot({ path: S('30_상품등록창') });
  await p.click('#edit-modal button:has-text("취소")');
  await G.go(p, G.P('stock.html')); await p.waitForTimeout(800);
  await p.click('text=출고 내역').catch(() => {}); await p.waitForTimeout(400);
  await p.screenshot({ path: S('31_재고_출고내역'), clip: { x: 0, y: 0, width: 1280, height: 520 } });
  await G.go(p, G.P('settle.html') + '?t=0123456789abcdef01234567'); await p.waitForTimeout(1000);
  await p.screenshot({ path: S('32_정산서'), fullPage: true });
  const m = await b.newContext({ ...require('/opt/node22/lib/node_modules/playwright').devices['iPhone 13'] });
  await G.setup(m); const mp = await G.newPage(m);
  await G.go(mp, G.P('settle.html') + '?t=0123456789abcdef01234567'); await mp.waitForTimeout(1000);
  await mp.screenshot({ path: S('33_정산서_휴대폰'), fullPage: true });
  console.log(G.pageErrors.length ? G.pageErrors.join('\n') : 'no page errors');
  await b.close();
})();
