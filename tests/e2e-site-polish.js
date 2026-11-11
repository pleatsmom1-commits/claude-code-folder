// 사이트 소개 전 6가지 손보기 확인용 E2E (가짜 Supabase · 예시 데이터)
// 개인정보 동의·처리방침 / 카톡 미리보기 / 휴대폰 위쪽 줄이기 / 승인대기 화면 / 주문목록 관리칸 고정 / DB 표시 숨김
// 사용: cd tests && npm install && node e2e-site-polish.js [화면저장폴더] [파일이름앞부분]
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const G = require('./guide-shots.js');
const OUT = process.argv[2] || path.join(__dirname, 'out');
const PRE = process.argv[3] || 'polish';
fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.join(__dirname, '..');

(async () => {
  const results = [];
  const check = (name, cond, extra = '') => { const l = `${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`; results.push(l); console.log(l); };
  const shotPath = n => path.join(OUT, `${PRE}-${n}.png`);
  const browser = await chromium.launch();

  // 2. 카톡 미리보기 태그
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('og:title / og:image tags', html.includes('property="og:title"') && html.includes('og:image" content="https://bamnat-delivery.bamnat.workers.dev/og.png"'));
  check('og.png exists', fs.existsSync(path.join(ROOT, 'og.png')));

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await G.setup(ctx);
  const page = await G.newPage(ctx);
  const dialogs = []; page.on('dialog', d => dialogs.push(d.message()));

  // 1. 로그인 화면: 아래 개인정보처리방침 링크 / 6. DB 표시 숨김
  await G.go(page, G.P('index.html'));
  check('footer privacy link on login screen', await page.isVisible('footer a[href="/privacy"]'));
  check('DB badge hidden before login', !(await page.isVisible('#db-status-badge')));
  await page.screenshot({ path: shotPath('login') });
  // 회원가입: 개인정보 동의 필수
  await page.evaluate(() => showSignupModal()); await page.waitForTimeout(300);
  check('signup privacy consent required', (await page.$('#signup-privacy-ok')) !== null && await page.$eval('#signup-privacy-ok', e => e.required));
  const box = page.locator('#signup-privacy-ok').locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
  if (await box.count()) { await box.scrollIntoViewIfNeeded(); await box.screenshot({ path: shotPath('signup-privacy') }); }
  await page.evaluate(() => closeSignupModal());
  // 개인정보처리방침 화면
  const hasPrivacy = fs.existsSync(path.join(ROOT, 'privacy.html'));
  if (hasPrivacy) await G.go(page, G.P('privacy.html'));
  const ptxt = hasPrivacy ? await page.innerText('body') : '';
  check('privacy page: 항목·보관·위탁·국외·책임자', ['모으는 개인정보', '보관 기간', '처리 위탁', '국외', '보호책임자'].every(t => ptxt.includes(t)));
  if (ptxt) await page.screenshot({ path: shotPath('privacy'), fullPage: false });

  // 4. 승인 대기: 접수 화면 대신 안내
  await page.evaluate(() => localStorage.clear());
  await G.login(page, 'wait@x.com', 'waitpass1');
  check('pending: order forms hidden', !(await page.isVisible('#fulfillment-section')) && !(await page.isVisible('#keep-request-box')) && !(await page.isVisible('#seller-order-list')));
  check('pending: kakao copy + refresh buttons', await page.isVisible('#pending-kakao-copy') && (await page.innerText('#seller-status-notice')).includes('새로고침'));
  check('pending: kakao text has company/phone', (await page.innerText('#seller-status-notice')).includes('상호: 새가게') && (await page.innerText('#seller-status-notice')).includes('010-9999-0000'));
  await page.screenshot({ path: shotPath('pending') });
  await page.evaluate(() => logout()); await page.waitForTimeout(800); await page.evaluate(() => localStorage.clear());

  // 승인된 셀러: 접수 화면 그대로, DB 표시 숨김
  await G.login(page, 'seller@x.com', 'password1');
  check('approved: forms visible', await page.isVisible('#fulfillment-section') && await page.isVisible('#keep-request-box'));
  check('approved: no pending class', !(await page.$eval('#seller-dashboard', e => e.classList.contains('seller-pending'))));
  check('seller: DB badge hidden', !(await page.isVisible('#db-status-badge')));
  await page.locator('nav').screenshot({ path: shotPath('nav') });
  // 5. 주문목록 관리칸이 표 오른쪽 끝에 보임
  const scroll = page.locator('#seller-order-scroll');
  const sb = await scroll.boundingBox();
  const btn = page.locator('#seller-order-list button:has-text("수정")').first();
  const bb = (await btn.count()) ? await btn.boundingBox() : null;
  check('edit button visible without side-scroll', !!bb && bb.x + bb.width <= sb.x + sb.width + 1, bb && `${Math.round(bb.x)} vs ${Math.round(sb.x + sb.width)}`);
  const card = page.locator('#seller-order-list').locator('xpath=ancestor::div[contains(@class,"bg-white")][1]');
  await card.screenshot({ path: shotPath('orders') });
  // 기존 기능: 픽업요청 화면 열기
  await page.click('#nav-pickup-btn'); await page.waitForTimeout(800);
  check('pickup page still opens', await page.isVisible('#pickup-form'));

  // 3. 휴대폰: 접수칸이 더 위에
  const m = await browser.newContext({ ...devices['iPhone 13'], locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await G.setup(m);
  const mp = await G.newPage(m);
  await G.login(mp, 'seller@x.com', 'password1');
  const top = await mp.evaluate(() => Math.round(document.getElementById('reg-tab-single').getBoundingClientRect().top + scrollY));
  console.log('mobile: 단건 주문 등록 탭 위치(px) =', top);
  check('mobile: order tabs start higher (< 900px)', top < 900, String(top));
  await mp.screenshot({ path: shotPath('mobile'), clip: { x: 0, y: 0, width: 390, height: 1100 }, fullPage: true });

  // 6. 관리자는 DB 표시가 보임
  G.users['admin@x.com'] = { id: '00000000-0000-0000-0000-0000000000ad', pw: 'adminpass1', profile: { id: '00000000-0000-0000-0000-0000000000ad', email: 'admin@example.com', company: '밤낮', name: '관리', phone: '', role: 'admin', status: 'approved', created_at: '2026-08-01T00:00:00Z' } };
  await page.goto(G.P('index.html')); await page.waitForTimeout(500);
  await page.evaluate(() => logout()); await page.waitForTimeout(800); await page.evaluate(() => localStorage.clear());
  await G.go(page, G.P('index.html'));
  await page.click('#tab-btn-admin').catch(() => {});
  await page.fill('#login-email', 'admin@x.com'); await page.fill('#login-pw', 'adminpass1'); await page.click('#btn-login'); await page.waitForTimeout(1500);
  check('admin: DB badge visible', await page.isVisible('#db-status-badge'));

  check('no page errors', G.pageErrors.length === 0, G.pageErrors.join(' | '));
  await browser.close();
  const fail = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\nRESULT: ${results.length - fail}/${results.length} passed`);
  process.exit(fail ? 1 : 0);
})();
