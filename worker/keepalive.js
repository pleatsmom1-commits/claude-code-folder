// 밤낮딜리버리 사이트 + Supabase 자동 깨우기
// - fetch: 사이트 파일(index.html)을 그대로 보여줍니다. /api/settle/send 는 정산서 알림톡 발송(worker/alimtalk.js),
//   /api/signup/notify · /api/seller/approved 는 회원가입·승인 알림 문자(worker/notify.js),
//   /api/ship/send 는 업체별 운송장 전송 알림(worker/shipping.js), /api/order-ai 는 쇼핑몰 주문서 AI 분석(worker/order_ai.js),
//   /api/ask 는 문의 AI 답변(worker/ask.js), /api/inquiry · /api/inquiry/answer 는 AI 가 모르는 문의 접수와 대표님 답변 전달(worker/inquiry.js).
// - scheduled: 정해진 시간마다 Supabase 에 한 번 접속해, 무료 요금제의 '7일 미사용 일시정지'를 막습니다.
import { handleSettleSend, handleSettleMessage } from './alimtalk.js';
import { handleSignupNotify, handleSellerApproved } from './notify.js';
import { handleShipSend } from './shipping.js';
import { handleOrderAi } from './order_ai.js';
import { handleAsk } from './ask.js';
import { handleInquiry, handleInquiryAnswer } from './inquiry.js';

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/settle/send') return handleSettleSend(request, env);
    if (path === '/api/settle/message') return handleSettleMessage(request, env);
    if (path === '/api/signup/notify') return handleSignupNotify(request, env);
    if (path === '/api/seller/approved') return handleSellerApproved(request, env);
    if (path === '/api/ship/send') return handleShipSend(request, env);
    if (path === '/api/order-ai') return handleOrderAi(request, env);
    if (path === '/api/ask') return handleAsk(request, env);
    if (path === '/api/inquiry') return handleInquiry(request, env);
    if (path === '/api/inquiry/answer') return handleInquiryAnswer(request, env);
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(pingSupabase(env));
  },
};

async function pingSupabase(env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/couriers?select=id&limit=1`, {
    headers: { apikey: env.SUPABASE_KEY },
  });
  console.log(`Supabase keepalive: HTTP ${res.status}`);
  if (!res.ok) throw new Error(`Supabase keepalive failed: HTTP ${res.status}`);
}
