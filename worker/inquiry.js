// =====================================================================
// 신규업체 AI 상담: AI 가 모르는 질문 → 대표님 답변 → 손님 휴대폰으로 전달
//  - POST /api/inquiry        : 손님이 연락처를 남김 → 답변 대기 문의로 저장 + 대표님 휴대폰 문자 알림
//  - POST /api/inquiry/answer : 관리자가 답변을 적고 [보내기] → 손님 휴대폰으로 문자, 답변 모음집(ai_faq)에도 추가
//      테스트 사이트(미리보기 주소)에서는 손님 대신 대표님 휴대폰으로 보냄
//  - 표와 함수는 supabase/inquiries.sql
// =====================================================================
import { solapiSend, normPhone, maskPhone, json, PRODUCTION_HOSTS } from './alimtalk.js';
import { fromOurSites } from './ask.js';

const CONTACT = '추가 문의: 카카오톡 bamnatdelivery / 010-5425-9060';

export const handleInquiry = (request, env) => fromOurSites(request, env, submitInquiry);

async function submitInquiry(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ error: '요청 형식이 올바르지 않습니다.' }, 400); }
  if (body.consent !== true) return json({ error: '개인정보 수집·이용에 동의해 주세요.' }, 400);
  const phone = normPhone(body.phone);
  if (!/^01\d{8,9}$/.test(phone || '')) return json({ error: '휴대폰 번호를 확인해 주세요.' }, 400);
  const question = String(body.question || '').trim();
  if (!question) return json({ error: '문의 내용을 적어 주세요.' }, 400);
  const chatLog = (Array.isArray(body.chatLog) ? body.chatLog : []).slice(-10)
    .filter(m => m && typeof m.content === 'string')
    .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content.slice(0, 2000) }));

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/submit_inquiry`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_company: String(body.company || ''), p_name: String(body.name || ''), p_phone: phone,
      p_question: question.slice(0, 1000), p_chat_log: chatLog, p_source: String(body.source || '').slice(0, 300),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.log('inquiry: save failed', res.status, JSON.stringify(err).slice(0, 300));
    const msg = /[가-힣]/.test(err.message || '') ? err.message : '문의를 저장하지 못했어요. 카카오톡 bamnatdelivery 또는 010-5425-9060으로 문의해 주세요.';
    return json({ error: msg }, res.status >= 500 ? 502 : 400);
  }

  // 대표님께 새 문의 알림 문자 (실패해도 문의 저장은 된 것)
  const to = normPhone(env.ADMIN_NOTIFY_PHONE || env.SOLAPI_SENDER);
  if (to && env.SOLAPI_API_KEY && env.SOLAPI_API_SECRET) {
    const site = new URL(request.url);
    const test = PRODUCTION_HOSTS.includes(site.hostname) ? '' : '[테스트] ';
    const short = question.length > 80 ? question.slice(0, 80) + '…' : question;
    const text = `${test}[밤낮딜리버리] 새 AI 상담 문의 (답변대기)\n상호: ${body.company || '-'}\n이름: ${body.name || '-'}\n연락처: ${phone}\n문의: ${short}\n\n관리자 화면 > AI 상담에서 답변해 주세요.\n${site.origin}`;
    const r = await solapiSend(env, { to, from: normPhone(env.SOLAPI_SENDER), text });
    if (r.status !== 'sent') console.log('inquiry: admin notify failed', r.message);
  }
  return json({ status: 'saved' });
}

export async function handleInquiryAnswer(request, env) {
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
  const id = Number(body.id);
  const answer = String(body.answer || '').trim();
  if (!Number.isInteger(id) || id <= 0) return json({ error: '문의 정보가 올바르지 않습니다.' }, 400);
  if (!answer) return json({ error: '답변을 적어 주세요.' }, 400);

  const qRes = await sb(`/rest/v1/inquiries?id=eq.${id}&select=company,name,phone,question,status`);
  if (!qRes.ok) return json({ error: '문의를 불러오지 못했습니다. (inquiries.sql 을 실행했는지 확인해 주세요)' }, 502);
  const q = (await qRes.json())[0];
  if (!q) return json({ error: '문의를 찾지 못했습니다.' }, 404);
  if (!env.SOLAPI_API_KEY || !env.SOLAPI_API_SECRET || !env.SOLAPI_SENDER) return json({ error: '문자 발송 설정이 없습니다.' }, 500);

  const site = new URL(request.url);
  const isProduction = PRODUCTION_HOSTS.includes(site.hostname);
  const to = isProduction ? normPhone(q.phone) : normPhone(env.ADMIN_NOTIFY_PHONE || env.SOLAPI_SENDER);
  const who = [q.company, q.name].filter(Boolean).join(' ');
  let text = `[밤낮딜리버리] ${who ? who + '님, ' : ''}문의하신 내용 답변드립니다.\n\n문의: ${q.question}\n\n답변: ${answer}\n\n${CONTACT}`;
  if (!isProduction) text = `[테스트] 실제로는 손님(${maskPhone(q.phone)})에게 갑니다.\n` + text;
  const r = await solapiSend(env, { to, from: normPhone(env.SOLAPI_SENDER), text });
  if (r.status !== 'sent') return json({ error: '문자 발송 실패: ' + r.message }, 502);

  const now = new Date().toISOString();
  const up = await sb(`/rest/v1/inquiries?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'answered', answer, answered_at: now, send_result: `${isProduction ? '' : '[테스트] '}문자 발송 ${maskPhone(to)}` }),
  });
  let faqSaved = false;
  const faqQuestion = String(body.faqQuestion || '').trim();
  const faqAnswer = String(body.faqAnswer || answer).trim();
  if (body.addFaq && faqQuestion && faqAnswer) {
    const f = await sb('/rest/v1/ai_faq', {
      method: 'POST',
      body: JSON.stringify({ question: faqQuestion, answer: faqAnswer, inquiry_id: id }),
    });
    faqSaved = f.ok;
  }
  return json({ status: 'sent', to: maskPhone(to), test: !isProduction, saved: up.ok, faqSaved });
}
