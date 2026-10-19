// 밤낮딜리버리 사이트 + Supabase 자동 깨우기
// - fetch: 사이트 파일(index.html)을 그대로 보여줍니다. /api/settle/send 는 정산서 알림톡 발송(worker/alimtalk.js).
// - scheduled: 정해진 시간마다 Supabase 에 한 번 접속해, 무료 요금제의 '7일 미사용 일시정지'를 막습니다.
import { handleSettleSend } from './alimtalk.js';

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/api/settle/send') return handleSettleSend(request, env);
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
