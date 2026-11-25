// 문의 AI 답변(worker/ask.js) 점검. 사용: node tests/worker-ask.mjs
const W = new URL('..', import.meta.url).href.replace(/\/$/, '');
const { handleAsk } = await import(W + '/worker/ask.js');
let last, reply = { stop_reason: 'end_turn', content: [{ type: 'text', text: '픽업비는 매장당 1,800원입니다.' }] }, status = 200;
let faq = [{ question: '토요일 픽업?', answer: '토요일도 픽업합니다.' }];
const logs = [];
const pages = [];
globalThis.fetch = async (url, init) => { if (/bamnatdelivery\.com|dothome/.test(String(url))) { pages.push(String(url)); return new Response(String(url).includes('m3') ? '<html><head><title>x</title></head><body><nav>메뉴</nav><p>웹 회원가입 주문접수 추천</p><p>구글폼 접수 <a href="https://forms.gle/abc">폼</a></p><div style="display:none">숨긴 옛 안내</div></body></html>' : '<p>메뉴</p><p>픽업비 1,800원</p>'); } if (String(url).includes('/ai_faq')) return new Response(JSON.stringify(faq)); if (String(url).includes('/rpc/log_ai_chat')) { logs.push(JSON.parse(init.body)); return new Response('', { status: 204 }); } last = { url: String(url), headers: init.headers, body: JSON.parse(init.body) }; return new Response(JSON.stringify(reply), { status }); };
const req = (body, origin = 'https://test-bamnat-delivery.bamnat.workers.dev', ip = '1.1.1.1') => new Request('https://test-bamnat-delivery.bamnat.workers.dev/api/ask',
  { method: 'POST', body: JSON.stringify(body), headers: { Origin: origin, 'CF-Connecting-IP': ip } });
const ok = (c, m) => console.log(c ? 'PASS' : 'FAIL', m);
const env = { ANTHROPIC_API_KEY: 'k', SUPABASE_URL: 'https://sb', SUPABASE_KEY: 'pk' };
let r = await handleAsk(req({ messages: [{ role: 'user', content: '픽업비?' }] }), env), d = await r.json();
ok(r.status === 200 && d.answer.includes('1,800'), 'answer returned');
ok(last.body.model === 'claude-opus-5-5' && last.body.system[0].text.includes('매장당 1,800원') && last.headers['x-api-key'] === 'k', 'system prompt has knowledge');
ok(last.body.system[2].text.includes('토요일도 픽업합니다') && d.needsHuman === false, 'faq included, no handoff');
{ const site = last.body.system[1].text;
  ok(site.includes('웹 회원가입 주문접수 추천') && site.includes('픽업비 1,800원') && site.includes('m3.html'), 'homepage text included');
  ok(!/forms\.gle|구글폼|숨긴 옛 안내/.test(site), 'google form lines and hidden parts removed');
  ok(site.split('메뉴').length === 2, 'repeated menu lines removed');
  ok(last.body.system[1].cache_control && last.body.system[0].text.includes('forms.gle') && last.body.system[0].text.includes('절대 안내하지 않습니다'), 'site block cached + no-form rule'); }
{ const n = pages.length; await handleAsk(req({ messages: [{ role: 'user', content: '또?' }] }, undefined, '8.8.4.4'), env);
  ok(pages.length === n, 'homepage re-used (not read again within 6h)'); }
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
reply = { stop_reason: 'end_turn', model: 'claude-opus-5-5', usage: { input_tokens: 1000, cache_read_input_tokens: 10000, cache_creation_input_tokens: 0, output_tokens: 200 }, content: [{ type: 'text', text: '계좌이체만 됩니다.' }] };
d = await (await handleAsk(req({ messages: [{ role: 'user', content: '카드 돼요?' }], chatId: 'c1', source: 'https://www.bamnatdelivery.com/' }, undefined, '10.0.0.1'), env)).json();
ok(logs.length === 1 && logs[0].p_chat_id === 'c1' && logs[0].p_answer === '계좌이체만 됩니다.' && logs[0].p_needs_human === false && logs[0].p_source.includes('bamnatdelivery'), 'chat log saved (answered)');
// 1000×4 + 10000×4×0.1 + 200×20 = 12000 → $0.012
ok(logs[0].p_model === 'claude-opus-5-5' && logs[0].p_input_tokens === 11000 && logs[0].p_output_tokens === 200 && logs[0].p_cost_usd === 0.012, 'chat cost saved', JSON.stringify(logs[0]));
// 사진 질문 (2026-11-17): 마지막 질문에 사진 1장 → AI 에 image 블록, 기록엔 "[사진 1장]"만
{ status = 200; reply = { stop_reason: 'end_turn', content: [{ type: 'text', text: '오른쪽 위 버튼을 누르세요' }] };
  const n = logs.length;
  r = await handleAsk(req({ messages: [{ role: 'user', content: '이거 뭐예요?' }], image: { media_type: 'image/jpeg', data: 'QUJD' } }, undefined, '10.0.0.1'), env);
  const m = last.body.messages[last.body.messages.length - 1];
  ok(r.status === 200 && Array.isArray(m.content) && m.content[0].type === 'image' && m.content[0].source.data === 'QUJD' && m.content[1].text === '이거 뭐예요?', 'image sent to AI with question');
  ok(logs.length === n + 1 && logs[n].p_question.includes('[사진 1장]') && !JSON.stringify(logs[n]).includes('QUJD'), 'log has [사진 1장], no image data');
  ok(last.body.system[0].text.includes('사진(화면 캡쳐)'), 'image rule in system prompt');
  r = await handleAsk(req({ messages: [{ role: 'user', content: 'q' }], image: { media_type: 'text/html', data: 'QUJD' } }, undefined, '10.0.0.2'), env);
  ok(r.status === 400, 'bad image type blocked');
  r = await handleAsk(req({ messages: [{ role: 'user', content: 'q' }], image: { media_type: 'image/png', data: 'A'.repeat(3_000_001) } }, undefined, '10.0.0.3'), env);
  ok(r.status === 400, 'too big image blocked'); }
