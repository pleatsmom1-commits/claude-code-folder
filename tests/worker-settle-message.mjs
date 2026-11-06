// 정산 문자(worker/alimtalk.js handleSettleMessage) + 미납 계산(settle-admin.js settleFindUnpaid) 점검. 사용: node tests/worker-settle-message.mjs
import fs from 'fs';
process.env.TZ = 'Asia/Seoul'; // 미납 일수는 한국 날짜 기준
const W = new URL('..', import.meta.url).href.replace(/\/$/, '');
const { handleSettleMessage } = await import(W + '/worker/alimtalk.js');
const env = { SUPABASE_URL: 'https://sb', SUPABASE_KEY: 'k', SOLAPI_API_KEY: 'a', SOLAPI_API_SECRET: 's', SOLAPI_SENDER: '01054259060' };
const settlements = [
  { company: '럭스걸', token: 'L1', settle_date: '2026-11-03' }, { company: '럭스걸', token: 'L2', settle_date: '2026-11-04' },
  { company: '몬다', token: 'M1', settle_date: '2026-11-03' },
];
let sent = [], lastSettleUrl = '';
globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url));
  if (u.includes('is_admin')) return new Response('true');
  if (u.includes('/settlements?')) {
    lastSettleUrl = u;
    const m = u.match(/settle_date=in\.\(([^)]*)\)|settle_date=eq\.([\d-]+)/);
    const dates = (m[1] || m[2]).split(',');
    return new Response(JSON.stringify(settlements.filter(s => dates.includes(s.settle_date))));
  }
  if (u.includes('/settle_contacts?')) return new Response(JSON.stringify([{ company: '럭스걸', phone: '01077778888' }, { company: '몬다', phone: '01033334444' }, { company: '카터', phone: '01011112222' }]));
  if (u.includes('solapi')) { sent.push(JSON.parse(init.body).message); return new Response(JSON.stringify({ statusCode: '2000' })); }
  throw new Error('unexpected ' + u);
};
const post = body => new Request('https://bamnat-delivery.bamnat.workers.dev/api/settle/message', { method: 'POST', body: JSON.stringify(body), headers: { Authorization: 'Bearer t' } });
const ok = (c, m, x = '') => { console.log(c ? 'PASS' : 'FAIL', m, x); if (!c) process.exitCode = 1; };

// 1) 일반 공지: 링크 없이, 정산서 없는 업체도 발송
let r = await (await handleSettleMessage(post({ date: '2026-11-06', companies: ['카터', '럭스걸'], text: '{상호}님 공지', includeLink: false }), env)).json();
ok(r.summary.sent === 2 && sent.every(m => !m.text.includes('정산서 보기')), 'notice: no link, sends to companies without settlement', JSON.stringify(r.summary));
ok(sent.find(m => m.to === '01011112222').text === '카터님 공지', 'notice text');

// 2) 미납 안내: 업체마다 다른 정산일의 링크
sent = [];
r = await (await handleSettleMessage(post({ date: '2026-11-06', companies: ['럭스걸', '몬다'], text: '{상호}님 미납', includeLink: true, companyDates: { 럭스걸: '2026-11-04', 몬다: '2026-11-03' } }), env)).json();
ok(r.summary.sent === 2, 'unpaid: both sent', JSON.stringify(r.summary));
ok(sent.find(m => m.to === '01077778888').text.endsWith('/settle?t=L2') && sent.find(m => m.to === '01033334444').text.endsWith('/settle?t=M1'), 'unpaid: link = each company last settlement');

// 3) 기존 정산서 문자: 정산일 하나 그대로
sent = [];
r = await (await handleSettleMessage(post({ date: '2026-11-03', companies: ['럭스걸'], text: 'x', includeLink: true }), env)).json();
ok(sent[0].text.endsWith('/settle?t=L1') && lastSettleUrl.includes('settle_date=in.(2026-11-03)'), 'settle mode unchanged');

// 4) 미납 계산
const src = fs.readFileSync(new URL('../settle-admin.js', import.meta.url), 'utf8');
const fn = src.slice(src.indexOf('function settleFindUnpaid'), src.indexOf('async function loadSettleUnpaid'));
const settleFindUnpaid = new Function(fn + '; return settleFindUnpaid;')();
const now = new Date('2026-11-06T09:00:00+09:00').getTime();
const rows = [
  // A: 11/3 보냄, 11/4 같은 금액·입금0 → 11/3부터 3일째 미납
  { company: 'A', settle_date: '2026-11-03', total: 1000, result: '청구', sent_at: '2026-11-03T07:00:00Z', paid: '0' },
  { company: 'A', settle_date: '2026-11-04', total: 1000, result: '청구', sent_at: '2026-11-04T07:00:00Z', paid: null, token: 'a4' },
  // B: 11/5 입금 → 영수
  { company: 'B', settle_date: '2026-11-03', total: 500, result: '청구', sent_at: '2026-11-03T07:00:00Z' },
  { company: 'B', settle_date: '2026-11-05', total: 0, result: '영수', sent_at: '2026-11-05T07:00:00Z', paid: '500' },
  // C: 어제 보냄 → 아직 2일 안 됨
  { company: 'C', settle_date: '2026-11-05', total: 700, result: '청구', sent_at: '2026-11-05T07:00:00Z' },
  // D: 입금 없이 금액이 늘어남(매일 서비스) → 11/2 처음 보낸 날부터 4일째 미납
  { company: 'D', settle_date: '2026-11-02', total: 300, result: '청구', sent_at: '2026-11-02T07:00:00Z' },
  { company: 'D', settle_date: '2026-11-05', total: 900, result: '청구', sent_at: '2026-11-05T07:00:00Z' },
  // G: 오늘 입금 일부 후 금액이 늘었어도 입금 있으면 끊김 → 오늘 보낸 것만 (0일)
  { company: 'G', settle_date: '2026-11-01', total: 300, result: '청구', sent_at: '2026-11-01T07:00:00Z' },
  { company: 'G', settle_date: '2026-11-06', total: 500, result: '청구', sent_at: '2026-11-06T07:00:00Z', paid: '300' },
  // E: 일부 입금했는데 같은 금액(입금액 있음) → 묶음 끊김
  { company: 'E', settle_date: '2026-11-01', total: 400, result: '청구', sent_at: '2026-11-01T07:00:00Z' },
  { company: 'E', settle_date: '2026-11-05', total: 400, result: '청구', sent_at: '2026-11-05T07:00:00Z', paid: '100' },
  // F: 보낸 적 없음
  { company: 'F', settle_date: '2026-11-01', total: 400, result: '청구', sent_at: null },
];
const u = settleFindUnpaid(rows, 2, now);
const ua = u.find(x => x.company === 'A'), ud = u.find(x => x.company === 'D');
ok(u.length === 2 && ua.days === 3 && ua.firstDate === '2026-11-03' && ua.lastDate === '2026-11-04' && ua.token === 'a4', 'unpaid: A (same amount)', JSON.stringify(u));
ok(ud && ud.days === 4 && ud.total === 900 && ud.firstTotal === 300 && ud.firstDate === '2026-11-02', 'unpaid: D (amount keeps growing, no payment)');
ok(settleFindUnpaid(rows, 0, now).map(x => x.company).sort().join() === 'A,C,D,E,G', 'unpaid with 0 days');
