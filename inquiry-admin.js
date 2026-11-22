// =====================================================================
// 관리자 > AI 상담
//  - 답변 대기 문의: AI 가 모르는 질문에 손님이 남긴 연락처 → 답변 적고 [보내기] 하면 손님 휴대폰으로 문자 (worker/inquiry.js)
//  - 답변 모음집(ai_faq): AI 가 답할 때 참고하는 대표님 답변. 추가·수정·끄기·삭제
//  표: supabase/inquiries.sql
//  index.html 의 supabaseClient, currentRole, escapeHtml, dbErrorMessage 를 사용합니다.
// =====================================================================

let inquiryRows = [];
let faqRows = [];

const INQUIRY_STATUS = {
    waiting: ['답변대기', 'bg-orange-100 text-orange-700'],
    answered: ['답변보냄', 'bg-emerald-100 text-emerald-700'],
    closed: ['완료(미발송)', 'bg-slate-100 text-slate-600'],
};

function inquiryTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function inquiryPhone(v) {
    const d = String(v || '');
    return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : d;
}

async function onInquiryTabOpened() {
    await Promise.all([fetchInquiries(), fetchFaq()]);
}

async function fetchInquiries() {
    if (!supabaseClient || currentRole !== 'admin') return;
    const filter = document.getElementById('inquiry-status-filter').value;
    let q = supabaseClient.from('inquiries').select('*').order('created_at', { ascending: false }).limit(200);
    if (filter !== 'all') q = q.eq('status', filter);
    const { data, error } = await q;
    if (error) {
        document.getElementById('inquiry-list').innerHTML = `<div class="text-rose-600 text-xs">문의를 불러오지 못했습니다. ${escapeHtml(dbErrorMessage(error))}<br>(Supabase 에서 supabase/inquiries.sql 을 실행했는지 확인해 주세요)</div>`;
        return;
    }
    inquiryRows = data || [];
    renderInquiries();
    refreshInquiryBadge();
}

async function refreshInquiryBadge() {
    if (!supabaseClient || currentRole !== 'admin') return;
    refreshUnansweredBadge();
    const { count } = await supabaseClient.from('inquiries').select('id', { count: 'exact', head: true }).eq('status', 'waiting');
    ['admin-group-inquiry-badge'].forEach(id => {
        const b = document.getElementById(id);
        if (!b) return;
        b.innerText = `대기 ${count || 0}`;
        b.classList.toggle('hidden', !count);
    });
}

function renderInquiries() {
    const box = document.getElementById('inquiry-list');
    if (!inquiryRows.length) {
        box.innerHTML = '<div class="text-xs text-slate-400 py-6 text-center">문의가 없습니다.</div>';
        return;
    }
    box.innerHTML = inquiryRows.map(r => {
        const [label, cls] = INQUIRY_STATUS[r.status] || [r.status, ''];
        const log = (r.chat_log || []).map(m =>
            `<div class="${m.role === 'user' ? 'text-slate-800' : 'text-slate-500'}"><b>${m.role === 'user' ? '손님' : 'AI'}:</b> ${escapeHtml(m.content)}</div>`).join('');
        const waiting = r.status === 'waiting';
        const isQuote = String(r.question || '').startsWith('[견적문의]');
        return `
<div class="border border-slate-200 rounded-xl p-4 space-y-2 bg-white" data-inquiry="${r.id}">
  <div class="flex flex-wrap items-center gap-2 text-xs">
    <span class="px-2 py-0.5 rounded font-bold ${cls}">${escapeHtml(label)}</span>
    ${isQuote ? '<span class="px-2 py-0.5 rounded font-bold bg-violet-100 text-violet-700">💰 견적문의</span>' : ''}
    <span class="text-slate-400">${inquiryTime(r.created_at)}</span>
    <b class="text-slate-800">${escapeHtml(r.company || '-')}</b>
    <span>${escapeHtml(r.name || '')}</span>
    <a href="tel:${escapeHtml(r.phone)}" class="text-indigo-600 font-bold">${escapeHtml(inquiryPhone(r.phone))}</a>
    ${r.source ? `<span class="text-slate-400 truncate max-w-[220px]" title="${escapeHtml(r.source)}">${escapeHtml(r.source.includes('bamnatdelivery.com') ? '홈페이지' : '주문접수 사이트')}</span>` : ''}
  </div>
  <div class="text-sm font-bold text-slate-900 whitespace-pre-wrap">${escapeHtml(r.question)}</div>
  ${log ? `<details class="text-xs"><summary class="cursor-pointer text-slate-500">AI 와 나눈 대화 보기</summary><div class="mt-1 space-y-1 bg-slate-50 rounded p-2 whitespace-pre-wrap">${log}</div></details>` : ''}
  ${waiting ? `
  <textarea class="inq-answer w-full border border-slate-300 rounded-lg p-2 text-sm" rows="3" placeholder="손님께 보낼 답변"></textarea>
  <label class="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" class="inq-faq" ${isQuote ? '' : 'checked'}> AI 답변 모음집에도 추가 (다음부터 AI 가 이 답을 참고)</label>
  <input class="inq-faq-q w-full border border-slate-200 rounded-lg p-2 text-xs" value="${escapeHtml(r.question)}" placeholder="모음집에 넣을 질문 (손님 이름·번호는 빼고 적어 주세요)">
  <div class="flex gap-2 justify-end">
    <button onclick="closeInquiry(${r.id})" class="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-lg">보내지 않고 완료</button>
    <button onclick="sendInquiryAnswer(${r.id}, this)" class="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg">답변 보내기 (문자)</button>
  </div>` : `
  ${r.answer ? `<div class="text-xs bg-emerald-50 rounded p-2 whitespace-pre-wrap"><b>보낸 답변:</b> ${escapeHtml(r.answer)}</div>` : ''}
  <div class="text-[11px] text-slate-400">${inquiryTime(r.answered_at)} ${escapeHtml(r.send_result || '')}</div>`}
</div>`;
    }).join('');
}

