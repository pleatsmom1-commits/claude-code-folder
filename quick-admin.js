// =====================================================================
// 관리자 > 사입 픽업요청 탭 맨 위 '비회원 간단 접수'
//  - 회원가입 없이 /quick 화면(quick.html)에서 들어온 첫 주문을 보고 [접수완료] / [취소] 처리합니다.
//  - 같은 번호로 두 번째 이상 들어오면 'N번째 이용' 표시 → SO솔루션 가입 안내를 잊지 않게.
//  - [복사]: 카톡·SO솔루션에 붙여넣기 좋은 글로 복사합니다.
//  표: supabase/quick_orders.sql
//  index.html 의 supabaseClient, currentRole, escapeHtml, dbErrorMessage 를 사용합니다.
// =====================================================================

let quickOrderRows = [];
let quickPhoneCounts = {};

const QUICK_STATUS = {
    waiting: ['확인대기', 'bg-orange-100 text-orange-700'],
    done: ['접수완료', 'bg-emerald-100 text-emerald-700'],
    canceled: ['취소', 'bg-slate-100 text-slate-500'],
};

async function fetchQuickOrders() {
    const box = document.getElementById('quick-order-list');
    if (!box || !supabaseClient || currentRole !== 'admin') return;
    const filter = document.getElementById('quick-status-filter').value;
    let q = supabaseClient.from('quick_orders').select('*').order('created_at', { ascending: false }).limit(100);
    if (filter !== 'all') q = q.eq('status', filter);
    const { data, error } = await q;
    if (error) {
        box.innerHTML = `<div class="text-rose-600 text-xs">불러오지 못했습니다. ${escapeHtml(dbErrorMessage(error))}<br>(Supabase 에서 supabase/quick_orders.sql 을 실행했는지 확인해 주세요)</div>`;
        return;
    }
    quickOrderRows = data || [];
    // 번호별 전체 이용 횟수 (몇 번째 이용인지)
    const phones = [...new Set(quickOrderRows.map(r => r.phone))];
    quickPhoneCounts = {};
    if (phones.length) {
        const { data: all } = await supabaseClient.from('quick_orders').select('id,phone,created_at').in('phone', phones).order('created_at');
        (all || []).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
            .forEach(r => { (quickPhoneCounts[r.phone] = quickPhoneCounts[r.phone] || []).push(r.id); });
    }
    renderQuickOrders();
}

function quickNth(r) {
    const list = quickPhoneCounts[r.phone] || [];
    const i = list.indexOf(r.id);
    return i >= 0 ? i + 1 : 1;
}

function quickOrderText(r) {
    const stores = (r.stores || []).map((x, i) => `${i + 1}) ${x.mall} ${x.floor} ${x.store} (${x.phone})`).join('\n');
    const recs = (r.recipients || []).map((x, i) => [
        `${i + 1}) ${x.name} / ${x.phone}`, `   ${x.address}`,
        x.product ? `   상품: ${x.product}` : '', x.message ? `   배송메세지: ${x.message}` : '',
    ].filter(Boolean).join('\n')).join('\n');
    return [
        `[비회원 간단 접수] ${inquiryTime(r.created_at)}`,
        `주문자: ${r.company} / ${inquiryPhone(r.phone)}`,
        `대납: ${r.prepay ? '대납하고 픽업' : '대납없이 픽업'} / 대납미송: ${r.prepay_misong ? '잡음' : '안 잡음'}`,
        '', '■ 픽업할 매장', stores,
        '', `■ 받으실 분 (${r.ship_to === 'customer' ? '고객에게 바로 · 풀필먼트' : '내 매장·사무실로'})`, recs,
        r.memo ? `\n■ 요청사항\n${r.memo}` : '',
    ].join('\n').trim();
}

