// 새 픽업요청 사입팀 알림(worker/pickup_notify.js) 점검. 사용: node tests/worker-pickup-notify.mjs
const W = new URL('..', import.meta.url).href.replace(/\/$/, '');
const { handlePickupNotify, parsePhones } = await import(W + '/worker/pickup_notify.js');
const base = { SUPABASE_URL: 'https://sb', SUPABASE_KEY: 'k', SOLAPI_API_KEY: 'a', SOLAPI_API_SECRET: 's', SOLAPI_SENDER: '01054259060', ADMIN_NOTIFY_PHONE: '01054259060', SOLAPI_PF_ID: 'PF' };
const row = () => ({ seller_company: '가나샵', orderer_name: '가나샵', orderer_phone: '010-1234-5678', store_name: '청평화 누보', store_location: '청평화 2층 B-12', store_phone: '02-111-2222', prepay: true, prepay_misong: false, memo: '검정 2장', created_at: '2026-11-07T11:30:00Z', phones: '010-1111-2222, 01033334444, 010-1111-2222' });
let sent = [], claim = [row()];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('claim_pickup_notice')) { const r = claim; claim = []; return new Response(JSON.stringify(r)); }
  if (u.includes('solapi')) { sent.push(JSON.parse(init.body).message); return new Response(JSON.stringify({ statusCode: '2000', messageId: 'm1' })); }
  throw new Error('unexpected ' + u);
};
const ID = '00000000-0000-0000-0000-0000000000a2';
const post = (host, body) => new Request(`https://${host}/api/pickup/notify`, { method: 'POST', body: JSON.stringify(body) });
const ok = (c, m) => console.log(c ? 'PASS' : 'FAIL', m);
ok(JSON.stringify(parsePhones('010-1111-2222, 01033334444 / 010 1111 2222\n02-12')) === '["01011112222","01033334444"]', 'parsePhones');
let r = await (await handlePickupNotify(post('bamnat-delivery.bamnat.workers.dev', { id: ID }), base)).json();
ok(r.status === 'sent' && r.channel === 'sms' && sent.length === 2 && sent[0].to === '01011112222' && sent[1].to === '01033334444', 'production -> 2 team phones by SMS');
ok(sent[0].text.includes('청평화 누보') && sent[0].text.includes('11/7 20:30') && sent[0].text.includes('대납하고 픽업'), 'SMS content (KST time)'); console.log(sent[0].text);
sent = [];
r = await (await handlePickupNotify(post('bamnat-delivery.bamnat.workers.dev', { id: ID }), base)).json();
ok(r.status === 'skipped' && sent.length === 0, 'second call (already notified) -> nothing');
sent = []; claim = [row()];
r = await (await handlePickupNotify(post('test-bamnat-delivery.bamnat.workers.dev', { id: ID }), base)).json();
ok(r.test && sent.length === 1 && sent[0].to === '01054259060' && sent[0].text.startsWith('[테스트] 실제로는 사입팀 2명'), 'test site -> admin phone only'); console.log(sent[0].text.split('\n')[0]);
sent = []; claim = [row()];
r = await (await handlePickupNotify(post('bamnat-delivery.bamnat.workers.dev', { id: ID }), { ...base, SOLAPI_PICKUP_TEMPLATE_ID: 'TP1' })).json();
ok(r.channel === 'alimtalk' && sent.length === 2 && sent[0].kakaoOptions.templateId === 'TP1' && sent[0].kakaoOptions.variables['#{매장상호}'] === '청평화 누보' && sent[0].kakaoOptions.disableSms === false, 'template set -> 알림톡 (SMS fallback)');
sent = []; claim = [{ ...row(), phones: '' }];
r = await (await handlePickupNotify(post('bamnat-delivery.bamnat.workers.dev', { id: ID }), base)).json();
ok(r.status === 'skipped' && sent.length === 0, 'no phones -> skipped');
const res = await handlePickupNotify(post('x', { id: 'bad' }), base);
ok(res.status === 400, 'bad id rejected');