async function sendInquiryAnswer(id, btn) {
    const card = document.querySelector(`[data-inquiry="${id}"]`);
    const answer = card.querySelector('.inq-answer').value.trim();
    if (!answer) { alert('답변을 적어 주세요.'); return; }
    const row = inquiryRows.find(r => r.id === id);
    if (!confirm(`${row.company || row.name || '손님'}(${inquiryPhone(row.phone)})께 문자로 답변을 보낼까요?`)) return;
    btn.disabled = true;
    btn.textContent = '보내는 중…';
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) throw new Error('로그인이 필요합니다. 다시 로그인해 주세요.');
        const res = await fetch('/api/inquiry/answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({
                id, answer,
                addFaq: card.querySelector('.inq-faq').checked,
                faqQuestion: card.querySelector('.inq-faq-q').value.trim(),
            }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `발송 서버 오류 (HTTP ${res.status})`);
        alert(`답변을 보냈습니다. (${data.to})${data.test ? '\n테스트 사이트라 대표님 휴대폰으로 보냈습니다.' : ''}${data.faqSaved ? '\nAI 답변 모음집에도 추가했습니다.' : ''}`);
    } catch (e) {
        alert('보내지 못했습니다: ' + e.message);
    }
    await onInquiryTabOpened();
}

async function closeInquiry(id) {
    if (!confirm('문자를 보내지 않고 완료로 바꿀까요? (카톡·전화로 직접 답한 경우)')) return;
    const { error } = await supabaseClient.from('inquiries').update({ status: 'closed', answered_at: new Date().toISOString() }).eq('id', id);
    if (error) alert('저장하지 못했습니다: ' + dbErrorMessage(error));
    await fetchInquiries();
}

// ---------------------------------------------------------------------
// 답변 모음집
// ---------------------------------------------------------------------
async function fetchFaq() {
    if (!supabaseClient || currentRole !== 'admin') return;
    const { data, error } = await supabaseClient.from('ai_faq').select('*').order('id', { ascending: false });
    if (error) {
        document.getElementById('faq-list').innerHTML = `<div class="text-rose-600 text-xs">모음집을 불러오지 못했습니다. ${escapeHtml(dbErrorMessage(error))}</div>`;
        return;
    }
    faqRows = data || [];
    renderFaq();
}