globalThis.fetch = async (url, init) => { if (String(url).includes('/rpc/log_ai_chat')) throw new Error('down'); if (String(url).includes('/ai_faq')) return new Response('[]'); return new Response(JSON.stringify(reply)); };
r = await handleAsk(req({ messages: [{ role: 'user', content: 'q' }] }, undefined, '10.0.0.2'), env);
ok(r.status === 200, 'log failure does not break answer');

// 답하지 못한 부분만 (2026-11-22): [모르는질문: …] 은 화면에서 빼고 기록에 따로 남김. 새 함수가 없으면 예전 함수로 다시
{ const calls = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/ai_faq')) return new Response('[]');
    if (/bamnatdelivery\.com|dothome/.test(String(url))) return new Response('<p>x</p>');
    if (String(url).includes('/rpc/ai_chat_allowed')) return new Response('"ok"'); if (String(url).includes('/rpc/log_ai_chat')) { const b = JSON.parse(init.body); calls.push(b); return new Response('{}', { status: 'p_unknown_question' in b ? 404 : 200 }); }
    return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: '픽업비는 1,800원이에요. 제주도는 관리자가 확인해 드려야 해요. [담당자확인] [모르는질문: 제주도도 당일택배가 되나요?]' }] }));
  };
  const d2 = await (await handleAsk(req({ messages: [{ role: 'user', content: '픽업비랑 제주도 당일 돼요?' }] }, undefined, '11.0.0.1'), env)).json();
  ok(d2.needsHuman && !d2.answer.includes('모르는질문') && !d2.answer.includes('['), 'unknown marker stripped from answer');
  ok(calls[0].p_unknown_question === '제주도도 당일택배가 되나요?' && 'p_visitor' in calls[0] && calls.length === 3 && !('p_visitor' in calls[1]) && calls[1].p_unknown_question && !('p_unknown_question' in calls[2]), 'unknown part logged, falls back to older functions'); }
{ const { handleUnknownExtract } = await import(W + '/worker/ask.js');
  const patches = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/rpc/is_admin')) return new Response('true');
    if (u.includes('/ai_chat_logs') && (init.method || 'GET') === 'GET' && u.includes('limit=40')) return new Response(JSON.stringify([{ id: 4, question: '픽업비랑 제주도?', answer: '제주도는 관리자 확인' }, { id: 5, question: '요금표 보여줘', answer: '관리자와 상담하기를 눌러 주세요 ... 실은 4,600원입니다' }]));
    if (u.includes('/ai_chat_logs') && init.method === 'PATCH') { patches.push([u, JSON.parse(init.body)]); return new Response('', { status: 200 }); }
    if (u.includes('/ai_chat_logs')) return new Response('[]', { headers: { 'content-range': '0-0/0' } });
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '[{"id":4,"q":"제주도도 당일택배가 되나요?"},{"id":5,"q":""}]' }] }));
  };
  const mk = tok => new Request('https://x/api/ask/unknown', { method: 'POST', headers: tok ? { Authorization: 'Bearer t' } : {} });
  ok((await handleUnknownExtract(mk(false), env)).status === 401, 'extract needs login');
  const d3 = await (await handleUnknownExtract(mk(true), env)).json();
  ok(d3.done === 2 && d3.aiAnswered === 1 && d3.left === 0, 'extract result', JSON.stringify(d3));
  ok(patches.find(p => p[0].includes('id=eq.4'))[1].unknown_question === '제주도도 당일택배가 되나요?' && patches.find(p => p[0].includes('id=eq.5'))[1].resolved_how === 'ai_ok', 'extract patches rows'); }

