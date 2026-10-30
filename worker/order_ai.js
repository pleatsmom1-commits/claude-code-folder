// =====================================================================
// 쇼핑몰 주문서 AI 분석 (POST /api/order-ai)
//  - 셀러가 쇼핑몰(스마트스토어·쿠팡·지그재그 등)에서 받은 주문서 엑셀을 그대로 올리면,
//    화면(order-ai.js)이 맨 위 몇 줄만 보내고, AI 가 "몇 번째 칸이 받는분·주소·연락처·상품…"인지 알려 줍니다.
//    실제 주문 전체는 화면에서 이 정보로 읽으므로, AI 에는 맨 위 몇 줄(연락처 일부 가림)만 갑니다.
//  - 같은 모양의 주문서는 order_file_formats 에 저장해 두고 다음부터 AI 없이 바로 씁니다 (비용 0).
//  - AI 를 부를 때마다 ai_usage 에 사용량·비용을 남깁니다 (관리자 'AI 사용료' 화면).
//  - Claude API 키는 Cloudflare 비밀 ANTHROPIC_API_KEY (문의 AI 상담창과 같은 키), 모델은 변수 AI_MODEL.
//  - Cloudflare 배포에 별도 설치(npm) 과정이 없어서, 다른 worker 파일처럼 fetch 로 직접 호출합니다.
// =====================================================================
import { json } from './alimtalk.js';

const MAX_ROWS = 10;       // AI 에 보내는 맨 위 줄 수
const MAX_COLS = 80;
const MAX_CELL = 40;       // 칸 하나 최대 글자 수
const LIMIT_PER_MIN = 10;  // 같은 계정 1분당 AI 분석 수 (사용료 과다 방지)
// 백만 토큰당 달러 (입력, 출력) — 비용 화면 계산용. 모르는 모델은 Opus 5.5 가격으로 계산
const PRICES = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [3, 15], 'claude-haiku-5-5': [1, 5] };

export const FIELDS = ['recipient', 'phone', 'phone2', 'zipcode', 'address', 'address_detail', 'product', 'option', 'qty', 'memo', 'order_no'];

const SYSTEM = `당신은 한국 온라인 쇼핑몰(네이버 스마트스토어, 쿠팡, 지그재그, 에이블리, 카페24, 11번가, G마켓 등)에서 내려받은 "주문서/발주서" 엑셀의 칸 구성을 알아내는 도우미입니다.
엑셀 맨 위 몇 줄이 주어집니다. 각 줄은 0번부터 번호가 붙어 있고, 칸도 0번부터 셉니다.
값 일부는 개인정보 보호를 위해 *로 가려져 있을 수 있습니다.

할 일:
- header_row: 칸 제목이 적힌 줄 번호. (맨 위에 안내 문구가 있는 양식도 있음)
- columns: 아래 항목이 몇 번 칸인지. 없으면 -1.
  recipient = 받는 사람 이름 (수취인/수령인/받는분). 주문자·구매자 이름이 아님.
  phone = 받는 사람 연락처 (수취인 휴대폰/연락처1). 주문자·구매자 연락처가 아님.
  phone2 = 받는 사람 두 번째 연락처 (연락처2/전화번호). 없으면 -1.
  zipcode = 우편번호
  address = 배송지 주소 (전체 주소 또는 기본 주소)
  address_detail = 상세 주소가 따로 있으면 그 칸, 없으면 -1
  product = 상품명 (판매 상품 이름)
  option = 옵션 (색상·사이즈 등 옵션 정보), 없으면 -1
  qty = 수량
  memo = 배송 메세지 (배송 요청사항)
  order_no = 주문번호 (상품주문번호가 따로 있으면 그것)
- platform: 어느 쇼핑몰 양식인지 짐작되면 이름, 모르면 빈 문자열.
- 주문서가 아닌 것 같으면 header_row 를 -1 로 둡니다.`;

const SCHEMA = {
  type: 'object',
  properties: {
    header_row: { type: 'integer' },
    platform: { type: 'string' },
    columns: {
      type: 'object',
      properties: Object.fromEntries(FIELDS.map(f => [f, { type: 'integer' }])),
      required: FIELDS,
      additionalProperties: false,
    },
  },
  required: ['header_row', 'platform', 'columns'],
  additionalProperties: false,
};

const hits = new Map();
function tooMany(key) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter(t => now - t < 60_000);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return list.length > LIMIT_PER_MIN;
}