function renderFaq() {
    const box = document.getElementById('faq-list');
    document.getElementById('faq-count').innerText = `${faqRows.filter(f => f.active).length}개 사용 중`;
    if (!faqRows.length) {
        box.innerHTML = '<div class="text-xs text-slate-400 py-4 text-center">아직 없습니다. 자주 받는 질문과 대표님 답을 추가해 주세요.</div>';
        return;
    }
    box.innerHTML = faqRows.map(f => `
<div class="border border-slate-200 rounded-lg p-3 space-y-1 ${f.active ? 'bg-white' : 'bg-slate-50 opacity-60'}" data-faq="${f.id}">
  <input class="faq-q w-full text-sm font-bold border-0 border-b border-transparent focus:border-slate-300 outline-none" value="${escapeHtml(f.question)}">
  <textarea class="faq-a w-full text-xs border border-slate-200 rounded p-2" rows="2">${escapeHtml(f.answer)}</textarea>
  <div class="flex gap-2 justify-end text-xs">
    <label class="flex items-center gap-1 mr-auto text-slate-500"><input type="checkbox" class="faq-on" ${f.active ? 'checked' : ''}> AI 가 참고</label>
    <button onclick="deleteFaq(${f.id})" class="px-2 py-1 text-rose-600 font-bold">삭제</button>
    <button onclick="saveFaq(${f.id})" class="px-3 py-1 bg-slate-800 text-white font-bold rounded">저장</button>
  </div>
</div>`).join('');
}

async function addFaq() {
    const q = document.getElementById('faq-new-q').value.trim();
    const a = document.getElementById('faq-new-a').value.trim();
    if (!q || !a) { alert('질문과 답을 모두 적어 주세요.'); return; }
    const { error } = await supabaseClient.from('ai_faq').insert({ question: q, answer: a, active: true });
    if (error) { alert('저장하지 못했습니다: ' + dbErrorMessage(error)); return; }
    document.getElementById('faq-new-q').value = '';
    document.getElementById('faq-new-a').value = '';
    await fetchFaq();
    if (faqRows[0]) flashFaqSaved(faqRows[0].id);
}

