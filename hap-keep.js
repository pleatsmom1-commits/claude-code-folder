// =====================================================================
// (합) 합배송 · (킵) 재고에서 출고 표시 (2026-11-20 대표님 요청)
//  - 셀러가 상품명에 (합)/(킵)을 이미 적었으면 그대로 둡니다. (두 번 붙이지 않음)
//  - (킵): 맡긴 재고(상품화 재고)가 있는 상품은 접수할 때 저절로 (킵)이 붙습니다.
//          재고가 모자라면 위쪽 줄(먼저 적은 주문)부터 재고를 씁니다.
//          아직 출고 안 된 내 (킵) 주문이 잡아 둔 수량은 빼고 계산합니다.
//  - (합): 같은 받는분(이름·연락처·주소) 주문이 2건 이상인데 (합)이 없을 때만 체크칸으로 물어봅니다.
//  쓰는 곳: 우리 양식 엑셀 올리기(확인표), 쇼핑몰 주문서 그대로 올리기(order-ai.js), 단건 접수
//  order-ai.js 의 aiOrder.products / aiOrder.stock / aiMatch / aiNorm / aiEsc 를 같이 씁니다.
// =====================================================================
const HK_HAP = /\(합\)/;
const HK_KEEP = /\(킵\)/;
const hkStrip = s => String(s || '').replace(/\((합|킵)\)/g, '').trim();
// 상품명 앞에 표시 붙이기: 이미 있으면 그대로. 둘 다 붙이면 (합)(킵)상품명
function hkMark(text, hap, keep) {
    const t = String(text || '').trim();
    const lead = t.match(/^((?:\((?:합|킵)\))*)/)[1];
    const rest = t.slice(lead.length);
    const h = (hap || HK_HAP.test(lead)) && !HK_HAP.test(rest);
    const k = (keep || HK_KEEP.test(lead)) && !HK_KEEP.test(rest);
    return (h ? '(합)' : '') + (k ? '(킵)' : '') + rest;
}
// 도매거래처명에 '킵건'이라고 적은 주문도 셀러가 재고 출고를 적은 것으로 봅니다.
const hkSellerKeep = (product, wholesaleCompany) => HK_KEEP.test(product || '') || /킵건/.test(wholesaleCompany || '');

async function hkEnsureProducts() {
    if (aiOrder.products === null || !aiOrder.products) await aiLoadProducts();
}

// 주문 상품명 → 우리 상품관리 상품 (쇼핑몰상품명 → 도매처·도매상품명 순서)
function hkMatch(product, wholesaleCompany, wholesaleProduct) {
    const m = aiMatch({ mallProduct: hkStrip(product), option: '' });
    if (m) return m;
    if (!wholesaleProduct) return null;
    const list = (aiOrder.products || []).filter(p => aiNorm(p.wholesale_product) === aiNorm(wholesaleProduct)
        && (!wholesaleCompany || aiNorm(p.wholesale_company) === aiNorm(wholesaleCompany)));
    return list.length === 1 ? list[0] : null;
}

// 지금 쓸 수 있는 재고 = 상품화 재고 - 아직 출고 안 된 내 (킵) 주문 수량
function hkAvailMap() {
    const avail = new Map(aiOrder.stock || []);
    (typeof ordersMaster !== 'undefined' ? ordersMaster : []).forEach(o => {
        if (o.seller_id !== currentUserId || (o.order_type || 'fulfillment') !== 'fulfillment') return;
        if ((o.ship_status || '미출고') !== '미출고' || !HK_KEEP.test(o.product || '')) return;
        const p = hkMatch(o.product, o.wholesale_company, o.wholesale_product);
        if (p && avail.has(p.id)) avail.set(p.id, Math.max(0, avail.get(p.id) - (Number(o.qty) || 1)));
    });
    return avail;
}