// 쉬운 기본 질문은 모름으로 넘기지 않기 (2026-11-25): 우편번호가 안내자료에 있고, 애매한 질문은 흔한 뜻으로 먼저 답하는 규칙
{ const { handleAsk: h2 } = await import(W + '/worker/ask.js'); let sys = '';
  globalThis.fetch = async (url, init) => { if (String(url).includes('/ai_faq')) return new Response('[]'); if (String(url).includes('/rpc/')) return new Response('{}'); if (/bamnatdelivery\.com|dothome/.test(String(url))) return new Response('<p>x</p>'); sys = JSON.parse(init.body).system[0].text; return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: '사무실 우편번호는 04572예요.' }] })); };
  const d4 = await (await h2(req({ messages: [{ role: 'user', content: '우편번호가 어떻게되나요?' }] }, undefined, '12.0.0.1'), env)).json();
  ok(sys.includes('우편번호: 04572') && sys.includes('세 자료') && sys.includes('지어내지 않습니다') && sys.includes('흔히 묻는 뜻'), 'postal code + find-before-handoff rules in prompt');
  ok(d4.needsHuman === false, 'basic question answered without handoff'); }

// 인터넷 검색 (2026-11-25): 공개 정보만 검색, pause_turn 이어 받기, 검색 전 글 빼기, 검색 비용 포함, 끄기 변수
{ const { handleAsk: h3, usageCost } = await import(W + '/worker/ask.js'); const bodies = []; const logs3 = []; let n = 0;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/ai_faq')) return new Response('[]');
    if (u.includes('/rpc/ai_chat_allowed')) return new Response('"ok"');
    if (u.includes('/rpc/log_ai_chat')) { logs3.push(JSON.parse(init.body)); return new Response('{}'); }
    if (/bamnatdelivery\.com|dothome/.test(u)) return new Response('<p>x</p>');
    bodies.push(JSON.parse(init.body)); n++;
    if (n === 1) return new Response(JSON.stringify({ stop_reason: 'pause_turn', usage: { input_tokens: 100, output_tokens: 10, server_tool_use: { web_search_requests: 1 } },
      content: [{ type: 'text', text: '찾아볼게요.' }, { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: '디오트 영업시간' } }] }));
    return new Response(JSON.stringify({ stop_reason: 'end_turn', usage: { input_tokens: 200, output_tokens: 20, server_tool_use: { web_search_requests: 1 } },
      content: [{ type: 'web_search_tool_result', tool_use_id: 's1', content: [] }, { type: 'text', text: '디오트는 저녁 8시에 열어요. (디오트 누리집 기준, 바뀔 수 있어요)' }] }));
  };
  const d5 = await (await h3(req({ messages: [{ role: 'user', content: '디오트 몇 시에 열어요?' }] }, undefined, '13.0.0.1'), env)).json();
  const t = bodies[0].tools?.[0];
  ok(t && t.type === 'web_search_20260209' && t.max_uses === 2 && t.user_location.country === 'KR', 'web search tool sent (KR, max 2)');
  ok(bodies[0].system[0].text.includes('인터넷 검색') && bodies[0].system[0].text.includes('절대 인터넷 검색 결과로 답하지 않습니다'), 'web search rules in prompt');
  ok(n === 2 && bodies[1].messages.at(-1).role === 'assistant' && bodies[1].messages.at(-1).content[1].type === 'server_tool_use', 'pause_turn resumed with assistant content');
  ok(d5.answer.startsWith('디오트는') && !d5.answer.includes('찾아볼게요') && d5.needsHuman === false, 'pre-search text dropped');
  ok(logs3.at(-1).p_input_tokens === 300 && Math.abs(logs3.at(-1).p_cost_usd - (300 * 4 + 30 * 20) / 1e6 - 0.02) < 1e-4, 'usage summed + search cost logged', JSON.stringify(logs3.at(-1)));
  ok(usageCost({ usage: { server_tool_use: { web_search_requests: 3 } } }, 'claude-opus-5-5').cost === 0.03, 'search cost $0.01 each');
  n = 1; bodies.length = 0;
  await h3(req({ messages: [{ role: 'user', content: 'q' }] }, undefined, '13.0.0.2'), { ...env, AI_WEB_SEARCH: 'off' });
  ok(!('tools' in bodies[0]), 'AI_WEB_SEARCH=off -> no tools'); }
{ const { handleAsk: h4 } = await import(W + '/worker/ask.js'); const bodies = [];
  globalThis.fetch = async (url, init) => { const u = String(url); if (u.includes('/ai_faq')) return new Response('[]'); if (u.includes('/rpc/')) return new Response('{}'); if (/bamnatdelivery\.com|dothome/.test(u)) return new Response('<p>x</p>');
    const b = JSON.parse(init.body); bodies.push(b); if (b.tools) return new Response(JSON.stringify({ type: 'error', error: { message: 'web search is not enabled' } }), { status: 400 });
    return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: '픽업비는 1,800원이에요.' }] })); };
  const r6 = await h4(req({ messages: [{ role: 'user', content: '픽업비?' }] }, undefined, '14.0.0.1'), env); const d6 = await r6.json();
  ok(r6.status === 200 && bodies.length === 2 && !bodies[1].tools && d6.answer.includes('1,800'), 'web search refused -> retried without search'); }