async function saveFaq(id) {
    const card = document.querySelector(`[data-faq="${id}"]`);
    const question = card.querySelector('.faq-q').value.trim();
    const answer = card.querySelector('.faq-a').value.trim();
    if (!question || !answer) { alert('질문과 답을 모두 적어 주세요.'); return; }
    const { error } = await supabaseClient.from('ai_faq')
        .update({ question, answer, active: card.querySelector('.faq-on').checked, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { alert('저장하지 못했습니다: ' + dbErrorMessage(error)); return; }
    await fetchFaq();
    flashFaqSaved(id);
}

// 저장 버튼 자리에 잠깐 "저장됨 ✓" 표시 (저장이 됐는지 눈으로 확인)
function flashFaqSaved(id) {
    const btn = document.querySelector(`[data-faq="${id}"] button[onclick^="saveFaq"]`);
    if (!btn) return;
    btn.textContent = '저장됨 ✓';
    btn.classList.replace('bg-slate-800', 'bg-emerald-600');
    setTimeout(() => { btn.textContent = '저장'; btn.classList.replace('bg-emerald-600', 'bg-slate-800'); }, 2000);
}

async function deleteFaq(id) {
    if (!confirm('이 답변을 모음집에서 지울까요?')) return;
    const { error } = await supabaseClient.from('ai_faq').delete().eq('id', id);
    if (error) { alert('삭제하지 못했습니다: ' + dbErrorMessage(error)); return; }
    await fetchFaq();
}

// ---------------------------------------------------------------------
// 상담 기록: 손님이 AI 상담창에 한 질문·AI 답변을 날짜별로 보기 (supabase/ai_chat_logs.sql)
// ---------------------------------------------------------------------
let chatLogRows = [];

function chatLogDay(iso) {
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function chatLogSource(src) {
    if (!src) return '';
    return src.includes('bamnatdelivery.com') || src.includes('cafe24') || src.includes('dothome') ? '홈페이지' : '주문접수 사이트';
}

function onChatLogTabOpened() {
    const from = document.getElementById('chatlog-from');
    const to = document.getElementById('chatlog-to');
    if (!to.value) to.value = chatLogDay(new Date().toISOString());
    if (!from.value) from.value = chatLogDay(new Date(Date.now() - 6 * 86400000).toISOString());
    fetchChatLogs();
}

function setChatLogRange(days) {
    document.getElementById('chatlog-to').value = chatLogDay(new Date().toISOString());
    document.getElementById('chatlog-from').value = chatLogDay(new Date(Date.now() - (days - 1) * 86400000).toISOString());
    fetchChatLogs();
}

async function fetchChatLogs() {
    if (!supabaseClient || currentRole !== 'admin') return;
    const from = document.getElementById('chatlog-from').value;
    const to = document.getElementById('chatlog-to').value;
    if (!from || !to) return;
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    const list = document.getElementById('chatlog-list');
    list.innerHTML = '<div class="text-xs text-slate-400 py-6 text-center">불러오는 중…</div>';
    const { data, error } = await supabaseClient.from('ai_chat_logs').select('*')
        .gte('created_at', start.toISOString()).lt('created_at', end.toISOString())
        .order('created_at', { ascending: false }).limit(2000);
    if (error) {
        list.innerHTML = `<div class="text-rose-600 text-xs">상담 기록을 불러오지 못했습니다. ${escapeHtml(dbErrorMessage(error))}<br>(Supabase 에서 supabase/ai_chat_logs.sql 을 실행했는지 확인해 주세요)</div>`;
        return;
    }
    chatLogRows = data || [];
    renderChatLogs();
}

function renderChatLogs() {
    const onlyUnknown = document.getElementById('chatlog-filter').value === 'unknown';
    const rows = chatLogRows;
    const chats = new Set(rows.map(r => r.chat_id || `#${r.id}`));
    const unknown = rows.filter(r => r.needs_human).length;
    const home = rows.filter(r => chatLogSource(r.source) === '홈페이지').length;
    const stat = (label, value, cls = 'text-slate-900') =>
        `<div class="bg-slate-50 rounded-lg p-3"><div class="text-[11px] text-slate-500">${label}</div><div class="text-xl font-black ${cls}">${value}</div></div>`;
    document.getElementById('chatlog-summary').innerHTML =
        stat('질문 수', rows.length) + stat('상담 (대화창)', chats.size) +
        stat('AI 가 모른 질문', unknown, unknown ? 'text-orange-600' : 'text-slate-900') +
        stat('홈페이지에서 / 주문접수 사이트에서', `${home} / ${rows.length - home}`);

    // 날짜별 표
    const byDay = {};
    rows.forEach(r => {
        const d = byDay[chatLogDay(r.created_at)] ||= { q: 0, chats: new Set(), unknown: 0 };
        d.q++; d.chats.add(r.chat_id || `#${r.id}`); if (r.needs_human) d.unknown++;
    });
    const days = Object.keys(byDay).sort().reverse();
    document.getElementById('chatlog-days').innerHTML = days.length ? `
<table class="w-full text-xs">
  <thead><tr class="text-slate-500 border-b"><th class="text-left py-1.5">날짜</th><th class="text-right">질문</th><th class="text-right">상담</th><th class="text-right">AI 가 모름</th></tr></thead>
  <tbody>${days.map(d => `<tr class="border-b border-slate-100 hover:bg-indigo-50 cursor-pointer" onclick="document.getElementById('chatlog-day-${d}')?.scrollIntoView({behavior:'smooth'})">
    <td class="py-1.5 font-bold">${d.slice(5).replace('-', '/')} (${'일월화수목금토'[new Date(d + 'T00:00:00').getDay()]})</td>
    <td class="text-right">${byDay[d].q}</td><td class="text-right">${byDay[d].chats.size}</td>
    <td class="text-right ${byDay[d].unknown ? 'text-orange-600 font-bold' : 'text-slate-400'}">${byDay[d].unknown}</td></tr>`).join('')}</tbody>
</table>` : '<div class="text-xs text-slate-400 py-4 text-center">이 기간에는 기록이 없습니다.</div>';

    // 대화 목록 (날짜 → 대화창 묶음)
    const shown = onlyUnknown ? rows.filter(r => r.needs_human) : rows;
    const list = document.getElementById('chatlog-list');
    if (!shown.length) {
        list.innerHTML = `<div class="text-xs text-slate-400 py-6 text-center">${onlyUnknown ? 'AI 가 모른 질문이 없습니다.' : '이 기간에는 상담 기록이 없습니다.'}</div>`;
        return;
    }
    const groups = [];   // 날짜별, 그 안에서 대화창별
    shown.forEach(r => {
        const day = chatLogDay(r.created_at);
        let g = groups[groups.length - 1];
        if (!g || g.day !== day) groups.push(g = { day, chats: new Map() });
        const key = r.chat_id || `#${r.id}`;
        if (!g.chats.has(key)) g.chats.set(key, []);
        g.chats.get(key).push(r);
    });
    list.innerHTML = groups.map(g => `
<div id="chatlog-day-${g.day}" class="space-y-2">
  <div class="text-xs font-black text-slate-500 pt-2">${g.day.replace(/-/g, '.')} · 상담 ${g.chats.size}건</div>
  ${[...g.chats.values()].map(items => {
        items = items.slice().reverse();   // 대화 순서대로
        const first = items[0];
        return `
  <div class="border border-slate-200 rounded-xl p-3 space-y-2 bg-white">
    <div class="flex items-center gap-2 text-[11px] text-slate-400">
      <span>${inquiryTime(first.created_at)}</span>
      ${first.source ? `<span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600" title="${escapeHtml(first.source)}">${chatLogSource(first.source)}</span>` : ''}
      <span>질문 ${items.length}개</span>
    </div>
    ${items.map(r => `
    <div class="space-y-1">
      <div class="text-sm font-bold text-slate-900 whitespace-pre-wrap">🙋 ${escapeHtml(r.question)}
        ${r.needs_human ? '<span class="ml-1 px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 text-[10px] align-middle">AI 가 모름</span>' : ''}</div>
      <details class="text-xs text-slate-600"><summary class="cursor-pointer text-slate-500">🤖 ${escapeHtml((r.answer || '').slice(0, 60))}${(r.answer || '').length > 60 ? '…' : ''}</summary>
        <div class="mt-1 bg-slate-50 rounded p-2 whitespace-pre-wrap">${escapeHtml(r.answer || '')}</div></details>
    </div>`).join('')}
  </div>`;
    }).join('')}
</div>`).join('');
}

// ---------------------------------------------------------------------
// 답변하지 못한 질문: AI 가 모른 질문(needs_human)을 손님이 연락처를 남기지 않아도 모두 모아,
// 대표님이 답을 쓰면 AI 답변 모음집(ai_faq)에 바로 등록 → 다음 같은 질문엔 AI 가 답함
// 표: supabase/ai_unanswered.sql (ai_chat_logs 에 resolved_at·resolved_how·faq_id)
// ---------------------------------------------------------------------
let unansweredRows = [];
let unansweredFaq = {};
let unansweredGroups = [];
const UNANSWERED_COLS = 'id,created_at,chat_id,question,unknown_question,answer,source,resolved_at,resolved_how,faq_id';
// 손님 질문 중 AI 가 답하지 못한 부분 (없으면 손님 질문 전체)
const unknownOf = r => (r.unknown_question || '').trim() || r.question;

// 띄어쓰기·물음표 등을 빼고 같은 질문인지 비교 (SQL 의 ai_question_key 와 같은 규칙)
function questionKey(q) {
    return String(q || '').replace('[사진 1장]', '').toLowerCase().replace(/[^가-힣a-z0-9]/g, '');
}
function cleanQuestion(q) {
    return String(q || '').replace(/\n?\[사진 1장\]/g, '').trim();
}

async function fetchUnanswered() {
    if (!supabaseClient || currentRole !== 'admin') return;
    const box = document.getElementById('unanswered-list');
    box.innerHTML = '<div class="text-xs text-slate-400 py-6 text-center">불러오는 중…</div>';
    const [logs, faq] = await Promise.all([
        supabaseClient.from('ai_chat_logs').select(UNANSWERED_COLS).eq('needs_human', true)
            .order('created_at', { ascending: false }).limit(3000),
        supabaseClient.from('ai_faq').select('id,question,answer,active'),
    ]);
    if (logs.error) {
        box.innerHTML = `<div class="text-rose-600 text-xs">질문을 불러오지 못했습니다. ${escapeHtml(dbErrorMessage(logs.error))}<br>(Supabase SQL Editor 에서 supabase/ai_unanswered.sql 을 다시 실행해 주세요)</div>`;
        return;
    }
    unansweredRows = logs.data || [];
    unansweredFaq = Object.fromEntries((faq.data || []).map(f => [f.id, f]));
    // 모음집에 이미 같은 질문이 있으면 (AI 상담 탭에서 문자로 답하며 넣은 것 등) 답한 것으로 봄
    const faqByKey = {};
    (faq.data || []).filter(f => f.active).forEach(f => { faqByKey[questionKey(f.question)] = f.id; });
    const groups = new Map();
    unansweredRows.forEach(r => {
        const key = questionKey(unknownOf(r)) || `#${r.id}`;
        let g = groups.get(key);
        if (!g) groups.set(key, g = { key, rows: [], question: cleanQuestion(unknownOf(r)), originals: new Set(), photo: false });
        g.rows.push(r);
        if (cleanQuestion(r.question) !== g.question) g.originals.add(cleanQuestion(r.question));
        if (String(r.question).includes('[사진 1장]')) g.photo = true;
    });
    unansweredGroups = [...groups.values()].map(g => {
        const open = g.rows.filter(r => !r.resolved_at);
        const done = g.rows.find(r => r.resolved_at);
        const faqId = faqByKey[g.key] || (done && done.faq_id);
        g.status = open.length ? (faqByKey[g.key] ? 'faq' : 'open') : (['skip', 'ai_ok'].includes(done.resolved_how) ? done.resolved_how : 'faq');
        g.notExtracted = open.filter(r => r.unknown_question == null).length;
        g.faqId = faqId;
        g.openIds = open.map(r => r.id);
        g.last = g.rows[0].created_at;
        g.first = g.rows[g.rows.length - 1].created_at;
        return g;
    });
    // 많이 물어본 질문 → 최근 질문 순
    unansweredGroups.sort((a, b) => b.rows.length - a.rows.length || (a.last < b.last ? 1 : -1));
    renderUnanswered();
}

function renderUnanswered() {
    const filter = document.getElementById('unanswered-filter').value;
    const open = unansweredGroups.filter(g => g.status === 'open');
    setUnansweredBadge(open.length);
    document.getElementById('unanswered-count').innerText = `답변 기다림 ${open.length}개`;
    const shown = unansweredGroups.filter(g => g.status === filter);
    const box = document.getElementById('unanswered-list');
    // 예전 기록(질문 전체만 있음) → AI 로 '답하지 못한 부분'만 뽑기 버튼
    const raw = open.reduce((n, g) => n + g.notExtracted, 0);
    const bar = document.getElementById('unanswered-extract');
    bar.classList.toggle('hidden', !raw);
    document.getElementById('unanswered-extract-count').innerText = raw;
    if (!shown.length) {
        box.innerHTML = `<div class="text-xs text-slate-400 py-8 text-center">${filter === 'open' ? '🎉 AI 가 답하지 못한 질문이 없습니다.' : '해당하는 질문이 없습니다.'}</div>`;
        return;
    }
    box.innerHTML = shown.map((g, i) => {
        const idx = unansweredGroups.indexOf(g);
        const sources = [...new Set(g.rows.map(r => chatLogSource(r.source)).filter(Boolean))];
        const faq = unansweredFaq[g.faqId];
        return `
<div class="border ${g.status === 'open' ? 'border-orange-200' : 'border-slate-200'} rounded-xl p-4 space-y-2 bg-white" data-unanswered="${idx}">
  <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
    <span class="px-2 py-0.5 rounded font-bold ${g.rows.length > 1 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'}">${g.rows.length}번 물어봄</span>
    <span>${g.rows.length > 1 ? `처음 ${inquiryTime(g.first)} · ` : ''}마지막 ${inquiryTime(g.last)}</span>
    ${sources.map(s => `<span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">${s}</span>`).join('')}
    ${g.photo ? '<span class="px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">📷 사진 질문</span>' : ''}
  </div>
  <div class="text-sm font-bold text-slate-900 whitespace-pre-wrap">🙋 ${escapeHtml(g.question)}</div>
  ${g.originals.size ? `<div class="text-[11px] text-slate-400 whitespace-pre-wrap">손님 원래 질문: ${[...g.originals].slice(0, 3).map(escapeHtml).join(' / ')}${g.originals.size > 3 ? ` 외 ${g.originals.size - 3}개` : ''}</div>` : ''}
  ${g.notExtracted ? '<div class="text-[11px] text-amber-600">아직 정리 전인 예전 질문이라 손님 질문 전체가 보입니다. 위 [AI 로 모르는 부분만 뽑기]를 눌러 주세요.</div>' : ''}
  <details class="text-xs text-slate-600"><summary class="cursor-pointer text-slate-500">AI 가 했던 답 · 앞뒤 대화 보기</summary>
    <div class="mt-1 space-y-1 bg-slate-50 rounded p-2 whitespace-pre-wrap" data-context="${idx}">${escapeHtml(g.rows[0].answer || '')}
<button onclick="loadUnansweredContext(${idx})" class="mt-1 text-indigo-600 font-bold">앞뒤 대화 불러오기</button></div></details>
  ${g.status === 'open' ? `
  <div class="bg-indigo-50 rounded-lg p-3 space-y-1.5">
    <label class="block text-[11px] text-slate-500">모음집에 넣을 질문 (손님 이름·번호는 빼고 고쳐도 됩니다)</label>
    <input class="un-q w-full border border-slate-200 rounded p-2 text-xs bg-white" value="${escapeHtml(g.question)}">
    <textarea class="un-a w-full border border-slate-300 rounded p-2 text-sm bg-white" rows="3" placeholder="대표님 답변 (모든 손님에게 보일 수 있으니 개인정보는 넣지 마세요)"></textarea>
    <div class="flex gap-2 justify-end">
      <button onclick="skipUnanswered(${idx})" class="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-lg">답 필요 없음</button>
      <button onclick="saveUnanswered(${idx}, this)" class="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg">답변 등록 (AI 가 다음부터 이 답으로 안내)</button>
    </div>
  </div>` : g.status === 'faq' ? `
  <div class="text-xs bg-emerald-50 rounded p-2 whitespace-pre-wrap"><b class="text-emerald-700">✓ 모음집에 등록된 답:</b> ${faq ? escapeHtml(faq.answer) : '(모음집에서 지웠거나 찾을 수 없음)'}</div>` : `
  <div class="flex justify-between items-center text-xs text-slate-400">${g.status === 'ai_ok' ? '다시 살펴보니 AI 가 이미 답했던 질문이라 목록에서 뺐습니다.' : '답 필요 없음으로 숨긴 질문입니다.'}
    <button onclick="reopenUnanswered(${idx})" class="px-2 py-1 border border-slate-200 rounded font-bold text-slate-600">다시 답변 기다림으로</button></div>`}
</div>`;
    }).join('');
}

function setUnansweredBadge(n) {
    const b = document.getElementById('admin-unanswered-badge');
    if (!b) return;
    b.innerText = n;
    b.classList.toggle('hidden', !n);
}

// 관리자 화면에 들어왔을 때 탭 옆 숫자만 미리 채움
async function refreshUnansweredBadge() {
    if (!supabaseClient || currentRole !== 'admin') return;
    const [logs, faq] = await Promise.all([
        supabaseClient.from('ai_chat_logs').select('question,unknown_question').eq('needs_human', true).is('resolved_at', null).limit(3000),
        supabaseClient.from('ai_faq').select('question').eq('active', true),
    ]);
    if (logs.error) return;
    const known = new Set((faq.data || []).map(f => questionKey(f.question)));
    setUnansweredBadge(new Set((logs.data || []).map(r => questionKey(unknownOf(r))).filter(k => !known.has(k))).size);
}

// 그 질문을 한 대화창(chat_id)의 다른 질문·답을 함께 보여 줌 (무슨 상황에서 물었는지)
async function loadUnansweredContext(idx) {
    const g = unansweredGroups[idx];
    const box = document.querySelector(`[data-context="${idx}"]`);
    const chatIds = [...new Set(g.rows.map(r => r.chat_id).filter(Boolean))].slice(0, 5);
    if (!chatIds.length) { box.innerHTML = escapeHtml(g.rows[0].answer || '') + '<div class="text-slate-400 mt-1">앞뒤 대화 기록이 없습니다.</div>'; return; }
    const { data, error } = await supabaseClient.from('ai_chat_logs').select('chat_id,created_at,question,answer')
        .in('chat_id', chatIds).order('created_at', { ascending: true }).limit(100);
    if (error) { alert('불러오지 못했습니다: ' + dbErrorMessage(error)); return; }
    const byChat = {};
    (data || []).forEach(r => (byChat[r.chat_id] ||= []).push(r));
    box.innerHTML = Object.values(byChat).map(items => `<div class="border-b border-slate-200 pb-1 mb-1 last:border-0">
      <div class="text-[10px] text-slate-400">${inquiryTime(items[0].created_at)} 대화</div>
      ${items.map(r => `<div class="${g.rows.some(x => x.question === r.question) ? 'bg-orange-50 rounded px-1' : ''}"><b>손님:</b> ${escapeHtml(r.question)}</div>
      <div class="text-slate-500"><b>AI:</b> ${escapeHtml(r.answer || '')}</div>`).join('')}</div>`).join('');
}

async function markUnanswered(ids, values) {
    const { error } = await supabaseClient.from('ai_chat_logs').update(values).in('id', ids);
    return error;
}

async function saveUnanswered(idx, btn) {
    const g = unansweredGroups[idx];
    const card = document.querySelector(`[data-unanswered="${idx}"]`);
    const question = card.querySelector('.un-q').value.trim();
    const answer = card.querySelector('.un-a').value.trim();
    if (!question || !answer) { alert('질문과 답변을 모두 적어 주세요.'); return; }
    btn.disabled = true;
    btn.textContent = '등록하는 중…';
    const { data, error } = await supabaseClient.from('ai_faq').insert({ question, answer, active: true }).select('id').single();
    if (error) {
        alert('모음집에 등록하지 못했습니다: ' + dbErrorMessage(error));
        btn.disabled = false; btn.textContent = '답변 등록 (AI 가 다음부터 이 답으로 안내)';
        return;
    }
    // 고쳐 쓴 질문과 같은 다른 질문들도 함께 정리
    const qKey = questionKey(question);
    const ids = unansweredGroups.filter(x => x.status === 'open' && (x === g || x.key === qKey)).flatMap(x => x.openIds);
    const err = await markUnanswered(ids, { resolved_at: new Date().toISOString(), resolved_how: 'faq', faq_id: data.id });
    if (err) alert('모음집에는 등록했지만 질문 정리 표시를 못 했습니다: ' + dbErrorMessage(err));
    await fetchUnanswered();
}

async function skipUnanswered(idx) {
    const g = unansweredGroups[idx];
    if (!confirm('이 질문은 답을 등록하지 않고 목록에서 숨길까요?\n(장난·인사말이나 개별 주문 확인처럼 AI 가 답하면 안 되는 질문)')) return;
    const err = await markUnanswered(g.openIds, { resolved_at: new Date().toISOString(), resolved_how: 'skip', faq_id: null });
    if (err) alert('저장하지 못했습니다: ' + dbErrorMessage(err));
    await fetchUnanswered();
}

async function reopenUnanswered(idx) {
    const g = unansweredGroups[idx];
    const err = await markUnanswered(g.rows.map(r => r.id), { resolved_at: null, resolved_how: null, faq_id: null });
    if (err) alert('저장하지 못했습니다: ' + dbErrorMessage(err));
    await fetchUnanswered();
}

// 예전 '모름' 기록을 AI 가 다시 읽고, 답하지 못한 부분만 한 문장으로 뽑음 (worker/ask.js handleUnknownExtract, 40개씩 반복)
async function extractUnknownParts(btn) {
    if (!confirm('지난 질문을 AI 가 다시 읽고, AI 가 답하지 못한 부분만 질문으로 정리합니다.\n사실은 AI 가 답했던 질문은 목록에서 빠집니다.\n(AI 사용료가 조금 듭니다. 40개에 약 50~100원)')) return;
    btn.disabled = true;
    const label = btn.textContent;
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) throw new Error('로그인이 필요합니다. 다시 로그인해 주세요.');
        let total = 0, ok = 0;
        for (let i = 0; i < 50; i++) {
            btn.textContent = `정리하는 중… (${total}개 완료)`;
            const res = await fetch('/api/ask/unknown', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `서버 오류 (HTTP ${res.status})`);
            total += data.done || 0; ok += data.aiAnswered || 0;
            if (!data.left || !data.done) break;
        }
        alert(`${total}개를 정리했습니다.${ok ? `\n그중 ${ok}개는 AI 가 사실 답했던 질문이라 목록에서 뺐습니다.` : ''}`);
    } catch (e) {
        alert('정리하지 못했습니다: ' + e.message);
    }
    btn.disabled = false;
    btn.textContent = label;
    await fetchUnanswered();
}
