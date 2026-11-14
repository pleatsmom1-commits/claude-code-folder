// 사무실 보관요청 '하루에 한 번만' 확인용 E2E (가짜 Supabase)
// 사용: cd tests && npm install && node e2e-keep-daily.js [화면저장폴더]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const G = require('./guide-shots.js');
const OUT = process.argv[2] || path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const kst = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);

(async () => {
  const results = [];
  const check = (name, cond, extra = '') => { const l = `${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`; results.push(l); console.log(l); };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await G.setup(ctx);
  const page = await G.newPage(ctx);
  const dialogs = []; let promptAnswer = null;
  page.removeAllListeners('dialog');
  page.on('dialog', async d => { dialogs.push(d.message()); if (d.type() === 'prompt') await d.accept(promptAnswer ?? d.defaultValue()); else await d.accept(); });
  const seller = G.users['seller@x.com'];
  const vis = s => page.isVisible(s);

  // 어제 고른 기록 → 오늘은 다시 물어봄
  seller.meta = { keep_check: { date: '2026-01-01', choice: '없음' } };
  await G.login(page, 'seller@x.com', 'password1'); await page.waitForTimeout(500);
  check('old day record → form shown', await vis('#keep-form') && !(await vis('#keep-done')));
  await page.locator('#keep-request-box').screenshot({ path: path.join(OUT, 'keep-before-choose.png') });

  // 없음 → 접수 → 한 줄로 줄어듦 + 계정에 오늘 날짜로 저장
  await page.check('input[name="keep-request"][value="없음"]'); await page.click('#btn-keep-submit'); await page.waitForTimeout(400);
  check('after 없음: collapsed line', await vis('#keep-done') && !(await vis('#keep-form')) && (await page.innerText('#keep-done-text')).includes('보관건 없음'));
  check('saved to account with today', seller.meta.keep_check && seller.meta.keep_check.date === kst() && seller.meta.keep_check.choice === '없음', JSON.stringify(seller.meta));
  await page.locator('#keep-request-box').screenshot({ path: path.join(OUT, 'keep-after-done.png') });

  // 다시 로그인(다른 기기 흉내) → 묻지 않음, 바로 접수 가능
  await page.evaluate(() => logout()); await page.waitForTimeout(800); await page.evaluate(() => localStorage.clear());
  await G.login(page, 'seller@x.com', 'password1'); await page.waitForTimeout(800);
  check('re-login same day → still collapsed', await vis('#keep-done') && (await page.innerText('#keep-done-text')).includes('보관건 없음'));
  const before = G.tables.orders.length;
  await page.click('#reg-tab-single');
  await page.fill('#so-recipient', '홍길동'); await page.fill('#so-phone', '010-2222-3333'); await page.fill('#so-product', '테스트 / 1개');
  await page.fill('#so-wholesale-company', '가나'); await page.fill('#so-wholesale-product', '울PT');
  await page.evaluate(() => { document.getElementById('so-zipcode').value = '06000'; document.getElementById('so-address').value = '서울'; });
  dialogs.length = 0;
  await page.click('#btn-submit-order'); await page.waitForTimeout(1000);
  const added = G.tables.orders.slice(before);
  check('order saved without asking keep again', added.length === 1 && added[0].keep_request === '없음' && !dialogs.some(d => d.includes('보관요청 버튼')), dialogs.join(' / '));
  if (await vis('#leftover-modal')) await page.click('#btn-leftover-close');

  // [바꾸기 · 추가] → 있음 + 메모 → 보관요청 줄 생김
  await page.click('#keep-done button'); await page.waitForTimeout(200);
  check('change opens form with today choice', await vis('#keep-form') && await page.isChecked('input[name="keep-request"][value="없음"]'));
  await page.check('input[name="keep-request"][value="있음"]'); await page.fill('#keep-memo', '오늘 사입건 모두 킵해주세요');
  await page.click('#btn-keep-submit'); await page.waitForTimeout(800);
  const keepRow = G.tables.orders.find(o => o.order_type === 'keep');
  check('keep row created + collapsed 있음', !!keepRow && await vis('#keep-done') && (await page.innerText('#keep-done-text')).includes('보관건 있음'));

  // 보관요청 줄 [수정] → 내용 고치기
  await page.evaluate(() => fetchOrdersFromDB()); await page.waitForTimeout(600);
  const editBtn = page.locator(`#seller-order-list button[data-id="${keepRow.id}"]:has-text("수정")`);
  check('keep row has 수정 button', await editBtn.isVisible());
  promptAnswer = '풀필외 남은재고 킵해주세요';
  await editBtn.click(); await page.waitForTimeout(600);
  check('keep memo updated', keepRow.keep_memo === '풀필외 남은재고 킵해주세요' && keepRow.product === '풀필외 남은재고 킵해주세요', JSON.stringify({ p: keepRow.product, m: keepRow.keep_memo }));
  await page.locator('#seller-order-list').locator('xpath=ancestor::div[contains(@class,"bg-white")][1]').screenshot({ path: path.join(OUT, 'keep-row-edit.png') });

  // 오늘 보관요청 줄이 있으면, 계정 기록이 없어도 다시 묻지 않음
  seller.meta = {};
  await page.evaluate(() => logout()); await page.waitForTimeout(800); await page.evaluate(() => localStorage.clear());
  await G.login(page, 'seller@x.com', 'password1'); await page.waitForTimeout(800);
  check('today keep row → collapsed 있음', await vis('#keep-done') && (await page.innerText('#keep-done-text')).includes('보관건 있음'));

  check('no page errors', G.pageErrors.length === 0, G.pageErrors.join(' | '));
  await browser.close();
  const fail = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\nRESULT: ${results.length - fail}/${results.length} passed`);
  process.exit(fail ? 1 : 0);
})();
