// 운송장 전송 알림(worker/shipping.js) 점검. 사용: node tests/worker-ship.mjs
const W = new URL('..', import.meta.url).href.replace(/\/$/, '');
const { handleShipSend, shipText } = await import(W + '/worker/shipping.js');
const env = { SUPABASE_URL: 'https://sb', SUPABASE_KEY: 'k', SOLAPI_API_KEY: 'a', SOLAPI_API_SECRET: 's', SOLAPI_SENDER: '01054259060', SOLAPI_PF_ID: 'pf' };
const rows = [
  { id: 1, token: 't1', company: '럭스걸', ship_date: '2026-10-28', parcel_count: 10, unshipped_count: 0, sent_at: null, updated_at: null },
  { id: 2, token: 't2', company: '무드투문', ship_date: '2026-10-28', parcel_count: 3, unshipped_count: 2, sent_at: null, updated_at: null },
  { id: 3, token: 't3', company: '몬다', ship_date: '2026-10-28', parcel_count: 1, unshipped_count: 0, sent_at: null, updated_at: null },
];
let sent = [], patches = [], isAdmin = true;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('is_admin')) return new Response(JSON.stringify(isAdmin));
  if (u.includes('/shipments?ship_date')) return new Response(JSON.stringify(rows));
  if (u.includes('/shipments?id=')) { patches.push([u, JSON.parse(init.body)]); return new Response(''); }
  if (u.includes('/profiles?')) return new Response(JSON.stringify([{ company: '몬다', phone: '010-3333-4444' }]));
  if (u.includes('/settle_contacts?')) return new Response(JSON.stringify([{ company: '럭스걸', phone: '01077778888' }, { company: '무드 투문', phone: '' }]));
  if (u.includes('solapi')) { sent.push(JSON.parse(init.body).message); return new Response(JSON.stringify({ statusCode: '2000' })); }
  throw new Error('unexpected ' + u);
};
const post = (host, body) => new Request(`https://${host}/api/ship/send`, { method: 'POST', body: JSON.stringify(body), headers: { Authorization: 'Bearer t' } });
const ok = (c, m, x = '') => console.log(c ? 'PASS' : 'FAIL', m, x);
const PROD = 'bamnat-delivery.bamnat.workers.dev', TEST = 'test-bamnat-delivery.bamnat.workers.dev';

let r = await (await handleShipSend(post(PROD, { date: '2026-10-28', companies: ['럭스걸', '무드투문', '몬다'] }), env)).json();
ok(r.summary.sent === 2 && r.summary.skipped === 1, 'sends only checked companies with phone', JSON.stringify(r.summary));
ok(sent.map(m => m.to).sort().join() === '01033334444,01077778888', 'phones: settle_contacts then profiles');
const lux = sent.find(m => m.to === '01077778888');
ok(lux.text.includes('럭스걸님, 10월 28일 운송장정보가 전달되었습니다') && lux.text.includes('출고건수: 10건') && lux.text.includes('/ship?t=t1'), 'SMS text', lux.text);
ok(patches.length === 2 && patches.every(p => p[1].sent_at), 'sent_at recorded');
ok(shipText(rows[1], 'https://x').includes('(미출고 2개 상품)'), 'unshipped note');
sent = [];
r = await (await handleShipSend(post(PROD, { date: '2026-10-28', companies: ['몬다'] }), { ...env, SOLAPI_SHIP_TEMPLATE_ID: 'TPL' })).json();
ok(sent[0].kakaoOptions && sent[0].kakaoOptions.templateId === 'TPL' && sent[0].kakaoOptions.variables['#{출고건수}'] === '1', 'alimtalk when template set');
sent = [];
let res = await handleShipSend(post(TEST, { date: '2026-10-28', companies: ['럭스걸'] }), env);
ok(res.status === 403 && !sent.length, 'test site: real send blocked');
r = await (await handleShipSend(post(TEST, { date: '2026-10-28', companies: ['럭스걸'], testPhone: '010-5425-9060' }), env)).json();
ok(r.test && sent.length === 1 && sent[0].to === '01054259060', 'test site: test phone only');
isAdmin = false; sent = [];
res = await handleShipSend(post(PROD, { date: '2026-10-28', companies: ['럭스걸'] }), env);
ok(res.status === 403 && !sent.length, 'non-admin blocked');
