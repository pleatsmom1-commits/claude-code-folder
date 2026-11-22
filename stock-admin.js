// =====================================================================
// 관리자 > 재고/상품/출고관리 > [셀러 재고 공개]
//  - 셀러에게 재고 숨기기 (전체 / 업체별)
//  예전 보관 목록(stock_items, 통합본 엑셀 올리기·출고처리)은 2026-11-22 없앴습니다.
//  재고는 [재고표](inventory.html) 하나로 관리자·셀러가 같은 숫자를 봅니다.
//  index.html 의 supabaseClient, currentRole, escapeHtml, fetchAllRows, dbErrorMessage 를 사용합니다.
// =====================================================================

let stockSellerCompanies = new Map(); // norm(상호) → 회원가입 상호 (승인된 셀러)
let stockLoadedTab = false;

function stockNorm(value) {
    return String(value ?? '').replace(/\s+/g, '').toLowerCase();
}

function onStockTabOpened() {
    if (stockLoadedTab) return;
    stockLoadedTab = true;
    fetchStockSellers();
}

async function fetchStockSellers() {
    if (!supabaseClient || currentRole !== 'admin') return;
    const sellers = await fetchAllRows(() => supabaseClient.from('profiles').select('company,status').eq('status', 'approved'));
    stockSellerCompanies = new Map((sellers.data || []).map(p => [stockNorm(p.company), p.company]));
    fetchStockHide();
}

// ---------------------------------------------------------------------
// 0. 셀러에게 재고 숨기기 (supabase/stock_hide.sql)
//    전체 셀러 숨기기 체크 + 업체명 조회해서 그 업체만 숨기기/보이기.
//    업체별 설정은 "전체 설정과 다르게 하는 예외"로 저장됩니다.
// ---------------------------------------------------------------------
let stockHideRows = null;            // stock_visibility 줄들 (null = 아직 못 불러옴)
let stockHideError = '';
let stockHideCompanies = new Map();  // norm(상호) → 상호 (재고관리·재고표·승인 셀러 상호 모두)

async function fetchStockHide() {
    const [vis, prods] = await Promise.all([
        fetchAllRows(() => supabaseClient.from('stock_visibility').select('*').order('company_key')),
        fetchAllRows(() => supabaseClient.from('products').select('company').is('deleted_at', null).order('id')),
    ]);
    stockHideError = vis.error ? dbErrorMessage(vis.error) : '';
    stockHideRows = vis.error ? null : vis.data;
    const names = new Map();
    const add = c => { const k = stockNorm(c); if (k && !names.has(k)) names.set(k, String(c).trim()); };
    (prods.data || []).forEach(r => add(r.company));
    stockSellerCompanies.forEach(c => add(c));
    (stockHideRows || []).filter(r => r.company_key !== '*').forEach(r => add(r.company));
    stockHideCompanies = names;
    renderStockHide();
}

function stockHideAllOn() {
    const all = (stockHideRows || []).find(r => r.company_key === '*');
    return !!(all && all.hidden);
}

function stockHideExceptions() {
    return (stockHideRows || []).filter(r => r.company_key !== '*');
}

function stockHiddenFor(company) {
    const row = stockHideExceptions().find(r => r.company_key === stockNorm(company));
    return row ? !!row.hidden : stockHideAllOn();
}

