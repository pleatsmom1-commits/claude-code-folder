// 비회원 간단 주문접수(quick.html) + 견적 문의(quote.html) 화면 확인용 E2E
// 사용: 저장소 폴더에서 `python3 -m http.server 8765` 를 켠 뒤 `cd tests && node e2e-quick.js`
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const BASE = 'http://localhost:8765';
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 390, height: 800 } });
  const results = []; const errors = [];
  const check = (n, c, x = '') => { const l = `${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  -- ' + x : ''}`; results.push(l); console.log(l); };
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  const sent = [];
  await page.route('**/api/quick-order', async r => { sent.push(JSON.parse(r.request().postData())); await r.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'saved', nth: 1 }) }); });
  await page.route('**/api/inquiry', async r => { sent.push(JSON.parse(r.request().postData())); await r.fulfill({ contentType: 'application/json', body: '{"status":"saved"}' }); });
  const next = () => page.click('#btn-next');
  const fill = (k, v) => page.fill(`[data-k="${k}"]`, v);
  const stepIs = async n => (await page.textContent('.step')).startsWith(n + ' /');

  await page.goto(BASE + '/quick.html');
  check('step1 shown', (await page.textContent('h1')).includes('주문하시는 분'));
  await next();
  check('step1 blocks empty', (await stepIs(1)) && (await page.$$('.bad')).length === 2);
  await fill('company', '해피옷장'); await fill('phone', '010-9876-5432'); await next();
  check('step2 store 4 fields', (await page.$$('[data-k^="stores.0."]')).length === 4);
  await fill('stores.0.mall', '누죤'); await fill('stores.0.store', '블루하우스'); await fill('stores.0.floor', '3층 B12호');
  await next();
  check('step2 blocks without store phone', (await stepIs(2)) && (await page.$$('.bad')).length === 1);
  await fill('stores.0.phone', '02-1234-5678');
  await page.click('[data-add="stores"]');
  check('store add makes 2nd group', (await page.$$('[data-k^="stores.1."]')).length === 4);
  await page.click('[data-del="stores.1"]');
  check('store values kept after add/delete', (await page.inputValue('[data-k="stores.0.mall"]')) === '누죤');
  await next();
  check('step3 prepay', await stepIs(3));
  await page.click('[data-set="prepay"][data-v="true"]'); await page.click('[data-set="prepayMisong"][data-v="false"]');
  await next();
  check('prepay needs agreement', await stepIs(3));
  await page.check('[data-chk="agreed"]'); await next();
  await page.click('[data-set="shipTo"][data-v="customer"]'); await next();
  check('step5 customer recipient', (await page.textContent('h1')).includes('고객'));
  await fill('recipients.0.name', '김영희'); await fill('recipients.0.phone', '010-2222-3333'); await fill('recipients.0.address', '서울 강남구 1');
  await next();
  check('customer needs product', await stepIs(5));
  await fill('recipients.0.product', '블라우스 2장'); await next();
  await fill('memo', '오늘 꼭'); await next();
  const sum = await page.textContent('.sum');
  check('confirm shows summary', sum.includes('블루하우스') && sum.includes('김영희'));
  await page.screenshot({ path: '/tmp/claude-0/quick_confirm.png' });
  await next();
  check('consent required', sent.length === 0);
  await page.check('[data-chk="consent"]'); await next(); await page.waitForTimeout(300);
  check('sent to /api/quick-order', sent.length === 1 && sent[0].stores[0].phone === '02-1234-5678' && sent[0].shipTo === 'customer' && sent[0].consent === true, JSON.stringify(sent[0]).slice(0, 200));
  const main = await page.textContent('main');
  check('done screen with SO guide', main.includes('접수됐어요') && main.includes('SO솔루션'));

  // 내 매장·사무실로: 받는 분 자동 채움
  await page.goto(BASE + '/quick.html');
  await fill('company', '해피옷장'); await fill('phone', '01098765432'); await next();
  for (const [k, v] of [['mall', '누죤'], ['store', 'A'], ['floor', '1층'], ['phone', '0212345678']]) await fill('stores.0.' + k, v);
  await page.screenshot({ path: '/tmp/claude-0/quick_store.png' });
  await next(); await page.click('[data-set="prepay"][data-v="false"]'); await page.click('[data-set="prepayMisong"][data-v="false"]'); await next();
  await page.click('[data-set="shipTo"][data-v="store"]'); await next();
  check('store ship prefills own name/phone', (await page.inputValue('[data-k="recipients.0.name"]')) === '해피옷장' && (await page.inputValue('[data-k="recipients.0.phone"]')) === '01098765432');

  // 견적 문의
  await page.goto(BASE + '/quote.html');
  await page.click('#send');
  check('quote blocks empty', (await page.$$('.bad')).length >= 4);
  await page.fill('#company', '새샵'); await page.fill('#phone', '010-1111-2222'); await page.click('#services .chip >> nth=1');
  await page.fill('#volume', '하루 30건'); await page.fill('#question', '풀필 단가 궁금해요'); await page.check('#consent');
  await page.screenshot({ path: '/tmp/claude-0/quote_form.png', fullPage: true });
  await page.click('#send'); await page.waitForTimeout(300);
  const q = sent[sent.length - 1];
  check('quote sent as [견적문의]', q && q.question.startsWith('[견적문의]') && q.question.includes('풀필먼트') && q.question.includes('하루 30건') && q.consent === true, q && q.question);
  check('quote done shown', await page.isVisible('#done'));
  check('no page script errors', errors.length === 0, errors.join(' | '));
  await b.close();
  const fail = results.filter(l => l.startsWith('FAIL')).length;
  console.log(`\nRESULT: ${results.length - fail}/${results.length} passed`);
  process.exit(fail ? 1 : 0);
})();
