// =====================================================================
// 업체별 운송장 전송 알림 (관리자 [운송장 전송] 탭 → POST /api/ship/send)
//  - 업체마다 "운송장정보가 전달되었습니다 + 출고 N건" 과 확인 링크(/ship?t=...)를 보냅니다.
//  - Cloudflare 설정에 SOLAPI_SHIP_TEMPLATE_ID(카카오 승인된 알림톡 템플릿)가 있으면 알림톡, 없으면 문자로 보냅니다.
//  - 받는 번호: 정산서 발송 탭의 거래처 연락처(settle_contacts) → 없으면 회원가입 연락처(profiles)
//  - 테스트 사이트(미리보기 주소)에서는 "내 번호로 시험 발송"만 됩니다.
// =====================================================================
import { solapiSend, normPhone, maskPhone, json, isSentCurrent, PRODUCTION_HOSTS } from './alimtalk.js';

export async function handleShipSend(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405);
  const userToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!userToken) return json({ error: '로그인이 필요합니다.' }, 401);
  const sb = (path, init = {}) => fetch(`${env.SUPABASE_URL}${path}`, {
    ...init,
    headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const adminRes = await sb('/rest/v1/rpc/is_admin', { method: 'POST', body: '{}' });
  if (!adminRes.ok || (await adminRes.json()) !== true) {
    return json({ error: '관리자 계정만 발송할 수 있습니다. 다시 로그인해 주세요.' }, 403);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: '요청 형식이 올바르지 않습니다.' }, 400); }
  const date = String(body.date || '');
  const companies = Array.isArray(body.companies) ? [...new Set(body.companies.map(String))] : [];
  const resend = body.resend === true;
  const testPhone = body.testPhone ? normPhone(body.testPhone) : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: '출고일이 올바르지 않습니다.' }, 400);
  if (!companies.length) return json({ error: '보낼 업체를 체크해 주세요.' }, 400);
  if (body.testPhone && !testPhone) return json({ error: '시험 발송 받을 휴대폰 번호가 올바르지 않습니다.' }, 400);

  const url = new URL(request.url);
  if (!PRODUCTION_HOSTS.includes(url.hostname) && !testPhone) {
    return json({ error: '테스트 사이트에서는 업체에게 보낼 수 없습니다. [시험 발송]으로 내 번호에만 보내 보세요.' }, 403);
  }
  const missing = ['SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'SOLAPI_SENDER'].filter(k => !env[k]);
  if (missing.length) return json({ error: `발송 설정이 아직 끝나지 않았습니다. Cloudflare 설정에 다음 값이 필요합니다: ${missing.join(', ')}` }, 500);

  const sRes = await sb(`/rest/v1/shipments?ship_date=eq.${date}&select=id,token,company,ship_date,parcel_count,unshipped_count,sent_at,updated_at`);
  if (!sRes.ok) return json({ error: '저장된 운송장 정보를 불러오지 못했습니다. (shipping.sql 을 실행했는지 확인해 주세요)' }, 502);
  const rows = (await sRes.json()).filter(r => companies.includes(r.company));
  if (!rows.length) return json({ error: '보낼 운송장 정보가 없습니다. 먼저 [저장]을 해 주세요.' }, 400);

  const send = (to, row) => solapiSend(env, shipMessage(env, to, row, url.origin));

  if (testPhone) {
    const row = rows[0];
    const r = await send(testPhone, row);
    return json({ test: true, results: [{ company: row.company, to: maskPhone(testPhone), ...r }] });
  }

  const phoneBy = new Map();
  const pRes = await sb('/rest/v1/profiles?select=company,phone');
  if (pRes.ok) for (const p of await pRes.json()) if (normPhone(p.phone)) phoneBy.set(normName(p.company), p.phone);
  const cRes = await sb('/rest/v1/settle_contacts?select=company,phone');
  if (cRes.ok) for (const c of await cRes.json()) if (normPhone(c.phone)) phoneBy.set(normName(c.company), c.phone);

  const results = [];
  const queue = [];
  for (const row of rows) {
    const phone = normPhone(phoneBy.get(normName(row.company)));
    if (isSentCurrent(row) && !resend) results.push({ company: row.company, status: 'skipped', message: '이미 발송됨' });
    else if (!phone) results.push({ company: row.company, status: 'skipped', message: '연락처 없음' });
    else queue.push({ row, phone });
  }
  for (let i = 0; i < queue.length; i += 5) {
    const batch = queue.slice(i, i + 5);
    const sent = await Promise.all(batch.map(q => send(q.phone, q.row)));
    for (let j = 0; j < batch.length; j++) {
      const { row, phone } = batch[j];
      const r = sent[j];
      results.push({ company: row.company, to: maskPhone(phone), ...r });
      const patch = r.status === 'sent'
        ? { sent_at: new Date().toISOString(), send_status: '접수', send_error: null }
        : { send_status: '실패', send_error: r.message };
      try {
        await sb(`/rest/v1/shipments?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' } });
      } catch (e) {
        results[results.length - 1].message += ' (발송 기록 저장 실패)';
      }
    }
  }
  return json({
    results,
    summary: {
      sent: results.filter(r => r.status === 'sent').length,
      failed: results.filter(r => r.status === 'failed').length,
      skipped: results.filter(r => r.status === 'skipped').length,
    },
  });
}

// 알림톡 템플릿이 있으면 알림톡(실패 시 같은 내용 문자), 없으면 문자
export function shipMessage(env, to, row, origin) {
  const from = normPhone(env.SOLAPI_SENDER);
  if (env.SOLAPI_SHIP_TEMPLATE_ID && env.SOLAPI_PF_ID) {
    return {
      to, from,
      kakaoOptions: { pfId: env.SOLAPI_PF_ID, templateId: env.SOLAPI_SHIP_TEMPLATE_ID, disableSms: false, variables: shipTemplateVariables(row) },
    };
  }
  return { to, from, text: shipText(row, origin) };
}

// 알림톡 템플릿 변수 (카카오에 등록하는 템플릿과 이름이 같아야 함 → README 참고)
export function shipTemplateVariables(row) {
  return {
    '#{상호}': row.company,
    '#{출고일}': shipDateLabel(row.ship_date),
    '#{출고건수}': String(row.parcel_count || 0),
    '#{미출고안내}': row.unshipped_count ? `미출고 ${row.unshipped_count}개 상품은 출고되는 대로 다시 안내드립니다.` : '전체 출고되었습니다.',
    '#{토큰}': row.token,
  };
}

export function shipText(row, origin) {
  return [
    `[밤낮딜리버리] ${row.company}님, ${shipDateLabel(row.ship_date)} 운송장정보가 전달되었습니다.`,
    `출고건수: ${row.parcel_count || 0}건` + (row.unshipped_count ? ` (미출고 ${row.unshipped_count}개 상품)` : ''),
    '',
    `운송장 확인: ${origin}/ship?t=${row.token}`,
  ].join('\n');
}

function shipDateLabel(date) {
  const [, m, d] = String(date || '').split('-');
  return m && d ? `${Number(m)}월 ${Number(d)}일` : String(date || '');
}

function normName(v) { return String(v ?? '').replace(/\s+/g, '').toLowerCase(); }
