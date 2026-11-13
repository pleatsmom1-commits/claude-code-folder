// 풀필먼트 외 남는 상품: 매장/사무실 접수 버튼 + 풀필먼트 등록 직후 안내창 점검 (가짜 Supabase)
// 사용: cd tests && npm install && node e2e-leftover.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const G = require('./guide-shots.js');
const OUT = path.join(__dirname, 'out', 'leftover'); require('fs').mkdirSync(OUT, { recursive: true });
let fail = 0; const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); if (!c) fail++; };
(async () => {
  const browser = await chromium.launch();
  for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await G.setup(ctx);
    const page = await G.newPage(ctx);
    const alerts = []; page.on('dialog', d => alerts.push(d.message()));
    await G.login(page, 'seller@x.com', 'password1');
    const memo = () => page.inputValue('#st-bamnat-memo');
    // 1) 매장/사무실 버튼
    await page.evaluate(() => switchSellerMode('store')); await page.waitForTimeout(200);
    ok(await page.locator('[data-st-preset]').count() === 3, `[${vp.width}] 보낼 상품 버튼 3개`);
    await page.click('[data-st-preset="except"]');
    ok(await memo() === '풀필먼트 출고건을 제외하고 나머지 상품을 보내주세요', '나머지 버튼 → 전달메세지 채움');
    await page.click('[data-st-preset="keep"]');
    ok((await memo()).includes('사무실에 킵되어있는 상품도'), '킵 상품도 같이 → 덧붙임');
    await page.click('[data-st-preset="all"]');
    ok((await memo()).startsWith('오늘 픽업건 모두') && !(await memo()).includes('풀필먼트 출고건'), '전부 ↔ 나머지는 하나만');
    await page.fill('#st-bamnat-memo', (await memo()) + ' / 반품 상품도 같이');
    await page.click('[data-st-preset="keep"]');
    ok(await memo() === '오늘 픽업건 모두 보내주세요 / 반품 상품도 같이', '직접 적은 내용 유지 + 킵 끄기');
    ok((await page.getAttribute('[data-st-preset="all"]', 'class')).includes('bg-indigo-600'), '켜진 버튼 색 표시');
    await page.locator('#store-form-card').screenshot({ path: path.join(OUT, `store_${vp.width}.png`) });
    // 매장 접수 저장 시 전달메세지 그대로 저장
    if (await page.isVisible('#keep-form')) { await page.click('input[name="keep-request"][value="없음"]'); await page.click('#btn-keep-submit'); await page.waitForTimeout(300); }
    await page.evaluate(() => { document.getElementById('st-zipcode').value = '04563'; document.getElementById('st-address').value = '서울 중구 마장로 1'; });
    await page.click('#btn-store-submit'); await page.waitForTimeout(600);
    const saved = G.tables.orders.filter(o => o.order_type === 'store_post').pop();
    ok(saved && saved.bamnat_memo === '오늘 픽업건 모두 보내주세요 / 반품 상품도 같이', '매장 접수에 전달메세지 저장');
    // 2) 풀필먼트 단건 등록 → 안내창
    await page.evaluate(() => switchSellerMode('fulfillment')); await page.click('#reg-tab-single'); await page.waitForTimeout(200);
    await page.fill('#so-recipient', '홍길동'); await page.fill('#so-phone', '010-2222-3333');
    await page.fill('#so-product', '울 팬츠 / 블랙 / 1개'); await page.fill('#so-wholesale-company', '청평화 가나'); await page.fill('#so-wholesale-product', '울PT');
    await page.evaluate(() => { document.getElementById('so-zipcode').value = '06000'; document.getElementById('so-address').value = '서울 강남구 테헤란로 1'; });
    const n0 = alerts.length;
    await page.click('#single-order-form button[type=submit]'); await page.waitForTimeout(700);
    ok(await page.isVisible('#leftover-modal'), '풀필먼트 등록 → 남는 상품 안내창');
    ok(!alerts.slice(n0).some(a => a.includes('성공적으로')), '예전 알림창은 안 뜸');
    await page.screenshot({ path: path.join(OUT, `modal_${vp.width}.png`) });
    await page.click('#btn-leftover-store'); await page.waitForTimeout(300);
    ok(await page.isVisible('#store-section') && !(await page.isVisible('#leftover-modal')), '[매장/사무실로 보내기] → 매장 접수 화면');
    ok((await memo()).includes('풀필먼트 출고건을 제외하고'), '나머지 버튼 자동 선택');
    // 3) 보관하기
    await page.evaluate(() => showLeftoverModal('테스트')); await page.click('#btn-leftover-keep'); await page.waitForTimeout(300);
    ok(await page.isChecked('input[name="keep-request"][value="있음"]') && await page.inputValue('#keep-memo') === '풀필외 남은재고 킵해주세요', '[사무실에 보관] → 보관요청 자동 입력');
    await page.evaluate(() => showLeftoverModal('테스트')); await page.click('#btn-leftover-close');
    ok(!(await page.isVisible('#leftover-modal')), '[없어요 · 닫기]');
    await ctx.close();
  }
  ok(G.pageErrors.length === 0, '페이지 오류 없음 ' + G.pageErrors.join(' | '));
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
