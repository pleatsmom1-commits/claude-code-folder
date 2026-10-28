// =====================================================================
// 회원가입·승인 알림 문자 (솔라피)
//  - POST /api/signup/notify  : 셀러가 회원가입하면 대표님 휴대폰(ADMIN_NOTIFY_PHONE)으로 문자
//      방금 가입한 승인대기 계정만 한 번씩 보냄 (supabase/signup_notify.sql 의 claim_signup_notice)
//  - POST /api/seller/approved : 관리자가 [승인]을 누르면 그 셀러 연락처로 "승인되었습니다" 문자
//      테스트 사이트(미리보기 주소)에서는 셀러 대신 대표님 휴대폰으로 보냄
//  - 알림톡은 카카오 승인 템플릿이 있어야 해서, 우선 문자(SMS)로 보냅니다.
// =====================================================================
import { solapiSend, normPhone, maskPhone, json, PRODUCTION_HOSTS } from './alimtalk.js';

export async function handleSignupNotify(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ error: '요청 형식이 올바르지 않습니다.' }, 400); }
  const email = String(body.email || '').trim();
  if (!email) return json({ error: '이메일이 없습니다.' }, 400);

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/claim_signup_notice`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_email: email }),
  });
  if (!res.ok) return json({ error: '가입 정보를 확인하지 못했습니다.' }, 502);
  const p = (await res.json())[0];
  if (!p) return json({ status: 'skipped', message: '알릴 새 가입이 없습니다.' });

  const to = adminPhone(env);
  if (!to || !env.SOLAPI_API_KEY || !env.SOLAPI_API_SECRET) return json({ status: 'skipped', message: '발송 설정 없음' }, 500);
  const origin = new URL(request.url).origin;
  const text = `[밤낮딜리버리] 새 회원가입 (승인대기)\n상호: ${p.company || '-'}\n대표자: ${p.name || '-'}\n연락처: ${p.phone || '-'}\n\n관리자 화면 > 셀러 관리에서 [승인]해 주세요.\n${origin}`;
  const r = await solapiSend(env, { to, from: normPhone(env.SOLAPI_SENDER), text });
  return json(r, r.status === 'sent' ? 200 : 502);
}

export async function handleSellerApproved(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405);
  const userToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!userToken) return json({ error: '로그인이 필요합니다.' }, 401);
  const sb = (path, init = {}) => fetch(`${env.SUPABASE_URL}${path}`, {
    ...init,
    headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const adminRes = await sb('/rest/v1/rpc/is_admin', { method: 'POST', body: '{}' });
  if (!adminRes.ok || (await adminRes.json()) !== true) {
    return json({ error: '관리자 계정만 보낼 수 있습니다. 다시 로그인해 주세요.' }, 403);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: '요청 형식이 올바르지 않습니다.' }, 400); }
  const id = String(body.sellerId || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: '셀러 정보가 올바르지 않습니다.' }, 400);

  const pRes = await sb(`/rest/v1/profiles?id=eq.${id}&select=company,phone,status`);
  if (!pRes.ok) return json({ error: '셀러 정보를 불러오지 못했습니다.' }, 502);
  const p = (await pRes.json())[0];
  if (!p) return json({ error: '셀러를 찾지 못했습니다.' }, 404);
  if (p.status !== 'approved') return json({ error: '아직 승인되지 않은 셀러입니다.' }, 400);

  const sellerPhone = normPhone(p.phone);
  if (!sellerPhone) return json({ status: 'skipped', message: '셀러 연락처 없음' });
  if (!env.SOLAPI_API_KEY || !env.SOLAPI_API_SECRET || !env.SOLAPI_SENDER) return json({ status: 'skipped', message: '발송 설정 없음' }, 500);

  const url = new URL(request.url);
  const isProduction = PRODUCTION_HOSTS.includes(url.hostname);
  const to = isProduction ? sellerPhone : adminPhone(env);
  let text = `[밤낮딜리버리] ${p.company}님, 회원가입이 승인되었습니다.\n이제 주문 접수가 가능합니다.\n${url.origin}`;
  if (!isProduction) text = `[테스트] 실제로는 셀러(${maskPhone(sellerPhone)})에게 갑니다.\n` + text;
  const r = await solapiSend(env, { to, from: normPhone(env.SOLAPI_SENDER), text });
  return json({ ...r, to: maskPhone(to), test: !isProduction }, r.status === 'sent' ? 200 : 502);
}

function adminPhone(env) { return normPhone(env.ADMIN_NOTIFY_PHONE || env.SOLAPI_SENDER); }
