// =====================================================================
// 정산서 알림톡 발송 (관리자 화면 [알림톡 발송] → POST /api/settle/send)
//  - 솔라피 API 키는 Cloudflare 비밀값(SOLAPI_API_KEY / SOLAPI_API_SECRET)에만 있고, 브라우저로 나가지 않습니다.
//  - 요청한 사람이 관리자인지 Supabase 로 확인한 뒤, 그 관리자 권한으로 정산서·연락처를 읽고 발송 결과를 기록합니다.
//  - 테스트 사이트(미리보기 주소)에서는 "내 번호로 시험 발송"만 됩니다.
// =====================================================================

const PRODUCTION_HOSTS = [
  'bamnat-delivery.bamnat.workers.dev',
  'bamnat-delivery.pleatsmom1.workers.dev',
];

export async function handleSettleSend(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST 요청만 받습니다.' }, 405);

  const userToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!userToken) return json({ error: '로그인이 필요합니다.' }, 401);

  const sb = (path, init = {}) => fetch(`${env.SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_KEY,
      Authorization: `Bearer ${userToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  const adminRes = await sb('/rest/v1/rpc/is_admin', { method: 'POST', body: '{}' });
  if (!adminRes.ok || (await adminRes.json()) !== true) {
    return json({ error: '관리자 계정만 발송할 수 있습니다. 다시 로그인해 주세요.' }, 403);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: '요청 형식이 올바르지 않습니다.' }, 400); }
  const date = String(body.date || '');
  const onlyCompanies = Array.isArray(body.companies) ? body.companies.map(String) : null;
  const resend = body.resend === true;
  const testPhone = body.testPhone ? normPhone(body.testPhone) : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: '정산일이 올바르지 않습니다.' }, 400);
  if (body.testPhone && !testPhone) return json({ error: '시험 발송 받을 휴대폰 번호가 올바르지 않습니다.' }, 400);

  const isProduction = PRODUCTION_HOSTS.includes(new URL(request.url).hostname);
  if (!isProduction && !testPhone) {
    return json({ error: '테스트 사이트에서는 실제 거래처에게 보낼 수 없습니다. [시험 발송]으로 내 번호에만 보내 보세요.' }, 403);
  }

  const missing = ['SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'SOLAPI_PF_ID', 'SOLAPI_TEMPLATE_ID', 'SOLAPI_SENDER']
    .filter(k => !env[k]);
  if (missing.length) {
    return json({ error: `발송 설정이 아직 끝나지 않았습니다. Cloudflare 설정에 다음 값이 필요합니다: ${missing.join(', ')}` }, 500);
  }

  const sRes = await sb(`/rest/v1/settlements?settle_date=eq.${date}&select=id,token,company,seq,total,result,data,sent_at,updated_at&order=seq`);
  if (!sRes.ok) return json({ error: '저장된 정산서를 불러오지 못했습니다.' }, 502);
  let rows = await sRes.json();
  if (onlyCompanies) rows = rows.filter(r => onlyCompanies.includes(r.company));
  if (!rows.length) return json({ error: '보낼 정산서가 없습니다. 먼저 [정산서 저장]을 해 주세요.' }, 400);

  const cRes = await sb('/rest/v1/settle_contacts?select=company,phone');
  if (!cRes.ok) return json({ error: '거래처 연락처를 불러오지 못했습니다.' }, 502);
  const phoneBy = new Map((await cRes.json()).map(c => [normName(c.company), c.phone]));

  // 시험 발송: 첫 번째 정산서 1건을 내 번호로만 보냄 (발송 기록은 남기지 않음)
  if (testPhone) {
    const row = rows[0];
    const r = await sendOne(env, testPhone, row);
    return json({ test: true, results: [{ company: row.company, to: maskPhone(testPhone), ...r }] });
  }

  const results = [];
  const queue = [];
  for (const row of rows) {
    const phone = normPhone(phoneBy.get(normName(row.company)));
    if (isSentCurrent(row) && !resend) results.push({ company: row.company, status: 'skipped', message: '이미 발송됨' });
    else if (!phone) results.push({ company: row.company, status: 'skipped', message: '연락처 없음' });
    else queue.push({ row, phone });
  }

  // 솔라피에 5건씩 동시에 접수
  for (let i = 0; i < queue.length; i += 5) {
    const batch = queue.slice(i, i + 5);
    const sent = await Promise.all(batch.map(q => sendOne(env, q.phone, q.row)));
    for (let j = 0; j < batch.length; j++) {
      const { row, phone } = batch[j];
      const r = sent[j];
      results.push({ company: row.company, to: maskPhone(phone), ...r });
      const patch = r.status === 'sent'
        ? { sent_at: new Date().toISOString(), send_status: '접수', send_error: null }
        : { send_status: '실패', send_error: r.message };
      try {
        await sb(`/rest/v1/settlements?id=eq.${row.id}`, {
          method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' },
        });
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

// 알림톡 1건 접수. 카톡을 못 받으면 솔라피가 문자로 대신 보냄.
async function sendOne(env, to, row) {
  return solapiSend(env, {
    to,
    from: normPhone(env.SOLAPI_SENDER),
    kakaoOptions: {
      pfId: env.SOLAPI_PF_ID,
      templateId: env.SOLAPI_TEMPLATE_ID,
      disableSms: false,
      variables: templateVariables(row),
    },
  });
}

// =====================================================================
// 체크한 업체에 직접 쓴 문자 보내기 (관리자 화면 [문자 보내기] → POST /api/settle/message)
//  - 알림톡은 승인된 템플릿만 보낼 수 있어서, 자유 문구는 문자(SMS/LMS)로 보냅니다. 길이에 따라 솔라피가 단문/장문을 고릅니다.
//  - 문구 안의 {상호} 는 업체 이름으로 바뀝니다. includeLink 면 그 업체 정산서 링크를 끝에 붙입니다.
//  - 발송 기록은 DB 에 남기지 않습니다 (결과는 화면에만 표시).
// =====================================================================
export async function handleSettleMessage(request, env) {
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
  const date = String(body.date || '');
  const companies = Array.isArray(body.companies) ? [...new Set(body.companies.map(String))] : [];
  const text = String(body.text || '').trim();
  const includeLink = body.includeLink === true;
  const testPhone = body.testPhone ? normPhone(body.testPhone) : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: '정산일이 올바르지 않습니다.' }, 400);
  if (!companies.length) return json({ error: '문자 보낼 업체를 체크해 주세요.' }, 400);
  if (!text) return json({ error: '보낼 내용을 입력해 주세요.' }, 400);
  if (text.length > 1000) return json({ error: '내용이 너무 깁니다. (1,000자 이내)' }, 400);
  if (body.testPhone && !testPhone) return json({ error: '시험으로 받을 휴대폰 번호가 올바르지 않습니다.' }, 400);

  const url = new URL(request.url);
  if (!PRODUCTION_HOSTS.includes(url.hostname) && !testPhone) {
    return json({ error: '테스트 사이트에서는 거래처에게 보낼 수 없습니다. [내 번호로 시험]으로 내 번호에만 보내 보세요.' }, 403);
  }
  const missing = ['SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'SOLAPI_SENDER'].filter(k => !env[k]);
  if (missing.length) return json({ error: `발송 설정이 아직 끝나지 않았습니다. Cloudflare 설정에 다음 값이 필요합니다: ${missing.join(', ')}` }, 500);

  const tokenBy = new Map();
  if (includeLink) {
    const sRes = await sb(`/rest/v1/settlements?settle_date=eq.${date}&select=company,token`);
    if (!sRes.ok) return json({ error: '정산서 링크를 불러오지 못했습니다.' }, 502);
    for (const s of await sRes.json()) tokenBy.set(s.company, s.token);
  }
  const buildText = company => {
    let t = text.replace(/\{상호\}/g, company);
    const token = tokenBy.get(company);
    if (includeLink && token) t += `\n\n정산서 보기: ${url.origin}/settle?t=${token}`;
    return t;
  };
  const from = normPhone(env.SOLAPI_SENDER);

  if (testPhone) {
    const company = companies[0];
    const r = await solapiSend(env, { to: testPhone, from, text: buildText(company) });
    return json({ test: true, results: [{ company, to: maskPhone(testPhone), ...r }] });
  }

  const cRes = await sb('/rest/v1/settle_contacts?select=company,phone');
  if (!cRes.ok) return json({ error: '거래처 연락처를 불러오지 못했습니다.' }, 502);
  const phoneBy = new Map((await cRes.json()).map(c => [normName(c.company), c.phone]));

  const results = [];
  const queue = [];
  for (const company of companies) {
    const phone = normPhone(phoneBy.get(normName(company)));
    if (!phone) results.push({ company, status: 'skipped', message: '연락처 없음' });
    else if (includeLink && !tokenBy.get(company)) results.push({ company, status: 'skipped', message: '저장된 정산서 링크 없음' });
    else queue.push({ company, phone });
  }
  for (let i = 0; i < queue.length; i += 5) {
    const batch = queue.slice(i, i + 5);
    const sent = await Promise.all(batch.map(q => solapiSend(env, { to: q.phone, from, text: buildText(q.company) })));
    batch.forEach((q, j) => results.push({ company: q.company, to: maskPhone(q.phone), ...sent[j] }));
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

// 솔라피 메시지 1건 접수 (알림톡·문자 공통)
async function solapiSend(env, message) {
  try {
    const res = await fetch(`${env.SOLAPI_BASE_URL || 'https://api.solapi.com'}/messages/v4/send`, {
      method: 'POST',
      headers: { Authorization: await solapiAuth(env), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { status: 'failed', message: data.errorMessage || data.errorCode || `HTTP ${res.status}` };
    if (data.statusCode && !String(data.statusCode).startsWith('2')) {
      return { status: 'failed', message: data.statusMessage || data.statusCode };
    }
    return { status: 'sent', message: '접수됨', messageId: data.messageId || null };
  } catch (e) {
    return { status: 'failed', message: '솔라피 연결 실패: ' + e.message };
  }
}

// 보낸 뒤에 정산서가 다시 저장됐으면(2분 넘게 늦게) 바뀐 정산서는 아직 안 보낸 것으로 봄 (settle-admin.js 와 같은 규칙)
export function isSentCurrent(row) {
  if (!row.sent_at) return false;
  const sent = new Date(row.sent_at).getTime();
  const updated = row.updated_at ? new Date(row.updated_at).getTime() : NaN;
  return !(updated && updated - sent > 2 * 60 * 1000);
}

// 템플릿 변수 (승인된 템플릿과 이름이 같아야 함)
export function templateVariables(row) {
  const d = row.data || {};
  const [, m, day] = String(row.settle_date || d.date || '').split('-');
  return {
    '#{상호}': row.company,
    '#{정산일}': m && day ? `${Number(m)}월 ${Number(day)}일` : String(row.settle_date || ''),
    '#{정산결과}': resultText(row.result ?? d.result, row.total ?? d.total),
    '#{입금계좌}': d.account ? String(d.account) : '-',
    '#{토큰}': row.token,
  };
}

export function resultText(result, total) {
  const n = Number(total);
  const won = Number.isFinite(n) ? Math.abs(n).toLocaleString('en-US') : '';
  if (result === '청구') return `청구 · ${won}원 입금 부탁드립니다`;
  if (result === '이월') return `이월 · 잔여금 ${won}원`;
  if (result === '영수') return '영수 · 결제완료';
  return `${result || '-'}${won ? ` · ${won}원` : ''}`;
}

// 솔라피 인증 헤더: HMAC-SHA256(API Secret, date + salt)
export async function solapiAuth(env, now = new Date(), salt = randomHex(16)) {
  const date = now.toISOString();
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.SOLAPI_API_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(date + salt));
  const signature = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `HMAC-SHA256 apiKey=${env.SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`;
}

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

function normName(v) { return String(v ?? '').replace(/\s+/g, '').toLowerCase(); }

function normPhone(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  return /^0\d{8,10}$/.test(d) ? d : null;
}

function maskPhone(p) { return p ? `${p.slice(0, 3)}-****-${p.slice(-4)}` : ''; }

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
