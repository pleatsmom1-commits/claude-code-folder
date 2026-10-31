// 쇼핑몰 주문서 AI 분석(worker/order_ai.js) 점검. 사용: node tests/worker-order-ai.mjs
const W = new URL('..', import.meta.url).href.replace(/\/$/, '');
const { handleOrderAi, cleanMapping } = await import(W + '/worker/order_ai.js');
const env = { SUPABASE_URL: 'https://sb', SUPABASE_KEY: 'k', ANTHROPIC_API_KEY: 'sk-test' };
const AI_OUT = { header_row: 1, platform: '스마트스토어', columns: { recipient: 2, phone: 3, phone2: -1, zipcode: -1, address: 4, address_detail: 5, product: 6, option: 7, qty: 8, memo: 9, order_no: 0 } };
let company = '애플샵', formats = [], usage = [], claude = [], patches = [], claudeReply = null;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.endsWith('/auth/v1/user')) return init.headers.Authorization === 'Bearer bad' ? new Response('{}', { status: 401 }) : new Response(JSON.stringify({ id: 'u1' }));
  if (u.includes('my_stock_company')) return new Response(JSON.stringify(company));
  if (u.includes('/order_file_formats?company=')) {
    const sig = decodeURIComponent(new URL(u).searchParams.get('signature').slice(3));
    return new Response(JSON.stringify(formats.filter(f => f.signature === sig)));
  }
  if (u.includes('/order_file_formats?id=')) { patches.push(JSON.parse(init.body)); return new Response(''); }
  if (u.includes('/order_file_formats?on_conflict')) { formats.push({ id: formats.length + 1, use_count: 1, ...JSON.parse(init.body) }); return new Response(''); }
  if (u.includes('/ai_usage')) { usage.push(JSON.parse(init.body)); return new Response(''); }
  if (u.includes('api.anthropic.com')) {
    claude.push({ headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(claudeReply || { model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 1500, output_tokens: 200 }, content: [{ type: 'text', text: JSON.stringify(AI_OUT) }] }));
  }
  throw new Error('unexpected ' + u);
};
const post = (body, token = 'good', origin) => new Request('https://bamnat-delivery.bamnat.workers.dev/api/order-ai', {
  method: 'POST', body: JSON.stringify(body), headers: { Authorization: `Bearer ${token}`, ...(origin ? { Origin: origin } : {}) },
});
const ok = (c, m, x = '') => { console.log(c ? 'PASS' : 'FAIL', m, x); if (!c) process.exitCode = 1; };
const rows = [['스마트스토어 주문'], ['주문번호', '구매자', '수취인명', '수취인연락처', '기본주소', '상세주소', '상품명', '옵션정보', '수량', '배송메세지'], ['2026***', '김*', '홍*', '010*****', '서울시 강남구', '101동', '울 팬츠', '블랙/M', '1', '']];
const body = { signature: '주문번호|구매자|수취인명', rows, file_name: '스마트스토어.xlsx' };

let res = await handleOrderAi(post(body), env), r = await res.json();
ok(res.status === 200 && !r.cached && r.mapping.columns.recipient === 2 && r.mapping.header_row === 1, 'first time: AI reads columns', JSON.stringify(r).slice(0, 120));
ok(claude.length === 1 && claude[0].headers['x-api-key'] === 'sk-test' && claude[0].body.output_config.format.type === 'json_schema', 'calls Claude with structured output');
ok(claude[0].body.model === 'claude-opus-5-5' && claude[0].body.output_config.effort === 'low', 'default model + low effort');
ok(claude[0].body.messages[0].content.includes('[2]수취인명'), 'sends numbered columns');
ok(usage.length === 1 && usage[0].company === '애플샵' && Math.abs(usage[0].cost_usd - 0.01) < 1e-9 && usage[0].note === '스마트스토어.xlsx', 'usage logged with cost', JSON.stringify(usage[0]));
ok(formats.length === 1 && formats[0].platform === '스마트스토어', 'format saved');

res = await handleOrderAi(post(body), env); r = await res.json();
ok(r.cached && claude.length === 1 && usage.length === 1 && patches.length === 1 && patches[0].use_count === 2, 'same format again: no AI, no cost');

res = await handleOrderAi(post({ ...body, signature: 'other' }), { ...env, ANTHROPIC_API_KEY: '' });
ok(res.status === 503, 'no key: friendly 503');
res = await handleOrderAi(post(body, 'bad'), env);
ok(res.status === 401, 'bad login blocked');
company = null;
res = await handleOrderAi(post(body), env);
ok(res.status === 403, 'not approved seller blocked');
company = '애플샵';
res = await handleOrderAi(post(body, 'good', 'https://evil.example'), env);
ok(res.status === 403, 'other site blocked');

claudeReply = { model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: JSON.stringify({ ...AI_OUT, columns: { ...AI_OUT.columns, address: -1 } }) }] };
res = await handleOrderAi(post({ ...body, signature: 'noaddr' }), env);
ok(res.status === 422 && !formats.find(f => f.signature === 'noaddr'), 'missing address column: not saved');
ok(cleanMapping({ header_row: 9, columns: AI_OUT.columns }, 3, 10) === null, 'header row out of range rejected');
ok(cleanMapping({ header_row: 1, columns: { ...AI_OUT.columns, memo: 50 } }, 3, 10).columns.memo === -1, 'bad column index dropped');