// 줄마다 재고 배정. rows: [{ product, wholesaleCompany, wholesaleProduct, qty, keepOff }]
//  결과(줄에 씀): hkProduct(상품명), hkStock(남은 재고), hkKeep('seller'|'auto'|''), hkShort(모자란 수량), hkUsedUp(위 줄이 다 씀)
function hkAllocate(rows) {
    const avail = hkAvailMap();
    rows.forEach(r => {
        const qty = Math.max(1, Number(r.qty) || 1);
        // 쇼핑몰 주문서 올리기 줄은 이미 찾아 둔 상품(match)을 그대로 씀
        const p = r.match !== undefined ? r.match : hkMatch(r.product, r.wholesaleCompany, r.wholesaleProduct);
        r.hkProduct = p;
        r.hkStock = p ? (aiOrder.stock.get(p.id) || 0) : null;
        r.hkShort = 0; r.hkUsedUp = false;
        const left = p ? (avail.get(p.id) || 0) : 0;
        r.hkLeft = left;
        if (hkSellerKeep(r.product, r.wholesaleCompany)) {
            r.hkKeep = 'seller';
        } else if (p && left > 0 && !r.keepOff) {
            r.hkKeep = 'auto';
            r.hkShort = Math.max(0, qty - left);
        } else {
            r.hkKeep = '';
            r.hkUsedUp = !!(p && r.hkStock > 0 && left <= 0);
        }
        if (p && r.hkKeep) avail.set(p.id, Math.max(0, left - qty));
    });
    return rows;
}

// 같은 받는분 묶음. rows: [{ recipient, phone, address, product }] → r.hkGroup, r.hkGroupSize, r.hkSellerHap
function hkGroups(rows) {
    const key = r => aiNorm(r.recipient) + '|' + aiNorm(String(r.phone || '').replace(/\D/g, '')) + '|' + aiNorm(r.address);
    const count = new Map();
    rows.forEach(r => count.set(key(r), (count.get(key(r)) || 0) + 1));
    rows.forEach(r => {
        r.hkGroup = key(r);
        r.hkGroupSize = count.get(r.hkGroup);
        r.hkSellerHap = HK_HAP.test(r.product || '');
    });
    // 같은 받는분 중 한 줄이라도 셀러가 (합)을 적었으면 나머지 줄도 처음엔 체크해 둡니다.
    rows.forEach(r => {
        if (r.hap === undefined) r.hap = r.hkSellerHap || rows.some(x => x.hkGroup === r.hkGroup && x.hkSellerHap);
    });
    return rows;
}

const hkKeepCell = (r, onchange) => {
    if (r.hkKeep === 'seller') return '<span class="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 text-[11px] font-bold whitespace-nowrap">셀러가 적음 · 그대로</span>';
    if (!r.hkProduct) return '<span class="text-slate-400 whitespace-nowrap">상품관리에 없음</span>';
    if (r.hkStock <= 0) return '<span class="text-slate-400">재고 없음</span>';
    if (r.hkUsedUp) return `<span class="text-slate-500">재고 ${r.hkStock}개는 먼저 적은 줄·먼저 접수한 (킵) 주문이 써요 → 사입</span>`;
    const stockTxt = r.hkLeft < r.hkStock ? `남은 재고 ${r.hkLeft}` : `재고 ${r.hkStock}`;
    const box = `<label class="inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"><input type="checkbox" ${r.hkKeep ? 'checked' : ''} onchange="${onchange}" class="w-4 h-4"> <span class="text-emerald-700 font-bold">${stockTxt}</span>${r.hkKeep === 'auto' ? ' <span class="px-1 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold">자동</span>' : ''}</label>`;
    if (r.hkShort) return `${box}<div class="text-[11px] text-amber-700 font-bold">재고가 모자라요 → 모자란 ${r.hkShort}개는 사입해서 함께 출고</div>`;
    return box;
};
const hkHapCell = (r, onchange) => {
    if (r.hkSellerHap) return '<span class="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 text-[11px] font-bold whitespace-nowrap">셀러가 적음 · 그대로</span>';
    if (r.hkGroupSize < 2) return '<span class="text-slate-300">-</span>';
    return `<label class="inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"><input type="checkbox" ${r.hap ? 'checked' : ''} onchange="${onchange}" class="w-4 h-4"> (합)</label>`
        + `<div class="text-[11px] ${r.hap ? 'text-slate-400' : 'text-amber-700 font-bold'}">같은 받는분 ${r.hkGroupSize}건${r.hap ? '' : ' · (합)이 없어요. 모아서 보낼까요?'}</div>`;
};
const hkBadges = text => {
    const t = String(text || '');
    const m = t.match(/^((?:\((?:합|킵)\))+)/);
    if (!m) return aiEsc(t);
    const tags = m[1].match(/\((합|킵)\)/g).map(x => `<span class="px-1 rounded font-bold ${x === '(합)' ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-800'}">${x}</span>`).join('');
    return tags + ' ' + aiEsc(t.slice(m[1].length));
};