function renderStockHide() {
    const status = document.getElementById('stock-hide-status');
    const box = document.getElementById('stock-hide-all');
    const list = document.getElementById('stock-hide-list');
    if (!status) return;
    if (stockHideRows === null) {
        box.disabled = true;
        status.className = 'text-xs font-bold px-3 py-1.5 rounded-full bg-amber-50 text-amber-700';
        status.textContent = 'DB 설정 필요';
        list.innerHTML = `<div class="p-3 bg-amber-50 text-amber-800 rounded-lg">숨기기 설정을 불러오지 못했습니다. Supabase SQL Editor에서 <b>supabase/stock_hide.sql</b> 을 실행해주세요.<br><span class="text-[11px] text-amber-600">${escapeHtml(stockHideError)}</span></div>`;
        return;
    }
    box.disabled = false;
    const allOn = stockHideAllOn();
    const ex = stockHideExceptions();
    box.checked = allOn;
    status.className = 'text-xs font-bold px-3 py-1.5 rounded-full ' + (allOn ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700');
    status.textContent = allOn
        ? `지금: 모든 셀러 숨김${ex.length ? ` · 보이게 한 업체 ${ex.length}곳` : ''}`
        : `지금: 셀러에게 보임${ex.length ? ` · 숨긴 업체 ${ex.length}곳` : ''}`;

    const q = stockNorm(document.getElementById('stock-hide-q').value);
    let rows, title;
    if (q) {
        rows = [...stockHideCompanies.entries()].filter(([k]) => k.includes(q))
            .sort((a, b) => a[1].localeCompare(b[1], 'ko')).slice(0, 30).map(([, c]) => c);
        title = rows.length ? `조회 결과 ${rows.length}곳${rows.length === 30 ? ' (앞 30곳만 표시)' : ''}` : '';
        if (!rows.length) {
            list.innerHTML = `<div class="p-3 bg-slate-50 rounded-lg text-slate-500">'${escapeHtml(document.getElementById('stock-hide-q').value)}' 업체를 찾지 못했습니다. 그래도 이 이름으로 설정하려면 → `
                + `<button type="button" data-company="${escapeHtml(document.getElementById('stock-hide-q').value.trim())}" onclick="setStockCompanyHidden(this.dataset.company, ${!allOn})" class="ml-1 px-2 py-1 rounded font-bold ${allOn ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}">${allOn ? '이 업체만 보이기' : '이 업체만 숨기기'}</button></div>`;
            return;
        }
    } else {
        rows = ex.map(r => r.company || r.company_key);
        title = rows.length ? (allOn ? '따로 보이게 한 업체' : '따로 숨긴 업체') : '';
        if (!rows.length) {
            list.innerHTML = `<div class="text-slate-400">업체명을 조회하면 그 업체만 ${allOn ? '보이게' : '숨기게'} 할 수 있습니다.</div>`;
            return;
        }
    }
    list.innerHTML = `<div class="font-bold text-slate-600 mb-1">${title}</div>
        <div class="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-64 overflow-auto">${rows.map(c => {
            const hidden = stockHiddenFor(c);
            const own = ex.some(r => r.company_key === stockNorm(c));
            const member = stockSellerCompanies.has(stockNorm(c));
            return `<div class="flex items-center gap-3 px-3 py-2 hover:bg-slate-50">
                <span class="font-bold text-slate-800 flex-1 min-w-0 truncate">${escapeHtml(c)}</span>
                ${member ? '<span class="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[10px] font-bold">회원</span>' : '<span class="px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-bold" title="같은 상호로 가입한 셀러가 아직 없습니다">미가입</span>'}
                <span class="w-24 text-right font-bold ${hidden ? 'text-rose-600' : 'text-emerald-600'}">${hidden ? '셀러에게 숨김' : '셀러에게 보임'}</span>
                <button type="button" data-company="${escapeHtml(c)}" onclick="setStockCompanyHidden(this.dataset.company, ${!hidden})"
                    class="w-20 px-2 py-1 rounded-lg font-bold ${hidden ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-rose-600 hover:bg-rose-700 text-white'}">${hidden ? '보이기' : '숨기기'}</button>
                ${own ? `<span class="w-14 text-[10px] text-slate-400">따로 정함</span>` : '<span class="w-14"></span>'}
            </div>`;
        }).join('')}</div>`;
}

async function toggleStockHideAll(el) {
    const on = el.checked;
    const ex = stockHideExceptions().length;
    const msg = (on
        ? '모든 셀러에게 재고를 숨길까요?\n\n재고는 지워지지 않고, 관리자 화면에는 그대로 보입니다.'
        : '모든 셀러에게 재고를 다시 보이게 할까요?\n\n회원가입 상호와 같은 업체는 로그인하면 자기 재고를 봅니다.')
        + (ex ? `\n\n※ 업체별로 따로 정한 ${ex}곳의 설정은 지워지고 모두 같게 맞춰집니다.` : '');
    if (!confirm(msg)) { el.checked = !on; return; }
    const { error } = await supabaseClient.rpc('stock_set_hide_all', { p_hidden: on });
    if (error) { el.checked = !on; alert('바꾸지 못했습니다.\n\n' + dbErrorMessage(error) + '\n\n(Supabase에서 supabase/stock_hide.sql 을 실행했는지 확인해주세요)'); return; }
    await fetchStockHide();
}

async function setStockCompanyHidden(company, hidden) {
    if (!company) return;
    const { error } = await supabaseClient.rpc('stock_set_company_hidden', { p_company: company, p_hidden: hidden });
    if (error) { alert('바꾸지 못했습니다.\n\n' + dbErrorMessage(error) + '\n\n(Supabase에서 supabase/stock_hide.sql 을 실행했는지 확인해주세요)'); return; }
    await fetchStockHide();
}
