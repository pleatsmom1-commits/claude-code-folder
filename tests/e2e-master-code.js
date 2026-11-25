// 마스터상품코드 "독도(SSXR802)96898558" → 도매처 독도 / 도매상품명 SSXR802 (온더포엑스 양식, 2026-11-23)
// 사용: cd tests && npm install && REAL_FILE=실제파일.xls node e2e-master-code.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const XLSX = require('./node_modules/xlsx-js-style');
const G = require('./guide-shots.js');
const OUT = path.join(__dirname, 'out', 'master-code'); fs.mkdirSync(OUT, { recursive: true });
let fail = 0; const ok = (c, m, extra = '') => { console.log((c ? '✅ ' : '❌ ') + m + (c || !extra ? '' : '  -- ' + extra)); if (!c) fail++; };

// 온더포엑스 양식 그대로 (제목줄 '수령자명', 시트 1개, 맨 뒤 주문선택사항·마스터상품코드 칸) — 가짜 고객
function excelFile() {
  const S = '밤낮딜리버리(예시샵)';
  const rows = [
    [S, '대표님C/S', '수령자명', '배송지주소', '상품명', '도매거래처명', '도매 상품명', '수령자휴대폰번호', '배송메세지', '밤낮딜리버리 전달메세지', '수량(고정값)', '보내는사람주소(고정값,변경금지!)', '"보내는사람 우편번호 (고정값,변경금지!)"', '주문선택사항', '마스터상품코드'],
    [S, '010-1234-5678', '김가나', '서울 서대문구 1', '남성경량패딩조끼', '', '', '010-2222-3333', '문 앞', '', '1', '서울 광진구', '05048', '컬러: 네이비 / 사이즈: XL(95)', '독도(SSXR802)96898558'],
    [S, '010-1234-5678', '이다라', '부산 2', '니트 가디건', '청평화 가나', '가디건A', '010-3333-4444', '', '', '1', '서울 광진구', '05048', '블랙/FREE', '독도(SSXR802)96898558'],
    [S, '010-1234-5678', '박마바', '대구 3', '면 티셔츠 / 화이트', '', '', '010-4444-5555', '', '', '1', '서울 광진구', '05048', '', '코드없음123'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '2026-11-23');
  const f = path.join(OUT, '온더포엑스_양식.xls');
  XLSX.writeFile(wb, f, { bookType: 'biff8' });
  return f;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await G.setup(ctx);
  const page = await G.newPage(ctx);
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  const alerts = []; page.on('dialog', d => { alerts.push(d.message()); d.accept().catch(() => {}); });
  await G.login(page, 'seller@x.com', 'password1');
  await page.evaluate(() => { keepConfirmed = '없음'; keepConfirmedDate = kstDateKey(); switchSellerMode('fulfillment'); });

  // 1) 글자 나누기
  const p = await page.evaluate(() => [parseMasterCode('독도(SSXR802)96898558'), parseMasterCode(' 독도 ( SSXR802 ) '), parseMasterCode('코드없음123'), parseMasterCode('')]);
  ok(p[0] && p[0].company === '독도' && p[0].product === 'SSXR802', '나누기: 독도 / SSXR802', JSON.stringify(p[0]));
  ok(p[1] && p[1].company === '독도' && p[1].product === 'SSXR802', '나누기: 띄어쓰기 있어도', JSON.stringify(p[1]));
  ok(p[2] === null && p[3] === null, '나누기: 괄호 없으면 그대로 둠');

  // 2) [엑셀 일괄 등록]
  const upload = async file => {
    const b64 = fs.readFileSync(file).toString('base64');
    await page.evaluate(b64 => {
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      handleFileUpload({ target: { files: [new File([bin], 't.xls')], value: '' } });
    }, b64);
    await page.waitForTimeout(1500);
  };
  await page.click('#reg-tab-batch'); await page.waitForTimeout(200);
  await upload(excelFile());
  ok(await page.isVisible('#hk-excel-modal'), '엑셀: 확인표 뜸', alerts.slice(-2).join(' // '));
  await page.locator('#hk-excel-modal > div').screenshot({ path: path.join(OUT, '1_엑셀_확인표.png') });
  const n0 = G.tables.orders.length;
  await page.click('#hk-excel-ok'); await page.waitForTimeout(1200);
  const added = G.tables.orders.slice(n0);
  ok(added.length === 3, '엑셀: 첫 주문 줄도 빠지지 않고 3건', added.length);
  const a = added.find(o => o.recipient === '김가나') || {};
  ok(a.wholesale_company === '독도' && a.wholesale_product === 'SSXR802', '엑셀: 빈 도매 칸 → 마스터상품코드로 채움', a.wholesale_company + '/' + a.wholesale_product);
  ok(/남성경량패딩조끼 \/ 네이비 \/ XL\(95\)/.test(a.product || ''), '엑셀: 주문선택사항(옵션)도 상품명에 붙음', a.product);
  const b = added.find(o => o.recipient === '이다라') || {};
  ok(b.wholesale_company === '청평화 가나' && b.wholesale_product === '가디건A', '엑셀: 이미 적은 도매 칸은 그대로', b.wholesale_company + '/' + b.wholesale_product);
  const c = added.find(o => o.recipient === '박마바') || {};
  ok(c.wholesale_company === '' && c.product === '면 티셔츠 / 화이트', '엑셀: 모양 다른 코드는 무시', JSON.stringify([c.wholesale_company, c.product]));

  // 3) [쇼핑몰 주문서 그대로 올리기] 칸 읽기 (AI 가 알려 준 칸 정보로)
  const ai = await page.evaluate(() => {
    const rows = [['수령자명', '배송지주소', '상품명', '수령자휴대폰번호', '마스터상품코드'], ['김가나', '서울 1', '조끼', '010-2222-3333', '독도(SSXR802)96898558']];
    const r = aiBuildRows(rows, { header_row: 0, columns: { recipient: 0, address: 1, product: 2, phone: 3 } });
    return r[0] && [r[0].wholesaleCompany, r[0].wholesaleProduct];
  });
  ok(ai && ai[0] === '독도' && ai[1] === 'SSXR802', 'AI 올리기: 마스터상품코드로 도매 칸 채움', JSON.stringify(ai));

  // 4) 대표님이 주신 실제 파일 (저장소엔 안 올림)
  if (process.env.REAL_FILE) {
    await page.evaluate(() => { const m = document.getElementById('leftover-modal'); if (m) { m.classList.add('hidden'); m.classList.remove('flex'); } });
    await upload(process.env.REAL_FILE);
    ok(await page.isVisible('#hk-excel-modal'), '실제 파일: 확인표 뜸', alerts.slice(-2).join(' // '));
    const n1 = G.tables.orders.length;
    await page.click('#hk-excel-ok'); await page.waitForTimeout(1200);
    const r = G.tables.orders.slice(n1);
    ok(r.length === 1 && r[0].wholesale_company === '독도' && r[0].wholesale_product === 'SSXR802', '실제 파일: 독도 / SSXR802', JSON.stringify(r.map(o => [o.product, o.wholesale_company, o.wholesale_product])));
  }

  ok(G.pageErrors.length === 0, '페이지 오류 없음 ' + G.pageErrors.join(' | '));
  await browser.close();
  console.log(fail ? `\n실패 ${fail}건` : '\n모두 통과');
  process.exit(fail ? 1 : 0);
})();
