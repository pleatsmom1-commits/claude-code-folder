// =====================================================================
// 새 픽업요청 → 사입팀 자동 알림 (솔라피)
//  - POST /api/pickup/notify { id } : 셀러가 픽업요청을 접수하면 화면이 이 주소를 부릅니다.
//  - 방금 접수된, 아직 안 알린 요청만 한 번씩 보냅니다 (supabase/pickup_notify.sql 의 claim_pickup_notice).
//  - 받는 번호: 관리자 화면 [사입픽업요청] 탭의 '사입팀 알림 받을 번호' (여러 명 가능)
//  - SOLAPI_PICKUP_TEMPLATE_ID 가 있으면 카카오 알림톡으로 보내고(카톡 실패 시 문자로 대신 감),
//    없으면 문자(SMS/LMS)로 보냅니다. 알림톡은 카카오 템플릿 승인 후에 켭니다.
//  - 테스트 사이트(미리보기 주소)에서는 사입팀 대신 대표님 휴대폰(ADMIN_NOTIFY_PHONE)으로만 보냅니다.
// =====================================================================
import { solapiSend, normPhone, maskPhone, json, PRODUCTION_HOSTS } from './alimtalk.js';

export async function handlePickupNotify(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ error: '요청 형식이 올바르지 않습니다.' }, 400); }
  const id = String(body.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: '픽업요청 정보가 올바르지 않습니다.' }, 400);

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/claim_pickup_notice`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_id: id }),
  });
  if (!res.ok) return json({ error: '픽업요청을 확인하지 못했습니다.' }, 502);
  const p = (await res.json())[0];
  if (!p) return json({ status: 'skipped', message: '알릴 새 픽업요청이 없습니다.' });

  const teamPhones = parsePhones(p.phones);
  if (!env.SOLAPI_API_KEY || !env.SOLAPI_API_SECRET || !env.SOLAPI_SENDER) return json({ status: 'skipped', message: '발송 설정 없음' }, 500);

  const url = new URL(request.url);
  const isProduction = PRODUCTION_HOSTS.includes(url.hostname);
  let targets = teamPhones;
  let prefix = '';
  if (!isProduction) {
    targets = [normPhone(env.ADMIN_NOTIFY_PHONE || env.SOLAPI_SENDER)].filter(Boolean);
    prefix = teamPhones.length
      ? `[테스트] 실제로는 사입팀 ${teamPhones.length}명(${teamPhones.map(maskPhone).join(', ')})에게 갑니다.\n`
      : '[테스트] 사입팀 알림 번호가 아직 없습니다.\n';
  }
  if (!targets.length) return json({ status: 'skipped', message: '사입팀 알림 받을 번호가 없습니다.' });

  const vars = pickupVariables(p);
  const useAlimtalk = !!(env.SOLAPI_PICKUP_TEMPLATE_ID && env.SOLAPI_PF_ID) && !prefix;
  const from = normPhone(env.SOLAPI_SENDER);
  const results = [];
  for (const to of targets) {
    const message = useAlimtalk
      ? { to, from, kakaoOptions: { pfId: env.SOLAPI_PF_ID, templateId: env.SOLAPI_PICKUP_TEMPLATE_ID, disableSms: false, variables: vars } }
      : { to, from, text: prefix + pickupText(vars) };
    const r = await solapiSend(env, message);
    results.push({ to: maskPhone(to), ...r });
  }
  const allSent = results.every(r => r.status === 'sent');
  return json({ status: allSent ? 'sent' : 'failed', channel: useAlimtalk ? 'alimtalk' : 'sms', test: !isProduction, results }, allSent ? 200 : 502);
}

// "010-1111-2222, 01033334444 / 010 5555 6666" → ['01011112222', ...] (중복·잘못된 번호 제외)
export function parsePhones(text) {
  const out = [];
  for (const part of String(text || '').split(/[,\n/;]+/)) {
    const n = normPhone(part);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

// 알림톡 템플릿 변수 (카카오에 등록하는 템플릿과 이름이 같아야 함)
export function pickupVariables(p) {
  const t = new Date(p.created_at);
  const kst = new Date(t.getTime() + 9 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  const when = isNaN(t) ? '-' : `${kst.getUTCMonth() + 1}/${kst.getUTCDate()} ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`;
  const v = s => (s && String(s).trim()) || '-';
  return {
    '#{접수시각}': when,
    '#{주문자}': `${v(p.orderer_name || p.seller_company)} / ${v(p.orderer_phone)}`,
    '#{매장상호}': v(p.store_name),
    '#{매장위치}': v(p.store_location),
    '#{매장연락처}': v(p.store_phone),
    '#{대납}': p.prepay ? '대납하고 픽업' : '대납없이 픽업',
    '#{대납미송}': p.prepay_misong ? '재고 없으면 대납미송 잡음' : '대납미송 잡지 않음',
    '#{요청사항}': v(p.memo),
  };
}

function pickupText(vars) {
  return `[밤낮딜리버리] 새 픽업요청\n`
    + `접수: ${vars['#{접수시각}']}\n`
    + `주문자: ${vars['#{주문자}']}\n`
    + `매장: ${vars['#{매장상호}']}\n`
    + `위치: ${vars['#{매장위치}']}\n`
    + `매장연락처: ${vars['#{매장연락처}']}\n`
    + `대납: ${vars['#{대납}']}\n`
    + `대납미송: ${vars['#{대납미송}']}\n`
    + `요청사항: ${vars['#{요청사항}']}`;
}
