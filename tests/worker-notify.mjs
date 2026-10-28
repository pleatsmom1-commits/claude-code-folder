// 회원가입·승인 알림 문자(worker/notify.js) 점검. 사용: node tests/worker-notify.mjs
const W = new URL('..', import.meta.url).href.replace(/\/$/, '');
const { handleSignupNotify, handleSellerApproved } = await import(W + '/worker/notify.js');
const env = { SUPABASE_URL: 'https://sb', SUPABASE_KEY: 'k', SOLAPI_API_KEY: 'a', SOLAPI_API_SECRET: 's', SOLAPI_SENDER: '01054259060', ADMIN_NOTIFY_PHONE: '01054259060' };
let sent = [], claim = [{ company: '신규샵', name: '박', phone: '010-1234-5678' }], isAdmin = true, profile = { company: '누보', phone: '010-9999-8888', status: 'approved' };
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('claim_signup_notice')) { const r = claim; claim = []; return new Response(JSON.stringify(r)); }
  if (u.includes('is_admin')) return new Response(JSON.stringify(isAdmin));
  if (u.includes('/profiles?')) return new Response(JSON.stringify([profile]));
  if (u.includes('solapi')) { sent.push(JSON.parse(init.body).message); return new Response(JSON.stringify({ statusCode: '2000', messageId: 'm1' })); }
  throw new Error('unexpected ' + u);
};
const post = (host, path, body, auth) => new Request(`https://${host}${path}`, { method: 'POST', body: JSON.stringify(body), headers: auth ? { Authorization: 'Bearer t' } : {} });
const ok = (c, m) => console.log(c ? 'PASS' : 'FAIL', m);
let r = await (await handleSignupNotify(post('test-bamnat-delivery.bamnat.workers.dev', '/api/signup/notify', { email: 'a@b.c' }), env)).json();
ok(r.status === 'sent' && sent[0].to === '01054259060' && sent[0].text.includes('신규샵'), 'signup -> admin SMS'); console.log(sent[0].text);
r = await (await handleSignupNotify(post('x', '/api/signup/notify', { email: 'a@b.c' }), env)).json();
ok(r.status === 'skipped' && sent.length === 1, 'second call no SMS');
sent = [];
r = await (await handleSellerApproved(post('bamnat-delivery.bamnat.workers.dev', '/api/seller/approved', { sellerId: '00000000-0000-0000-0000-00000000000a' }, true), env)).json();
ok(r.status === 'sent' && sent[0].to === '01099998888' && !r.test, 'production approve -> seller'); console.log(sent[0].text);
sent = [];
r = await (await handleSellerApproved(post('test-bamnat-delivery.bamnat.workers.dev', '/api/seller/approved', { sellerId: '00000000-0000-0000-0000-00000000000a' }, true), env)).json();
ok(r.status === 'sent' && sent[0].to === '01054259060' && r.test && sent[0].text.startsWith('[테스트]'), 'test site approve -> admin phone');
isAdmin = false; sent = [];
let res = await handleSellerApproved(post('bamnat-delivery.bamnat.workers.dev', '/api/seller/approved', { sellerId: '00000000-0000-0000-0000-00000000000a' }, true), env);
ok(res.status === 403 && sent.length === 0, 'non-admin blocked');
isAdmin = true; profile.status = 'pending';
res = await handleSellerApproved(post('bamnat-delivery.bamnat.workers.dev', '/api/seller/approved', { sellerId: '00000000-0000-0000-0000-00000000000a' }, true), env);
ok(res.status === 400 && sent.length === 0, 'not-approved blocked');
