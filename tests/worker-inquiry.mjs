// 신규업체 AI 상담 문의 접수·답변(worker/inquiry.js) 점검. 사용: node tests/worker-inquiry.mjs
const W = new URL('..', import.meta.url).href.replace(/\/$/, '');
const { handleInquiry, handleInquiryAnswer } = await import(W + '/worker/inquiry.js');
const env = { SUPABASE_URL: 'https://sb', SUPABASE_KEY: 'k', SOLAPI_API_KEY: 'a', SOLAPI_API_SECRET: 's', SOLAPI_SENDER: '01054259060', ADMIN_NOTIFY_PHONE: '01054259060' };
let sent = [], rpc = [], patched = [], faq = [], isAdmin = true;
const inquiry = { company: '새샵', name: '김', phone: '01012345678', question: '견적 받을 수 있나요?', status: 'waiting' };
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('submit_inquiry')) { rpc.push(JSON.parse(init.body)); return new Response('1'); }
  if (u.includes('is_admin')) return new Response(JSON.stringify(isAdmin));
  if (u.includes('/inquiries?') && init.method === 'PATCH') { patched.push(JSON.parse(init.body)); return new Response(null, { status: 204 }); }
  if (u.includes('/inquiries?')) return new Response(JSON.stringify([inquiry]));
  if (u.includes('/ai_faq')) { faq.push(JSON.parse(init.body)); return new Response(null, { status: 201 }); }
  if (u.includes('solapi')) { sent.push(JSON.parse(init.body).message); return new Response(JSON.stringify({ statusCode: '2000' })); }
  throw new Error('unexpected ' + u);
};
const post = (host, path, body, { auth, origin } = {}) => new Request(`https://${host}${path}`, { method: 'POST', body: JSON.stringify(body),
  headers: { ...(auth ? { Authorization: 'Bearer t' } : {}), ...(origin ? { Origin: origin } : {}) } });
const ok = (c, m) => console.log(c ? 'PASS' : 'FAIL', m);
const P = 'bamnat-delivery.bamnat.workers.dev', T = 'test-bamnat-delivery.bamnat.workers.dev';
const good = { company: '새샵', name: '김', phone: '010-1234-5678', question: '견적?', consent: true, chatLog: [{ role: 'user', content: '견적?' }] };

let r = await handleInquiry(post(P, '/api/inquiry', { ...good, consent: false }), env); ok(r.status === 400 && rpc.length === 0, 'no consent blocked');
r = await handleInquiry(post(P, '/api/inquiry', { ...good, phone: '123' }), env); ok(r.status === 400, 'bad phone blocked');
r = await handleInquiry(post(P, '/api/inquiry', good, { origin: 'https://www.bamnatdelivery.com' }), env);
ok(r.status === 200 && rpc[0].p_phone === '01012345678' && r.headers.get('Access-Control-Allow-Origin') === 'https://www.bamnatdelivery.com', 'homepage inquiry saved');
ok(sent[0].to === '01054259060' && sent[0].text.includes('새 AI 상담 문의') && !sent[0].text.startsWith('[테스트]'), 'admin notified'); console.log(sent[0].text);
r = await handleInquiry(post(P, '/api/inquiry', good, { origin: 'https://evil.com' }), env); ok(r.status === 403, 'other origin blocked');

sent = [];
r = await handleInquiryAnswer(post(P, '/api/inquiry/answer', { id: 1, answer: '네, 카톡으로 견적 드려요.', addFaq: true, faqQuestion: '견적 받을 수 있나요?' }, { auth: true }), env);
let d = await r.json();
ok(d.status === 'sent' && sent[0].to === '01012345678' && sent[0].text.includes('카톡으로 견적'), 'answer -> customer phone'); console.log(sent[0].text);
ok(patched[0].status === 'answered' && faq[0].question === '견적 받을 수 있나요?' && faq[0].inquiry_id === 1, 'status saved + faq added');
sent = [];
r = await handleInquiryAnswer(post(T, '/api/inquiry/answer', { id: 1, answer: '테스트' }, { auth: true }), env);
ok(sent[0].to === '01054259060' && sent[0].text.startsWith('[테스트]'), 'test site -> admin phone');
isAdmin = false; sent = [];
r = await handleInquiryAnswer(post(P, '/api/inquiry/answer', { id: 1, answer: 'x' }, { auth: true }), env); ok(r.status === 403 && sent.length === 0, 'non-admin blocked');
r = await handleInquiryAnswer(post(P, '/api/inquiry/answer', { id: 1, answer: 'x' }), env); ok(r.status === 401, 'no login blocked');