export async function handleOrderAi(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: '허용되지 않은 요청입니다.' }, 403);
  const userToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!userToken) return json({ error: '로그인이 필요합니다.' }, 401);
  const sb = (path, init = {}) => fetch(`${env.SUPABASE_URL}${path}`, {
    ...init,
    headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });

  const userRes = await sb('/auth/v1/user');
  if (!userRes.ok) return json({ error: '로그인이 만료되었습니다. 다시 로그인해 주세요.' }, 401);
  const user = await userRes.json();
  const compRes = await sb('/rest/v1/rpc/my_stock_company', { method: 'POST', body: '{}' });
  const company = compRes.ok ? await compRes.json() : null;
  if (!company) return json({ error: '관리자 승인된 셀러만 쓸 수 있습니다.' }, 403);

  let body;
  try { body = await request.json(); } catch { return json({ error: '요청 형식이 올바르지 않습니다.' }, 400); }
  const signature = String(body.signature || '').slice(0, 2000);
  const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, MAX_ROWS)
    .map(r => (Array.isArray(r) ? r : []).slice(0, MAX_COLS).map(c => String(c ?? '').slice(0, MAX_CELL)));
  if (!signature || rows.length === 0) return json({ error: '주문서 내용이 비어 있습니다.' }, 400);
  const width = Math.max(...rows.map(r => r.length));

  // 1) 전에 읽어 본 같은 모양의 주문서면 AI 없이 바로
  const cacheRes = await sb(`/rest/v1/order_file_formats?company=eq.${encodeURIComponent(company)}&signature=eq.${encodeURIComponent(signature)}&select=id,platform,mapping,use_count`);
  if (!cacheRes.ok) return json({ error: 'DB 설정이 최신이 아닙니다. (관리자: supabase/order_ai.sql 실행 필요)' }, 500);
  const cached = (await cacheRes.json())[0];
  if (cached) {
    await sb(`/rest/v1/order_file_formats?id=eq.${cached.id}`, {
      method: 'PATCH', body: JSON.stringify({ use_count: (cached.use_count || 0) + 1, last_used_at: new Date().toISOString() }),
    });
    return json({ cached: true, platform: cached.platform, mapping: cached.mapping });
  }

  // 2) 처음 보는 양식 → AI 에 물어봄
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'AI 분석이 아직 준비 중입니다. (관리자: Cloudflare 에 ANTHROPIC_API_KEY 등록 필요)' }, 503);
  if (tooMany(user.id)) return json({ error: '잠시 후 다시 시도해 주세요. (1분에 10번까지)' }, 429);

  const model = env.AI_MODEL || 'claude-opus-5-5';
  const table = rows.map((r, i) => `${i}줄: ${r.map((c, j) => `[${j}]${c}`).join(' | ')}`).join('\n');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{ role: 'user', content: `파일 이름: ${String(body.file_name || '').slice(0, 100)}\n\n${table}` }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.log('order-ai: Claude API error', res.status, JSON.stringify(data).slice(0, 300));
    return json({ error: '지금은 AI 분석을 할 수 없어요. 잠시 후 다시 시도하거나 표준 엑셀양식으로 올려 주세요.' }, 502);
  }

  const usage = data.usage || {};
  const [pin, pout] = PRICES[data.model] || PRICES[model] || PRICES['claude-opus-5-5'];
  const inTok = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
  const outTok = usage.output_tokens || 0;
  await sb('/rest/v1/ai_usage', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      user_id: user.id, company, kind: 'order_file', model: data.model || model,
      input_tokens: inTok, output_tokens: outTok, cost_usd: Math.round((inTok * pin + outTok * pout)) / 1e6,
      note: String(body.file_name || '').slice(0, 100),
    }),
  });

  let out = null;
  if (data.stop_reason !== 'refusal') {
    try { out = JSON.parse((data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')); } catch { out = null; }
  }
  const mapping = cleanMapping(out, rows.length, width);
  if (!mapping) return json({ error: '주문서의 칸 구성을 알아내지 못했어요. 받는분·주소·연락처·상품명 칸이 있는 주문서인지 확인해 주세요.' }, 422);

  await sb('/rest/v1/order_file_formats?on_conflict=company,signature', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ company, signature, platform: String(out.platform || '').slice(0, 50), mapping, use_count: 1 }),
  });
  return json({ cached: false, platform: String(out.platform || ''), mapping });
}

// AI 답이 엉뚱한 칸 번호를 주면 버림. 받는분·주소·상품은 꼭 있어야 함.
export function cleanMapping(out, rowCount, width) {
  if (!out || typeof out !== 'object' || !out.columns) return null;
  const h = Number(out.header_row);
  if (!Number.isInteger(h) || h < 0 || h >= rowCount) return null;
  const columns = {};
  for (const f of FIELDS) {
    const v = Number(out.columns[f]);
    columns[f] = Number.isInteger(v) && v >= 0 && v < width ? v : -1;
  }
  if (columns.recipient < 0 || columns.address < 0 || columns.product < 0) return null;
  return { header_row: h, columns };
}
