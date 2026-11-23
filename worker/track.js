// =====================================================================
// 방문 통계 기록: POST /api/track (track.js 가 보냄)
//  - 주문접수 사이트 · 카페24 홈페이지 · 새 홈페이지(닷홈)의 화면 열기/버튼 누르기/머문 시간을 모읍니다.
//  - 어느 사이트인지는 보낸 곳 주소(Origin)로 서버가 정합니다. 테스트 사이트(미리보기 주소)는 'test' 로 따로 적습니다.
//  - IP·이름·아이디는 저장하지 않습니다 (너무 자주 보내는 곳을 막는 데만 잠깐 메모리에서 씀).
//  - 표와 함수: supabase/site_visits.sql
// =====================================================================
import { PRODUCTION_HOSTS } from './alimtalk.js';
import { fromOurSites } from './ask.js';

const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|kakaotalk-scrap|headless|lighthouse|monitor|curl|wget|python|node-fetch/i;
const MAX_PER_MIN = 120;   // 한 곳에서 1분에 받는 기록 수 (넘으면 버림)

const hits = new Map();
function tooMany(ip, n) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 60_000);
  for (let i = 0; i < n; i++) list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > MAX_PER_MIN;
}

export function siteOf(request) {
  const self = new URL(request.url);
  const origin = request.headers.get('Origin') || '';
  let host = '';
  try { host = origin ? new URL(origin).hostname : self.hostname; } catch { return null; }
  if (/(^|\.)bamnatdelivery\.(com|cafe24\.com)$/.test(host)) return 'cafe24';
  if (host === 'bamnat1.dothome.co.kr') return 'dothome';
  if (host === self.hostname) return PRODUCTION_HOSTS.includes(host) ? 'app' : 'test';
  return null;
}

export const handleTrack = (request, env) => fromOurSites(request, env, track);

async function track(request, env) {
  const done = new Response(null, { status: 204 });
  if (request.method !== 'POST') return done;
  if (BOT_UA.test(request.headers.get('User-Agent') || '')) return done;
  const site = siteOf(request);
  if (!site || !env.SUPABASE_URL || !env.SUPABASE_KEY) return done;
  let body;
  try { body = JSON.parse((await request.text()).slice(0, 20000)); } catch { return done; }
  const events = (Array.isArray(body?.events) ? body.events : []).slice(0, 50)
    .filter(e => e && ['view', 'click', 'time'].includes(e.kind));
  if (!events.length) return done;
  if (tooMany(request.headers.get('CF-Connecting-IP') || 'local', events.length)) return done;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/log_site_events`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_site: site, p_events: events }),
    });
    if (!res.ok) console.log('track: save failed', res.status, (await res.text()).slice(0, 200));
  } catch (err) { console.log('track: save error', String(err).slice(0, 200)); }
  return done;
}
