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
        return `
<div class="border border-slate-200 rounded-xl p-4 space-y-2 bg-white" data-inquiry="${r.id}">
  <div class="flex flex-wrap items-center gap-2 text-xs">
    <span class="px-2 py-0.5 rounded font-bold ${cls}">${escapeHtml(label)}</span>
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
  <label class="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" class="inq-faq" checked> AI 답변 모음집에도 추가 (다음부터 AI 가 이 답을 참고)</label>
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
}

async function deleteFaq(id) {
    if (!confirm('이 답변을 모음집에서 지울까요?')) return;
    const { error } = await supabaseClient.from('ai_faq').delete().eq('id', id);
    if (error) { alert('삭제하지 못했습니다: ' + dbErrorMessage(error)); return; }
    await fetchFaq();
}