function renderQuickOrders() {
    const box = document.getElementById('quick-order-list');
    const badge = document.getElementById('quick-order-count');
    const waiting = quickOrderRows.filter(r => r.status === 'waiting').length;
    if (badge) { badge.innerText = waiting ? `확인대기 ${waiting}` : ''; badge.classList.toggle('hidden', !waiting); }
    if (!quickOrderRows.length) {
        box.innerHTML = '<div class="text-xs text-slate-400 py-4 text-center">들어온 간단 접수가 없습니다.</div>';
        return;
    }
    box.innerHTML = quickOrderRows.map(r => {
        const [label, cls] = QUICK_STATUS[r.status] || [r.status, ''];
        const nth = quickNth(r);
        const stores = (r.stores || []).map(x => `<li><b>${escapeHtml(x.mall)}</b> ${escapeHtml(x.floor)} <b>${escapeHtml(x.store)}</b> <a class="text-indigo-600" href="tel:${escapeHtml(x.phone)}">${escapeHtml(x.phone)}</a></li>`).join('');
        const recs = (r.recipients || []).map(x => `<li><b>${escapeHtml(x.name)}</b> ${escapeHtml(x.phone)} · ${escapeHtml(x.address)}${x.product ? `<br><span class="text-slate-500">상품: ${escapeHtml(x.product)}</span>` : ''}${x.message ? `<br><span class="text-slate-500">배송메세지: ${escapeHtml(x.message)}</span>` : ''}</li>`).join('');
        return `
<div class="border border-slate-200 rounded-xl p-4 space-y-2 bg-white text-xs" data-quick="${r.id}">
  <div class="flex flex-wrap items-center gap-2">
    <span class="px-2 py-0.5 rounded font-bold ${cls}">${escapeHtml(label)}</span>
    ${nth > 1 ? `<span class="px-2 py-0.5 rounded font-bold bg-indigo-100 text-indigo-700" title="같은 번호로 ${nth}번째 접수예요. SO솔루션 가입 안내를 해주세요.">${nth}번째 이용 · SO솔루션 안내</span>` : '<span class="px-2 py-0.5 rounded font-bold bg-sky-100 text-sky-700">첫 이용</span>'}
    <span class="text-slate-400">${inquiryTime(r.created_at)}</span>
    <b class="text-slate-900 text-sm">${escapeHtml(r.company)}</b>
    <a href="tel:${escapeHtml(r.phone)}" class="text-indigo-600 font-bold">${escapeHtml(inquiryPhone(r.phone))}</a>
    <span class="${r.prepay || r.prepay_misong ? 'text-rose-600 font-bold' : 'text-slate-500'}">${r.prepay ? '대납' : '대납없음'}${r.prepay_misong ? ' · 대납미송' : ''}</span>
    <span class="text-slate-500">${r.ship_to === 'customer' ? '📦 고객에게 바로' : '🏬 내 매장·사무실'}</span>
  </div>
  <div class="grid md:grid-cols-2 gap-2">
    <div class="bg-slate-50 rounded p-2"><div class="font-bold text-slate-600 mb-1">픽업할 매장</div><ul class="space-y-0.5">${stores}</ul></div>
    <div class="bg-slate-50 rounded p-2"><div class="font-bold text-slate-600 mb-1">받으실 분 ${(r.recipients || []).length}명</div><ul class="space-y-1">${recs}</ul></div>
  </div>
  ${r.memo ? `<div class="bg-amber-50 rounded p-2 whitespace-pre-wrap"><b>요청사항:</b> ${escapeHtml(r.memo)}</div>` : ''}
  <div class="flex flex-wrap gap-2 justify-end items-center">
    ${r.handled_at ? `<span class="text-slate-400 mr-auto">처리: ${inquiryTime(r.handled_at)}</span>` : ''}
    <button onclick="copyQuickOrder(${r.id})" class="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold rounded-lg">📋 복사</button>
    ${r.status === 'waiting' ? `
    <button onclick="setQuickOrderStatus(${r.id}, 'canceled')" class="px-3 py-1.5 bg-white border border-slate-200 text-slate-500 font-bold rounded-lg">취소</button>
    <button onclick="setQuickOrderStatus(${r.id}, 'done')" class="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg">접수완료</button>` : `
    <button onclick="setQuickOrderStatus(${r.id}, 'waiting')" class="px-3 py-1.5 bg-white border border-slate-200 text-slate-500 font-bold rounded-lg">확인대기로 되돌리기</button>`}
  </div>
</div>`;
    }).join('');
}

async function copyQuickOrder(id) {
    const r = quickOrderRows.find(x => x.id === id);
    if (!r) return;
    try { await navigator.clipboard.writeText(quickOrderText(r)); alert('복사했습니다. 카톡이나 SO솔루션에 붙여넣으세요.'); }
    catch { prompt('아래 글을 복사해 주세요.', quickOrderText(r)); }
}

async function setQuickOrderStatus(id, status) {
    const msg = { done: '접수완료로 바꿀까요?', canceled: '이 접수를 취소할까요?', waiting: '확인대기로 되돌릴까요?' }[status];
    if (!confirm(msg)) return;
    const { error } = await supabaseClient.from('quick_orders')
        .update({ status, handled_at: status === 'waiting' ? null : new Date().toISOString() }).eq('id', id);
    if (error) alert('저장하지 못했습니다: ' + dbErrorMessage(error));
    await fetchQuickOrders();
}