// ---------------------------------------------------------------------
// 우리 양식 엑셀 올리기: 접수 전 확인표. 확인하면 batch 의 product 를 고쳐서 true
// ---------------------------------------------------------------------
let hkExcel = null;
async function hkExcelConfirm(batch, excelRows) {
    await hkEnsureProducts();
    const rows = batch.map((o, i) => ({ o, excelRow: excelRows[i], recipient: o.recipient, phone: o.phone, address: o.address,
        product: o.product, wholesaleCompany: o.wholesale_company, wholesaleProduct: o.wholesale_product, qty: o.qty }));
    hkGroups(rows);
    hkExcel = { rows, resolve: null };
    let modal = document.getElementById('hk-excel-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'hk-excel-modal';
        modal.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm hidden items-center justify-center p-4 z-50';
        document.body.appendChild(modal);
    }
    hkExcelRender();
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    return new Promise(res => { hkExcel.resolve = res; });
}
function hkExcelRender() {
    const rows = hkAllocate(hkExcel.rows);
    const autoN = rows.filter(r => r.hkKeep === 'auto').length;
    const askHap = rows.filter(r => !r.hkSellerHap && r.hkGroupSize > 1 && !r.hap).length;
    const tr = rows.map((r, i) => `<tr class="border-b border-slate-100 align-top">
        <td class="px-2 py-2 text-slate-400">${r.excelRow}</td>
        <td class="px-2 py-2 font-bold whitespace-nowrap">${aiEsc(r.recipient)}</td>
        <td class="px-2 py-2 min-w-[160px]">${aiEsc(r.product)}</td>
        <td class="px-2 py-2">${hkHapCell(r, `hkExcelSet(${i}, 'hap', this.checked)`)}</td>
        <td class="px-2 py-2">${hkKeepCell(r, `hkExcelSet(${i}, 'keep', this.checked)`)}</td>
        <td class="px-2 py-2 min-w-[160px]">${hkBadges(hkMark(r.product, r.hap, !!r.hkKeep))}</td>
    </tr>`).join('');
    document.getElementById('hk-excel-modal').innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl max-w-5xl w-full p-5 space-y-3 border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div class="flex justify-between items-center border-b border-slate-100 pb-2">
                <div><h3 class="font-bold text-slate-900 text-base">📌 접수 전 확인 · 합배송 (합) / 재고에서 출고 (킵)</h3>
                <p class="text-xs text-slate-500">총 ${rows.length}건 · 상품명에 이미 적은 (합)·(킵)은 그대로 두고 두 번 붙이지 않아요.</p></div>
                <button onclick="hkExcelClose(false)" class="text-slate-400 hover:text-slate-700 text-xl px-2">×</button>
            </div>
            ${autoN ? `<p class="text-xs text-indigo-800 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">📦 맡긴 재고가 있는 상품 <b>${autoN}건은 (킵)으로 바꿨어요</b>. 재고에서 먼저 출고됩니다. 재고로 보내지 않을 주문만 체크를 빼 주세요.</p>` : ''}
            ${askHap ? `<p class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">같은 받는분 주문인데 (합)이 없는 줄이 ${askHap}건 있어요. <b>부분출고 없이 모두 모아서 한 번에 보내길 원할 때만</b> (합)에 체크해 주세요.</p>` : ''}
            <div class="overflow-x-auto border border-slate-200 rounded-lg">
                <table class="w-full text-xs">
                    <thead class="bg-slate-50 text-slate-500"><tr>
                        <th class="px-2 py-2 text-left">줄</th><th class="px-2 py-2 text-left">받는분</th><th class="px-2 py-2 text-left">엑셀에 적은 상품명</th>
                        <th class="px-2 py-2 text-left">(합) 합배송</th><th class="px-2 py-2 text-left">(킵) 재고에서 출고</th><th class="px-2 py-2 text-left">접수될 상품명</th>
                    </tr></thead>
                    <tbody>${tr}</tbody>
                </table>
            </div>
            <div class="flex justify-end gap-2">
                <button onclick="hkExcelClose(false)" class="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-sm font-bold rounded-lg">취소</button>
                <button id="hk-excel-ok" onclick="hkExcelClose(true)" class="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg shadow">이대로 주문접수 (${rows.length}건)</button>
            </div>
        </div>`;
}
function hkExcelSet(i, field, on) {
    const r = hkExcel.rows[i];
    if (field === 'hap') hkExcel.rows.forEach(x => { if (x.hkGroup === r.hkGroup && !x.hkSellerHap) x.hap = on; });
    else r.keepOff = !on;
    hkExcelRender();
}
function hkExcelClose(ok) {
    const modal = document.getElementById('hk-excel-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    if (ok) hkExcel.rows.forEach(r => { r.o.product = hkMark(r.product, r.hap, !!r.hkKeep); });
    const res = hkExcel.resolve;
    hkExcel.resolve = null;
    if (res) res(ok);
}

// ---------------------------------------------------------------------
// 단건 접수: 상품명 아래 체크칸 2개 + 접수될 상품명 미리보기
// ---------------------------------------------------------------------
let hkSingle = { keepTouched: false, timer: null, row: null };
function hkSingleInit() {
    const ids = ['so-product', 'so-wholesale-company', 'so-wholesale-product', 'so-recipient', 'so-phone'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.dataset.hk) { el.dataset.hk = '1'; el.addEventListener('input', hkSingleSoon); el.addEventListener('change', hkSingleSoon); }
    });
    hkSingleReset();
}
function hkSingleSoon() { clearTimeout(hkSingle.timer); hkSingle.timer = setTimeout(hkSingleUpdate, 250); }
function hkSingleReset() {
    hkSingle.keepTouched = false;
    const hap = document.getElementById('so-hk-hap'), keep = document.getElementById('so-hk-keep');
    if (hap) hap.checked = false;
    if (keep) keep.checked = false;
    hkSingleUpdate();
}
function hkSingleKeepClick() { hkSingle.keepTouched = true; hkSingleUpdate(); }
async function hkSingleUpdate() {
    const box = document.getElementById('so-hk-box');
    if (!box) return;
    const val = id => (document.getElementById(id) || {}).value || '';
    const product = val('so-product');
    const hapEl = document.getElementById('so-hk-hap'), keepEl = document.getElementById('so-hk-keep');
    const hapInfo = document.getElementById('so-hk-hap-info'), keepInfo = document.getElementById('so-hk-keep-info');
    const sellerHap = HK_HAP.test(product), sellerKeep = hkSellerKeep(product, val('so-wholesale-company'));
    hapEl.disabled = sellerHap;
    if (sellerHap) hapEl.checked = true;
    hapInfo.textContent = sellerHap ? '상품명에 이미 (합)이 있어요 · 그대로' : '같은 받는분 상품을 모두 모아 한 번에 보내요 (부분출고 안 함)';
    if (product.trim()) await hkEnsureProducts();
    const r = { product, wholesaleCompany: val('so-wholesale-company'), wholesaleProduct: val('so-wholesale-product'), qty: 1, keepOff: hkSingle.keepTouched && !keepEl.checked };
    if (product.trim()) hkAllocate([r]); else { r.hkKeep = ''; r.hkProduct = null; }
    keepEl.disabled = sellerKeep;
    if (sellerKeep) { keepEl.checked = true; keepInfo.innerHTML = '상품명(또는 도매거래처명 킵건)에 이미 적었어요 · 그대로'; }
    else if (!r.hkProduct) { if (!hkSingle.keepTouched) keepEl.checked = false; keepInfo.innerHTML = product.trim() ? '상품관리에서 못 찾았어요 · 재고 출고건이면 직접 체크해 주세요' : '맡긴 재고가 있으면 저절로 체크돼요'; }
    else if (r.hkStock <= 0) { if (!hkSingle.keepTouched) keepEl.checked = false; keepInfo.innerHTML = '이 상품은 맡긴 재고가 없어요'; }
    else {
        if (!hkSingle.keepTouched) keepEl.checked = r.hkKeep === 'auto';
        keepInfo.innerHTML = r.hkUsedUp ? `재고 ${r.hkStock}개는 먼저 접수한 (킵) 주문이 쓰기로 되어 있어요`
            : `맡긴 재고 <b class="text-emerald-700">${r.hkStock}개</b>가 있어서 재고에서 먼저 나가요${keepEl.checked && !hkSingle.keepTouched ? ' <span class="px-1 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold">자동</span>' : ''}`;
    }
    document.getElementById('so-hk-preview').innerHTML = product.trim() ? '접수될 상품명: ' + hkBadges(hkSingleProduct()) : '';
}
const hkSingleProduct = () => hkMark((document.getElementById('so-product') || {}).value || '',
    (document.getElementById('so-hk-hap') || {}).checked, (document.getElementById('so-hk-keep') || {}).checked);
