// =====================================================================
// 비회원 간단 주문접수 (회원가입 없이 /quick 화면에서 첫 주문)
//  - POST /api/quick-order : 손님이 남긴 픽업할 매장 + 받는 분을 저장 (supabase/quick_orders.sql 의 submit_quick_order)
//    → 대표님 휴대폰(ADMIN_NOTIFY_PHONE, 쉼표로 여러 개)으로 새 접수 알림 문자
//  - 관리자는 [사입 픽업요청] 탭 맨 위 '비회원 간단 접수'에서 보고 처리합니다 (quick-admin.js).
// =====================================================================
import { solapiSend, normPhone, json, PRODUCTION_HOSTS } from './alimtalk.js';
import { fromOurSites } from './ask.js';
import { adminPhones } from './notify.js';

export const handleQuickOrder = (request, env) => fromOurSites(request, env, submitQuickOrder);

const s = (v, n) => String(v ?? '').trim().slice(0, n);

export function cleanQuickOrder(body) {
  const stores = (Array.isArray(body.stores) ? body.stores : []).slice(0, 20).map(x => ({
    mall: s(x && x.mall, 50), store: s(x && x.store, 50), floor: s(x && x.floor, 30), phone: s(x && x.phone, 20),
  }));
  const recipients = (Array.isArray(body.recipients) ? body.recipients : []).slice(0, 50).map(x => ({
    name: s(x && x.name, 50), phone: s(x && x.phone, 20), address: s(x && x.address, 200),
    product: s(x && x.product, 300), message: s(x && x.message, 200),
  }));
  const shipTo = body.shipTo === 'customer' ? 'customer' : body.shipTo === 'store' ? 'store' : '';
  const errors = [];
  if (!s(body.company, 100)) errors.push('상호를 적어 주세요.');
  if (!/^01\d{8,9}$/.test(normPhone(body.phone) || '')) errors.push('휴대폰 번호를 확인해 주세요.');
  if (!stores.length || stores.some(x => !x.mall || !x.store || !x.floor || !x.phone)) errors.push('픽업할 매장의 상가명·매장상호·층/호수·연락처를 모두 적어 주세요.');
  if (typeof body.prepay !== 'boolean' || typeof body.prepayMisong !== 'boolean') errors.push('대납 여부를 골라 주세요.');
  if ((body.prepay || body.prepayMisong) && body.agreed !== true) errors.push('대납금 선입금 안내에 동의해 주세요.');
  if (!shipTo) errors.push('받는 곳을 골라 주세요.');
  if (!recipients.length || recipients.some(x => !x.name || !x.phone || !x.address)) errors.push('받는 분 이름·연락처·주소를 모두 적어 주세요.');
  if (shipTo === 'customer' && recipients.some(x => !x.product)) errors.push('고객 배송은 상품 정보를 꼭 적어 주세요.');
  if (body.consent !== true) errors.push('개인정보 수집·이용에 동의해 주세요.');
  return {
    errors,
    row: {
      p_company: s(body.company, 100), p_phone: normPhone(body.phone), p_stores: stores,
      p_prepay: !!body.prepay, p_prepay_misong: !!body.prepayMisong, p_ship_to: shipTo,
      p_recipients: recipients, p_memo: s(body.memo, 1000), p_source: s(body.source, 300),
    },
  };
}

async function submitQuickOrder(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ error: '요청 형식이 올바르지 않습니다.' }, 400); }
  const { errors, row } = cleanQuickOrder(body);
  if (errors.length) return json({ error: errors[0] }, 400);

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/submit_quick_order`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.log('quick-order: save failed', res.status, JSON.stringify(err).slice(0, 300));
    const msg = /[가-힣]/.test(err.message || '') ? err.message : '접수를 저장하지 못했어요. 카카오톡 bamnatdelivery 또는 010-5425-9060으로 연락해 주세요.';
    return json({ error: msg }, res.status >= 500 ? 502 : 400);
  }
  const saved = (await res.json().catch(() => []))[0] || {};

  // 대표님께 새 접수 알림 문자 (실패해도 접수 저장은 된 것)
  if (env.SOLAPI_API_KEY && env.SOLAPI_API_SECRET) {
    const site = new URL(request.url);
    const text = quickOrderNotifyText(row, saved.nth, site, PRODUCTION_HOSTS.includes(site.hostname));
    for (const to of adminPhones(env)) {
      const r = await solapiSend(env, { to, from: normPhone(env.SOLAPI_SENDER), text });
      if (r.status !== 'sent') console.log('quick-order: admin notify failed', r.message);
    }
  }
  return json({ status: 'saved', nth: saved.nth || 1 });
}

export function quickOrderNotifyText(row, nth, site, isProduction) {
  const stores = row.p_stores.map(x => `${x.mall} ${x.floor} ${x.store}`).join(', ');
  return [
    `${isProduction ? '' : '[테스트] '}[밤낮딜리버리] 새 비회원 간단 주문접수${nth > 1 ? ` (${nth}번째 이용)` : ''}`,
    `상호: ${row.p_company}`,
    `연락처: ${row.p_phone}`,
    `픽업: ${stores.length > 60 ? stores.slice(0, 60) + '…' : stores}`,
    `받는 분: ${row.p_recipients.length}명 (${row.p_ship_to === 'customer' ? '고객 배송' : '매장·사무실'})`,
    '',
    `관리자 화면 > 사입 픽업요청에서 확인해 주세요.`,
    site.origin,
  ].join('\n');
}
