// (합)·(킵) 자동 표시 점검 (hap-keep.js): 단건 접수 체크칸 + 우리 양식 엑셀 확인표 (가짜 Supabase)
// 사용: cd tests && npm install && node e2e-hap-keep.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const XLSX = require('./node_modules/xlsx-js-style');
const G = require('./guide-shots.js');
const OUT = path.join(__dirname, 'out', 'hap-keep'); fs.mkdirSync(OUT, { recursive: true });
let fail = 0; const ok = (c, m, extra = '') => { console.log((c ? '✅ ' : '❌ ') + m + (c || !extra ? '' : '  -- ' + extra)); if (!c) fail++; };

// 상품 1 '울 와이드 팬츠' 블랙 재고 3 (guide-shots.js 가짜 데이터)
function excelFile() {
  const S = '밤낮딜리버리(예시샵)';
  const rows = [
    ['풀필먼트 엑셀양식'],
    ['송화인명', 'C/S연락처', '수화인명', '주소', '상품명', '도매거래처명', '도매상품명', '받는사람 연락처', '배송메세지', '밤낮 전달메세지', '수량'],
    [S, '010-1234-5678', '홍길동', '서울 강남구 1', '(합)울 와이드 팬츠 / 블랙 / 1개', '청평화 가나', '울PT', '010-2222-3333', '', '', 1],
    [S, '010-1234-5678', '홍길동', '서울 강남구 1', '니트 머플러 / 아이보리 / 1개', '디오트 다라', '머플러', '010-2222-3333', '', '', 1],
    [S, '010-1234-5678', '정하나', '대구 중구 3', '린넨 셔츠 / 1개', '가나', '린넨S', '010-3333-4444', '', '', 1],
    [S, '010-1234-5678', '정하나', '대구 중구 3', '린넨 팬츠 / 1개', '가나', '린넨P', '010-3333-4444', '', '', 1],
    [S, '010-1234-5678', '박민수', '인천 4', '(킵)니트 머플러 / 1개', '디오트 다라', '머플러', '010-4444-5555', '', '', 1],
    [S, '010-1234-5678', '김영희', '부산 5', '울 와이드 팬츠 / 블랙 / 3개', '청평화 가나', '울PT', '010-5555-6666', '', '', 3],
    [S, '010-1234-5678', '최지은', '광주 6', '울 와이드 팬츠 / 블랙 / 1개', '청평화 가나', '울PT', '010-6666-7777', '', '', 1],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['안내']]), '풀필먼트 엑셀양식 작성안내');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '풀필먼트 엑셀양식');
  const f = path.join(OUT, '테스트_엑셀양식.xlsx');
  XLSX.writeFile(wb, f);
  return f;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await G.setup(ctx);
  const page = await G.newPage(ctx);
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.text()); });
  const alerts = []; page.on('dialog', d => { alerts.push(d.message()); d.accept().catch(() => {}); });
  await G.login(page, 'seller@x.com', 'password1');
  await page.evaluate(() => { keepConfirmed = '없음'; keepConfirmedDate = kstDateKey(); switchSellerMode('fulfillment'); });
  await page.click('#reg-tab-single'); await page.waitForTimeout(200);

  // 1) 단건 접수
  await page.fill('#so-recipient', '이수진'); await page.fill('#so-phone', '010-8888-9999');
  await page.fill('#so-product', '울 와이드 팬츠 / 블랙 / 1개'); await page.fill('#so-wholesale-company', '청평화 가나'); await page.fill('#so-wholesale-product', '울PT');
  await page.waitForTimeout(800);
  ok(await page.isChecked('#so-hk-keep'), '단건: 재고 있는 상품 → (킵) 자동 체크');
  ok((await page.innerText('#so-hk-keep-info')).includes('3개'), '단건: 맡긴 재고 3개 안내', await page.innerText('#so-hk-keep-info'));
  ok(!(await page.isChecked('#so-hk-hap')), '단건: (합)은 기본 꺼짐');
  ok((await page.innerText('#so-hk-preview')).includes('(킵)'), '단건: 접수될 상품명 미리보기');
  await page.locator('#single-order-form').screenshot({ path: path.join(OUT, '1_단건_자동킵.png') });
  // 셀러가 이미 (킵) 적으면 그대로
  await page.fill('#so-product', '(킵)울 와이드 팬츠 / 블랙 / 1개'); await page.waitForTimeout(600);
  ok(await page.isDisabled('#so-hk-keep') && (await page.innerText('#so-hk-preview')).match(/\(킵\)/g).length === 1, '단건: 이미 적은 (킵)은 한 번만');
  await page.fill('#so-product', '울 와이드 팬츠 / 블랙 / 1개'); await page.waitForTimeout(600);
  await page.check('#so-hk-hap'); await page.waitForTimeout(300);
  await page.evaluate(() => { document.getElementById('so-zipcode').value = '06000'; document.getElementById('so-address').value = '서울 강남구 테헤란로 9'; });
  await page.click('#single-order-form button[type=submit]'); await page.waitForTimeout(900);
  const single = G.tables.orders.find(o => o.recipient === '이수진');
  ok(single && single.product === '(합)(킵)울 와이드 팬츠 / 블랙 / 1개', '단건: 저장된 상품명 (합)(킵)', single && single.product);
  await page.evaluate(() => { const m = document.getElementById('leftover-modal'); if (m) { m.classList.add('hidden'); m.classList.remove('flex'); } });
  ok(!(await page.isChecked('#so-hk-keep')) && !(await page.isChecked('#so-hk-hap')), '단건: 등록 후 체크칸 초기화');
  // 체크 해제하면 (킵) 없이
  await page.fill('#so-recipient', '오하늘'); await page.fill('#so-phone', '010-1212-3434');
  await page.fill('#so-product', '울 와이드 팬츠 / 블랙 / 1개'); await page.fill('#so-wholesale-company', '청평화 가나'); await page.fill('#so-wholesale-product', '울PT');
  await page.waitForTimeout(700);
  await page.uncheck('#so-hk-keep'); await page.waitForTimeout(300);
  await page.evaluate(() => { document.getElementById('so-zipcode').value = '06000'; document.getElementById('so-address').value = '서울 9'; });
  await page.click('#single-order-form button[type=submit]'); await page.waitForTimeout(900);
  const single2 = G.tables.orders.find(o => o.recipient === '오하늘');
  ok(single2 && single2.product === '울 와이드 팬츠 / 블랙 / 1개', '단건: (킵) 체크 빼면 그대로', single2 && single2.product);
  await page.evaluate(() => { const m = document.getElementById('leftover-modal'); if (m) { m.classList.add('hidden'); m.classList.remove('flex'); } });

  // 엑셀 파일을 [엑셀 파일 업로드]로 고른 것과 똑같이 handleFileUpload 에 넘김
  const upload = async () => {
    const b64 = fs.readFileSync(excelFile()).toString('base64');
    await page.evaluate(b64 => {
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const file = new File([bin], '테스트.xlsx');
      handleFileUpload({ target: { files: [file], value: '' } });
    }, b64);
    await page.waitForTimeout(1200);
  };
  // 2) 우리 양식 엑셀 올리기 → 확인표 (재고 3 중 단건 (킵) 1개가 잡혀 있어 남은 2개)
  await page.click('#reg-tab-batch'); await page.waitForTimeout(200);
  await upload(); await page.waitForTimeout(1200);
  ok(await page.isVisible('#hk-excel-modal'), '엑셀: 접수 전 확인표가 뜸', alerts.slice(-3).join(' // '));
  const rowT = async n => page.locator('#hk-excel-modal tbody tr').nth(n).innerText();
  ok((await rowT(0)).includes('셀러가 적음') && (await rowT(0)).includes('자동'), '엑셀: 1줄 (합) 셀러가 적음 + (킵) 자동', await rowT(0));
  ok(await page.locator('#hk-excel-modal tbody tr').nth(1).locator('input[type=checkbox]').first().isChecked(), '엑셀: 같은 받는분이 (합)을 적었으면 옆 줄도 체크된 채로');
  ok((await rowT(2)).includes('모아서 보낼까요') && !(await page.locator('#hk-excel-modal tbody tr').nth(2).locator('input[type=checkbox]').first().isChecked()), '엑셀: (합) 없는 같은 받는분 → 물어봄(꺼짐)', await rowT(2));
  ok((await rowT(4)).includes('셀러가 적음'), '엑셀: 이미 적은 (킵) 그대로');
  ok((await rowT(5)).includes('모자란 2개'), '엑셀: 재고 1개 남음 → 모자란 2개 사입 안내', await rowT(5));
  ok((await rowT(6)).includes('먼저 적은 줄'), '엑셀: 위 줄이 재고 다 씀', await rowT(6));
  await page.locator('#hk-excel-modal > div').screenshot({ path: path.join(OUT, '2_엑셀_확인표.png') });
  await page.locator('#hk-excel-modal tbody tr').nth(2).locator('input[type=checkbox]').first().check(); await page.waitForTimeout(200);
  ok(await page.locator('#hk-excel-modal tbody tr').nth(3).locator('input[type=checkbox]').first().isChecked(), '엑셀: (합) 체크하면 같은 받는분 모두');
  const n0 = G.tables.orders.length;
  await page.click('#hk-excel-ok'); await page.waitForTimeout(1200);
  const added = G.tables.orders.slice(n0).map(o => o.product);
  const want = ['(합)(킵)울 와이드 팬츠 / 블랙 / 1개', '(합)니트 머플러 / 아이보리 / 1개', '(합)린넨 셔츠 / 1개', '(합)린넨 팬츠 / 1개', '(킵)니트 머플러 / 1개', '(킵)울 와이드 팬츠 / 블랙 / 3개', '울 와이드 팬츠 / 블랙 / 1개'];
  ok(JSON.stringify(added) === JSON.stringify(want), '엑셀: 저장된 상품명 7건', added.join(' | '));
  ok(!(await page.isVisible('#hk-excel-modal')), '엑셀: 접수 후 확인표 닫힘');

  // 3) 취소하면 접수 안 됨
  await page.evaluate(() => { const m = document.getElementById('leftover-modal'); if (m) { m.classList.add('hidden'); m.classList.remove('flex'); } });
  const n1 = G.tables.orders.length;
  await upload(); await page.waitForTimeout(1200);
  await page.click('#hk-excel-modal button:has-text("취소")'); await page.waitForTimeout(500);
  ok(G.tables.orders.length === n1, '엑셀: [취소] → 접수 안 됨');

  // 휴대폰 화면
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#reg-tab-single'); await page.fill('#so-product', '울 와이드 팬츠 / 블랙 / 1개'); await page.waitForTimeout(700);
  await page.locator('#so-hk-box').screenshot({ path: path.join(OUT, '3_단건_휴대폰.png') });

  ok(G.pageErrors.length === 0, '페이지 오류 없음 ' + G.pageErrors.join(' | '));
  await browser.close();
  console.log(fail ? `\n실패 ${fail}건` : '\n모두 통과');
  process.exit(fail ? 1 : 0);
})();
