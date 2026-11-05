// 문의 AI 답변(worker/ask.js) 점검. 사용: node tests/worker-ask.mjs
const W = new URL('..', import.meta.url).href.replace(/\/$/, '');
const { handleAsk } = await import(W + '/worker/ask.js');
let last, reply = { stop_reason: 'end_turn', content: [{ type: 'text', text: '픽업비는 매장당 1,800원입니다.' }] }, status = 200;
let faq = [{ question: '토요일 픽업?', answer: '토요일도 픽업합니다.' }];
const logs = [];
globalThis.fetch = async (url, init) => { if (String(url).includes('/ai_faq')) return new Response(JSON.stringify(faq)); if (String(url).includes('/rpc/log_ai_chat')) { logs.push(JSON.parse(init.body)); return new Response('', { status: 204 }); } last = { url: String(url), headers: init.headers, body: JSON.parse(init.body) }; return new Response(JSON.stringify(reply), { status }); };
const req = (body, origin = 'https://test-bamnat-delivery.bamnat.workers.dev', ip = '1.1.1.1') => new Request('https://test-bamnat-delivery.bamnat.workers.dev/api/ask',
  { method: 'POST', body: JSON.stringify(body), headers: { Origin: origin, 'CF-Connecting-IP': ip } });
const ok = (c, m) => console.log(c ? 'PASS' : 'FAIL', m);
const env = { ANTHROPIC_API_KEY: 'k', SUPABASE_URL: 'https://sb', SUPABASE_KEY: 'pk' };
let r = await handleAsk(req({ messages: [{ role: 'user', content: '픽업비?' }] }), env), d = await r.json();
ok(r.status === 200 && d.answer.includes('1,800'), 'answer returned');
ok(last.body.model === 'claude-opus-5-5' && last.body.system[0].text.includes('매장당 1,800원') && last.headers['x-api-key'] === 'k', 'system prompt has knowledge');
ok(last.body.system[1].text.includes('토요일도 픽업합니다') && d.needsHuman === false, 'faq included, no handoff');
r = await handleAsk(req({ messages: [{ role: 'user', content: 'x' }] }), {}); ok(r.status === 503, 'no key -> 503');
r = await handleAsk(req({ messages: [{ role: 'user', content: 'x' }] }, 'https://evil.com'), env); ok(r.status === 403, 'other origin blocked');
r = await handleAsk(req({ messages: [{ role: 'user', content: 'a'.repeat(501) }] }, undefined, '2.2.2.2'), env); ok(r.status === 400, 'too long blocked');
r = await handleAsk(req({ messages: [{ role: 'assistant', content: 'hi' }, { role: 'user', content: 'q' }] }, undefined, '3.3.3.3'), env);
ok(r.status === 200 && last.body.messages.length === 1 && last.body.messages[0].role === 'user', 'leading assistant dropped');
reply = { stop_reason: 'refusal', content: [] }; d = await (await handleAsk(req({ messages: [{ role: 'user', content: 'q' }] }, undefined, '4.4.4.4'), env)).json();
ok(d.needsHuman === true && d.answer.includes('연락처'), 'refusal -> needsHuman');
status = 500; r = await handleAsk(req({ messages: [{ role: 'user', content: 'q' }] }, undefined, '5.5.5.5'), env); ok(r.status === 502, 'api error -> 502');
status = 200; reply = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
let codes = []; for (let i = 0; i < 10; i++) codes.push((await handleAsk(req({ messages: [{ role: 'user', content: 'q' }] }, undefined, '9.9.9.9'), env)).status);
ok(codes.slice(0, 8).every(c => c === 200) && codes[8] === 429, 'rate limit after 8/min');
// 홈페이지(www.bamnatdelivery.com)에서 온 질문은 허용 + CORS 헤더
r = await handleAsk(req({ messages: [{ role: 'user', content: 'q' }] }, 'https://www.bamnatdelivery.com', '6.6.6.6'), env);
ok(r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === 'https://www.bamnatdelivery.com', 'homepage origin allowed + CORS');
r = await handleAsk(new Request('https://x/api/ask', { method: 'OPTIONS', headers: { Origin: 'http://bamnatdelivery.com' } }), env);
ok(r.status === 204 && r.headers.get('Access-Control-Allow-Methods').includes('POST'), 'preflight ok');
r = await handleAsk(req({ messages: [{ role: 'user', content: 'q' }] }, 'https://evil.com', '7.7.7.7'), env);
ok(r.status === 403 && !r.headers.get('Access-Control-Allow-Origin'), 'other origin no CORS');
reply = { stop_reason: 'end_turn', content: [{ type: 'text', text: '대표님이 확인해서 연락드릴게요. [담당자확인]' }] };
d = await (await handleAsk(req({ messages: [{ role: 'user', content: '견적?' }] }, undefined, '8.8.8.8'), env)).json();
ok(d.needsHuman === true && !d.answer.includes('[담당자확인]'), 'marker -> needsHuman, stripped');

// 상담 기록: 질문·답변·모름 여부·대화 묶음이 저장됨
const lastLog = logs[logs.length - 1];
ok(lastLog && lastLog.p_question === '견적?' && lastLog.p_needs_human === true && !lastLog.p_answer.includes('[담당자확인]'), 'chat log saved (needs human)');
logs.length = 0;
reply = { stop_reason: 'end_turn', content: [{ type: 'text', text: '계좌이체만 됩니다.' }] };
d = await (await handleAsk(req({ messages: [{ role: 'user', content: '카드 돼요?' }], chatId: 'c1', source: 'https://www.bamnatdelivery.com/' }, undefined, '10.0.0.1'), env)).json();
ok(logs.length === 1 && logs[0].p_chat_id === 'c1' && logs[0].p_answer === '계좌이체만 됩니다.' && logs[0].p_needs_human === false && logs[0].p_source.includes('bamnatdelivery'), 'chat log saved (answered)');
globalThis.fetch = async (url, init) => { if (String(url).includes('/rpc/log_ai_chat')) throw new Error('down'); if (String(url).includes('/ai_faq')) return new Response('[]'); return new Response(JSON.stringify(reply)); };
r = await handleAsk(req({ messages: [{ role: 'user', content: 'q' }] }, undefined, '10.0.0.2'), env);
ok(r.status === 200, 'log failure does not break answer');