// 하루 한도 (2026-11-25): 20번·1만 원 넘으면 AI 를 부르지 않고 카톡 안내, 확인 실패면 막지 않음
{ const { handleAsk: h5 } = await import(W + '/worker/ask.js'); let quota = '"mine"', claude = 0, sent = null; const logged = [];
  globalThis.fetch = async (url, init) => { const u = String(url);
    if (u.includes('/rpc/ai_chat_allowed')) { sent = JSON.parse(init.body); return quota === null ? new Response('{}', { status: 404 }) : new Response(quota); }
    if (u.includes('/rpc/log_ai_chat')) { logged.push(JSON.parse(init.body)); return new Response('{}'); }
    if (u.includes('/ai_faq')) return new Response('[]'); if (/bamnatdelivery\.com|dothome/.test(u)) return new Response('<p>x</p>');
    claude++; return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: '네 가능해요.' }] })); };
  let d = await (await h5(req({ messages: [{ role: 'user', content: 'q' }] }, undefined, '15.0.0.1'), env)).json();
  ok(claude === 0 && d.needsHuman && d.limited === 'mine' && d.answer.includes('20번') && sent.p_max_mine === 20 && sent.p_max_usd === 7.14 && /^[0-9a-f]{32}$/.test(sent.p_visitor) && !sent.p_visitor.includes('15.0'), 'over 20/day -> no AI call, kakao guide, hashed visitor');
  quota = '"total"'; d = await (await h5(req({ messages: [{ role: 'user', content: 'q' }] }, undefined, '15.0.0.2'), env)).json();
  ok(claude === 0 && d.limited === 'total' && d.answer.includes('관리자와 상담하기'), 'over 10,000 won/day -> AI paused');
  quota = null; d = await (await h5(req({ messages: [{ role: 'user', content: 'q' }] }, undefined, '15.0.0.3'), env)).json();
  ok(claude === 1 && !d.limited && d.answer.includes('가능'), 'quota check missing (SQL not run) -> still answers');
  ok(logged.at(-1).p_visitor === sent.p_visitor, 'visitor saved in log'); }
