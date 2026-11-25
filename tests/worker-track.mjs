// 방문 통계 기록(worker/track.js) 점검. 사용: node tests/worker-track.mjs
const W = new URL('..', import.meta.url).href.replace(/\/$/, '');
const { handleTrack, siteOf } = await import(W + '/worker/track.js');
const env = { SUPABASE_URL: 'https://sb', SUPABASE_KEY: 'k' };
let rpc = [];
globalThis.fetch = async (url, init = {}) => { if (String(url).includes('log_site_events')) { rpc.push(JSON.parse(init.body)); return new Response('1'); } throw new Error('unexpected ' + url); };
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const P = 'bamnat-delivery.bamnat.workers.dev', T = 'test-bamnat-delivery.bamnat.workers.dev';
const post = (host, body, { origin, ua = 'Mozilla/5.0 Chrome/130' } = {}) => new Request(`https://${host}/api/track`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'User-Agent': ua, ...(origin ? { Origin: origin } : {}) } });
const ev = { events: [{ kind: 'view', path: '/', session: 'abc' }, { kind: 'hack' }] };

let r = await handleTrack(post(P, ev, { origin: 'https://' + P }), env);
ok(r.status === 204 && rpc[0].p_site === 'app' && rpc[0].p_events.length === 1, 'app view saved, bad kind dropped');
r = await handleTrack(post(P, ev, { origin: 'https://www.bamnatdelivery.com' }), env);
ok(rpc[1].p_site === 'cafe24' && r.headers.get('Access-Control-Allow-Origin') === 'https://www.bamnatdelivery.com', 'cafe24 origin');
await handleTrack(post(P, ev, { origin: 'https://m.bamnatdelivery.com' }), env); ok(rpc[2].p_site === 'cafe24', 'cafe24 mobile');
await handleTrack(post(P, ev, { origin: 'http://bamnat1.dothome.co.kr' }), env); ok(rpc[3].p_site === 'dothome', 'dothome origin');
await handleTrack(post(T, ev, { origin: 'https://' + T }), env); ok(rpc[4].p_site === 'test', 'preview = test');
r = await handleTrack(post(P, ev, { origin: 'https://evil.com' }), env); ok(r.status === 403 && rpc.length === 5, 'other origin blocked');
await handleTrack(post(P, ev, { origin: 'https://www.bamnatdelivery.com', ua: 'Mozilla/5.0 (compatible; Googlebot/2.1)' }), env); ok(rpc.length === 5, 'bot ignored');
await handleTrack(post(P, 'not json', { origin: 'https://' + P }), env); ok(rpc.length === 5, 'bad body ignored');
ok(siteOf(new Request('https://' + P + '/api/track')) === 'app', 'no origin header = same site');
