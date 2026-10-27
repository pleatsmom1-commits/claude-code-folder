// =====================================================================
// 관리자 > 재고관리
//  - 거래처 재고표(통합본) 엑셀 올리기: 업체마다 탭 → 업체별 재고로 저장 (그 업체 재고는 통째로 교체)
//  - 재고 추가 · 수정 · 출고처리(재고출고일 기록) · 삭제 · 엑셀 다운로드
//  index.html 의 supabaseClient, currentRole, escapeHtml, fetchAllRows, dbErrorMessage 를 사용합니다.
// =====================================================================

const STOCK_PAGE_PATH = '/stock';
// 엑셀 머리줄 → DB 칸. 머리줄 이름이 조금 달라도 찾을 수 있게 여러 이름을 둡니다.
const STOCK_COLUMNS = [
    { key: 'company',           label: '거래처명',         aliases: ['거래처명', '거래처', '업체명', '상호명', '상호'] },
    { key: 'wholesale_company', label: '도매업체명',       aliases: ['도매업체명', '도매처', '도매처명', '도매업체'] },
    { key: 'wholesale_product', label: '도매상품명',       aliases: ['도매상품명', '도매상품'] },
    { key: 'retail_product',    label: '소매상품명',       aliases: ['소매상품명', '소매상품', '쇼핑몰상품명', '상품명'] },
    { key: 'color',             label: '컬러',             aliases: ['컬러', '색상', '칼라'] },
    { key: 'size',              label: '사이즈',           aliases: ['사이즈', '크기'] },
    { key: 'quantity',          label: '수량',             aliases: ['수량', '수량(개)', '재고수량', '잔여재고', '잔여수량'] },
    { key: 'location',          label: '재고위치',         aliases: ['재고위치', '위치', '보관위치'] },
    { key: 'stocked_on',        label: '재고생성일',       aliases: ['재고생성일', '입고일', '생성일'] },
    { key: 'shipped_on',        label: '재고출고일',       aliases: ['재고출고일', '출고일'] },
    { key: 'customer',          label: '기타(반품고객명)', aliases: ['기타(반품고객명)', '반품고객명', '고객명', '기타'] },
    { key: 'label',             label: '라벨',             aliases: ['라벨', '라벨작업'] },
];
// 올리지 않는 탭: 안내용 탭, 이름 끝에 (X)가 붙은 거래종료 업체 탭
const STOCK_SKIP_SHEETS = ['예시', '체크표'];

let stockItems = [];              // 불러온 재고 전체
let stockSellerCompanies = new Map(); // norm(상호) → 회원가입 상호 (승인된 셀러)
let stockLoadedTab = false;
let stockChecked = new Set();     // 체크한 재고 id
let stockUpload = null;           // 엑셀에서 읽은 업로드 대기 자료 { companies: [{company, rows}], skipped: [] }
let stockEditingId = null;        // 수정 중인 재고 id (새로 추가면 null)

function stockNorm(value) {
    return String(value ?? '').replace(/\s+/g, '').toLowerCase();
}

function stockToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 엑셀 날짜 → 'YYYY-MM-DD'. 재고표에는 Date, 260728(연월일 6자리), 20250407(8자리), 엑셀 일련번호가 섞여 있습니다.
function stockDateKey(value) {
    if (value == null || value === '') return null;
    const ymd = (y, m, d) => {
        if (!(y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    };
    if (value instanceof Date) {
        if (isNaN(value)) return null;
        // 엑셀 날짜는 자정 기준이라 몇 초 어긋날 수 있어 12시간을 더해 날짜만 씁니다.
        const d = new Date(value.getTime() + 12 * 3600 * 1000);
        return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
    if (typeof value === 'number') {
        const n = Math.round(value);
        if (n >= 19000000 && n < 21000000) return ymd(Math.floor(n / 10000), Math.floor(n / 100) % 100, n % 100);
        if (n >= 100000 && n < 1000000) return ymd(2000 + Math.floor(n / 10000), Math.floor(n / 100) % 100, n % 100);
        if (n > 20000 && n < 80000) {
            const d = new Date(Math.round((n - 25569) * 86400 * 1000));
            return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
        }
        return null;
    }
    const s = String(value).trim();
    let m = s.match(/^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
    if (m) return ymd(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{2})[-./](\d{1,2})[-./](\d{1,2})$/);
    if (m) return ymd(2000 + +m[1], +m[2], +m[3]);
    if (/^\d{6}(\d{2})?$/.test(s)) return stockDateKey(Number(s));
    return null;
}

function stockShowModal(id, show) {
    const el = document.getElementById(id);
    el.classList.toggle('hidden', !show);
    el.classList.toggle('flex', show);
}

// 출고됨: 재고출고일이 있거나, 출고 메모(재고출고일 칸의 글)가 있으면
function stockIsShipped(r) {
    return !!(r.shipped_on || r.shipped_note);
}

function stockShippedLabel(r) {
    return [stockShortDate(r.shipped_on), r.shipped_note].filter(Boolean).join(' ');
}

// 재고출고일 칸의 글 → 날짜·출고 메모. '10/28출고', '11/5매장반품' 처럼 월/일이 있으면 날짜로 읽고
// (연도는 재고생성일 기준), '…보관' 처럼 보관 중이라는 글은 출고가 아니라 메모로 둡니다.
function stockParseShipped(value, stockedOn) {
    const date = stockDateKey(value);
    if (date) return { shipped_on: date, shipped_note: '', memo: '' };
    const text = String(value ?? '').trim();
    if (!text) return { shipped_on: null, shipped_note: '', memo: '' };
    if (/보관/.test(text) && !/출고/.test(text)) return { shipped_on: null, shipped_note: '', memo: text };
    const m = text.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
    let shipped = null;
    if (m) {
        const base = stockedOn ? Number(stockedOn.slice(0, 4)) : new Date().getFullYear();
        shipped = stockDateKey(`${base}-${m[1]}-${m[2]}`);
        if (shipped && stockedOn && shipped < stockedOn) shipped = stockDateKey(`${base + 1}-${m[1]}-${m[2]}`);
        if (shipped && !stockedOn && shipped > stockToday()) shipped = stockDateKey(`${base - 1}-${m[1]}-${m[2]}`);
    }
    return { shipped_on: shipped, shipped_note: text, memo: '' };
}

function stockShortDate(key) {
    return key ? String(key).slice(2).replace(/-/g, '.') : '';
}

function stockQty(value) {
    const n = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) && String(value ?? '').trim() !== '' ? n : 1;
}

function onStockTabOpened() {
    if (stockLoadedTab) return;
    stockLoadedTab = true;
    fetchStockItems();
}

// ---------------------------------------------------------------------
// 1. 불러오기 · 목록
// ---------------------------------------------------------------------
async function fetchStockItems() {
    if (!supabaseClient || currentRole !== 'admin') return;
    const [items, sellers] = await Promise.all([
        fetchAllRows(() => supabaseClient.from('stock_items').select('*').order('company').order('id')),
        fetchAllRows(() => supabaseClient.from('profiles').select('company,status').eq('status', 'approved')),
    ]);
    if (items.error) {
        alert('재고를 불러오지 못했습니다.\n\n' + dbErrorMessage(items.error)
            + '\n\n(Supabase에서 supabase/stock.sql 을 실행했는지 확인해주세요)');
        return;
    }
    stockItems = items.data;
    stockSellerCompanies = new Map((sellers.data || []).map(p => [stockNorm(p.company), p.company]));
    stockChecked = new Set([...stockChecked].filter(id => stockItems.some(r => r.id === id)));
    renderStockCompanies();
    renderStockTable();
}

// 업체별 요약 (보관중 건수·수량, 회원 연결 여부) + 업체 선택칸
function stockCompanySummary() {
    const map = new Map();
    for (const r of stockItems) {
        const key = stockNorm(r.company);
        if (!map.has(key)) map.set(key, { company: r.company, kept: 0, keptQty: 0, shipped: 0 });
        const s = map.get(key);
        if (stockIsShipped(r)) s.shipped++; else { s.kept++; s.keptQty += Number(r.quantity) || 0; }
    }
    return [...map.values()].sort((a, b) => a.company.localeCompare(b.company, 'ko'));
}

function renderStockCompanies() {
    const summary = stockCompanySummary();
    const select = document.getElementById('stock-f-company');
    const current = select.value;
    select.innerHTML = `<option value="">업체 전체 (${summary.length}곳)</option>`
        + summary.map(s => `<option value="${escapeHtml(stockNorm(s.company))}">${escapeHtml(s.company)} (보관 ${s.kept})</option>`).join('');
    select.value = summary.some(s => stockNorm(s.company) === current) ? current : '';

    const linked = summary.filter(s => stockSellerCompanies.has(stockNorm(s.company))).length;
    document.getElementById('stock-company-count').textContent =
        `업체 ${summary.length}곳 · 회원 연결 ${linked}곳 · 미가입(상호 다름) ${summary.length - linked}곳`;
    const tbody = document.getElementById('stock-company-list');
    if (!summary.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-slate-400">등록된 재고가 없습니다. [재고표 엑셀 올리기]로 등록하세요.</td></tr>`;
        return;
    }
    tbody.innerHTML = summary.map(s => {
        const seller = stockSellerCompanies.get(stockNorm(s.company));
        return `
        <tr class="hover:bg-slate-50 cursor-pointer" data-key="${escapeHtml(stockNorm(s.company))}" onclick="selectStockCompany(this.dataset.key)">
            <td class="p-2 font-bold">${escapeHtml(s.company)}</td>
            <td class="p-2 text-right">${s.kept}건 · ${s.keptQty.toLocaleString('ko-KR')}개</td>
            <td class="p-2 text-right text-slate-400">${s.shipped}</td>
            <td class="p-2 text-center">${seller
                ? '<span class="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10px] font-bold">연결됨</span>'
                : '<span class="px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-bold" title="회원가입 상호와 같은 이름이 없습니다">미가입</span>'}</td>
        </tr>`;
    }).join('');
}

function selectStockCompany(key) {
    document.getElementById('stock-f-company').value = key;
    renderStockTable();
}

function stockFilteredList() {
    const company = document.getElementById('stock-f-company').value;
    const status = document.getElementById('stock-f-status').value;
    const keyword = stockNorm(document.getElementById('stock-f-keyword').value);
    return stockItems.filter(r => {
        if (company && stockNorm(r.company) !== company) return false;
        if (status === 'kept' && stockIsShipped(r)) return false;
        if (status === 'shipped' && !stockIsShipped(r)) return false;
        if (keyword) {
            const text = stockNorm([r.company, r.wholesale_company, r.wholesale_product, r.retail_product,
                r.color, r.size, r.location, r.customer, r.memo].join('|'));
            if (!text.includes(keyword)) return false;
        }
        return true;
    });
}

function renderStockTable() {
    const list = stockFilteredList();
    const kept = list.filter(r => !stockIsShipped(r));
    document.getElementById('stock-summary').textContent =
        `${list.length}건 표시 · 보관중 ${kept.length}건 (${kept.reduce((n, r) => n + (Number(r.quantity) || 0), 0).toLocaleString('ko-KR')}개)`
        + (stockChecked.size ? ` · ${stockChecked.size}건 체크됨` : '');
    const company = document.getElementById('stock-f-company').value;
    const previewBtn = document.getElementById('stock-preview-btn');
    previewBtn.disabled = !company;

    const tbody = document.getElementById('stock-list');
    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="13" class="p-8 text-center text-slate-400">${stockItems.length ? '조건에 맞는 재고가 없습니다.' : '등록된 재고가 없습니다.'}</td></tr>`;
        document.getElementById('stock-check-all').checked = false;
        return;
    }
    // 화면이 느려지지 않게 최대 1000줄만 그립니다 (엑셀 다운로드는 전체).
    const shown = list.slice(0, 1000);
    tbody.innerHTML = shown.map(r => `
        <tr class="${stockIsShipped(r) ? 'bg-slate-50 text-slate-400' : 'hover:bg-slate-50'}">
            <td class="p-2 text-center"><input type="checkbox" data-id="${r.id}" ${stockChecked.has(r.id) ? 'checked' : ''} onchange="toggleStockCheck(this)"></td>
            <td class="p-2 font-bold whitespace-nowrap">${escapeHtml(r.company)}</td>
            <td class="p-2 whitespace-nowrap">${escapeHtml(r.wholesale_company)}</td>
            <td class="p-2">${escapeHtml(r.wholesale_product)}</td>
            <td class="p-2 max-w-[260px]">${escapeHtml(r.retail_product)}</td>
            <td class="p-2 whitespace-nowrap">${escapeHtml(r.color)}</td>
            <td class="p-2 whitespace-nowrap">${escapeHtml(r.size)}</td>
            <td class="p-2 text-right font-bold">${escapeHtml(String(r.quantity ?? ''))}</td>
            <td class="p-2 whitespace-nowrap">${escapeHtml(r.location)}</td>
            <td class="p-2 whitespace-nowrap">${stockShortDate(r.stocked_on)}</td>
            <td class="p-2 whitespace-nowrap">${stockIsShipped(r) ? `<span class="px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded text-[10px] font-bold">출고 ${escapeHtml(stockShippedLabel(r))}</span>` : '<span class="text-emerald-600 font-bold text-[11px]">보관중</span>'}</td>
            <td class="p-2 whitespace-nowrap">${escapeHtml(r.customer)}</td>
            <td class="p-2 text-center"><button onclick="openStockEdit(${r.id})" class="px-2 py-1 text-[11px] text-indigo-600 hover:bg-indigo-50 rounded font-bold">수정</button></td>
        </tr>`).join('')
        + (list.length > shown.length ? `<tr><td colspan="13" class="p-3 text-center text-slate-400">처음 1,000건만 표시합니다. 업체를 고르거나 검색해서 좁혀주세요.</td></tr>` : '');
    document.getElementById('stock-check-all').checked = shown.every(r => stockChecked.has(r.id));
}

function toggleStockCheck(input) {
    const id = Number(input.dataset.id);
    if (input.checked) stockChecked.add(id); else stockChecked.delete(id);
    renderStockTable();
}

function toggleStockCheckAll(input) {
    const shown = stockFilteredList().slice(0, 1000);
    shown.forEach(r => { if (input.checked) stockChecked.add(r.id); else stockChecked.delete(r.id); });
    renderStockTable();
}

function resetStockSearch() {
    document.getElementById('stock-f-company').value = '';
    document.getElementById('stock-f-status').value = 'kept';
    document.getElementById('stock-f-keyword').value = '';
    renderStockTable();
}

// 셀러가 보는 화면을 관리자가 미리 보기 (선택한 업체)
function previewStockPage() {
    const key = document.getElementById('stock-f-company').value;
    const s = stockCompanySummary().find(x => stockNorm(x.company) === key);
    if (!s) return;
    window.open(`${STOCK_PAGE_PATH}?company=${encodeURIComponent(s.company)}`, '_blank');
}

// ---------------------------------------------------------------------
// 2. 출고처리 · 삭제 (체크한 재고)
// ---------------------------------------------------------------------
function stockCheckedRows() {
    return stockItems.filter(r => stockChecked.has(r.id));
}

async function updateStockIds(ids, patch) {
    for (let i = 0; i < ids.length; i += 200) {
        const { error } = await supabaseClient.from('stock_items').update(patch).in('id', ids.slice(i, i + 200));
        if (error) return error;
    }
    return null;
}

async function shipCheckedStock() {
    const rows = stockCheckedRows().filter(r => !stockIsShipped(r));
    if (!rows.length) { alert('출고처리할 보관중 재고를 체크해주세요.'); return; }
    const date = prompt(`체크한 보관중 재고 ${rows.length}건을 출고처리합니다.\n재고출고일을 확인해주세요. (예: 2026-10-27)`, stockToday());
    if (date === null) return;
    const key = stockDateKey(date);
    if (!key) { alert('날짜 형식이 맞지 않습니다. 예: 2026-10-27'); return; }
    const error = await updateStockIds(rows.map(r => r.id), { shipped_on: key });
    if (error) { alert('출고처리하지 못했습니다.\n\n' + dbErrorMessage(error)); return; }
    stockChecked.clear();
    await fetchStockItems();
}

async function unshipCheckedStock() {
    const rows = stockCheckedRows().filter(r => stockIsShipped(r));
    if (!rows.length) { alert('출고취소할 출고됨 재고를 체크해주세요.'); return; }
    if (!confirm(`체크한 출고됨 재고 ${rows.length}건의 재고출고일·출고 메모를 지우고 보관중으로 되돌립니다.`)) return;
    const error = await updateStockIds(rows.map(r => r.id), { shipped_on: null, shipped_note: '' });
    if (error) { alert('출고취소하지 못했습니다.\n\n' + dbErrorMessage(error)); return; }
    stockChecked.clear();
    await fetchStockItems();
}

async function deleteCheckedStock() {
    const rows = stockCheckedRows();
    if (!rows.length) { alert('삭제할 재고를 체크해주세요.'); return; }
    if (!confirm(`체크한 재고 ${rows.length}건을 삭제합니다. 되돌릴 수 없습니다.\n(출고된 재고는 삭제 대신 [출고처리]를 쓰면 기록이 남습니다)`)) return;
    const ids = rows.map(r => r.id);
    for (let i = 0; i < ids.length; i += 200) {
        const { error } = await supabaseClient.from('stock_items').delete().in('id', ids.slice(i, i + 200));
        if (error) { alert('삭제하지 못했습니다.\n\n' + dbErrorMessage(error)); break; }
    }
    stockChecked.clear();
    await fetchStockItems();
}

// ---------------------------------------------------------------------
// 3. 재고 추가 · 수정 (창)
// ---------------------------------------------------------------------
const STOCK_EDIT_FIELDS = ['company', 'wholesale_company', 'wholesale_product', 'retail_product', 'color', 'size',
    'quantity', 'location', 'stocked_on', 'shipped_on', 'shipped_note', 'customer', 'label', 'memo'];

function openStockEdit(id) {
    const r = id ? stockItems.find(x => x.id === id) : null;
    stockEditingId = r ? r.id : null;
    document.getElementById('stock-edit-title').textContent = r ? '재고 수정' : '재고 추가';
    document.getElementById('stock-edit-delete').classList.toggle('hidden', !r);
    const companyKey = document.getElementById('stock-f-company').value;
    const defaultCompany = (stockCompanySummary().find(s => stockNorm(s.company) === companyKey) || {}).company || '';
    const values = r || { company: defaultCompany, quantity: 1, stocked_on: stockToday() };
    for (const f of STOCK_EDIT_FIELDS) {
        document.getElementById('stock-edit-' + f).value = values[f] ?? '';
    }
    document.getElementById('stock-company-options').innerHTML = stockCompanySummary()
        .map(s => `<option value="${escapeHtml(s.company)}">`).join('');
    stockShowModal('stock-edit-modal', true);
}

function closeStockEdit() {
    stockShowModal('stock-edit-modal', false);
}

async function saveStockEdit(event) {
    event.preventDefault();
    const row = {};
    for (const f of STOCK_EDIT_FIELDS) row[f] = document.getElementById('stock-edit-' + f).value.trim();
    if (!row.company) { alert('거래처명을 입력해주세요.'); return; }
    if (!row.wholesale_product && !row.retail_product && !row.customer) { alert('도매상품명 · 소매상품명 · 반품고객명 중 하나는 입력해주세요.'); return; }
    row.quantity = stockQty(row.quantity);
    for (const f of ['stocked_on', 'shipped_on']) {
        if (row[f] && !stockDateKey(row[f])) { alert('날짜 형식이 맞지 않습니다. 예: 2026-10-27'); return; }
        row[f] = stockDateKey(row[f]);
    }
    const { error } = stockEditingId
        ? await supabaseClient.from('stock_items').update(row).eq('id', stockEditingId)
        : await supabaseClient.from('stock_items').insert(row);
    if (error) { alert('저장하지 못했습니다.\n\n' + dbErrorMessage(error)); return; }
    closeStockEdit();
    await fetchStockItems();
}

async function deleteStockEdit() {
    if (!stockEditingId || !confirm('이 재고를 삭제합니다. 되돌릴 수 없습니다.')) return;
    const { error } = await supabaseClient.from('stock_items').delete().eq('id', stockEditingId);
    if (error) { alert('삭제하지 못했습니다.\n\n' + dbErrorMessage(error)); return; }
    closeStockEdit();
    await fetchStockItems();
}

// ---------------------------------------------------------------------
// 4. 재고표 엑셀 올리기 (업체마다 탭) → 미리보기 → 업체별 통째로 교체
// ---------------------------------------------------------------------
function stockSkipReason(sheetName) {
    const name = String(sheetName).trim();
    if (STOCK_SKIP_SHEETS.includes(name)) return '안내용 탭';
    if (/\(\s*x\s*\)\s*$/i.test(name)) return '거래종료 (X) 탭';
    return null;
}

// 여러 업체가 섞인 탭(기타업체들, 시트1 등)은 거래처명 칸을, 업체 탭은 탭 이름을 업체로 씁니다.
function stockSheetUsesCompanyColumn(sheetName) {
    return /기타/.test(sheetName) || /^(sheet|시트)\s*\d*$/i.test(String(sheetName).trim());
}

function parseStockSheet(sheetName, rows) {
    const headerIdx = rows.slice(0, 10).findIndex(r => {
        const cells = (r || []).map(c => String(c ?? '').replace(/\s+/g, ''));
        const qtyNames = STOCK_COLUMNS.find(c => c.key === 'quantity').aliases;
        return cells.some(c => qtyNames.includes(c)) && cells.some(c => c.startsWith('도매') || c.includes('상품명'));
    });
    if (headerIdx < 0) return { error: '머리줄(수량/잔여재고·상품명)을 찾지 못함' };
    const header = rows[headerIdx].map(c => String(c ?? '').replace(/\s+/g, ''));
    const col = {};
    for (const c of STOCK_COLUMNS) {
        const idx = header.findIndex(h => c.aliases.some(a => h === a.replace(/\s+/g, '')));
        if (idx >= 0) col[c.key] = idx;
    }
    // 더블샵 탭처럼 불량수량 칸이 있으면 메모에 남깁니다.
    const defectIdx = header.findIndex(h => h === '불량수량' || h === '불량');
    // 기타업체들 탭처럼 첫 칸 머리줄이 비어 있으면 그 칸을 거래처명으로 봅니다.
    if (col.company == null && header[0] === '') col.company = 0;
    const useColumn = stockSheetUsesCompanyColumn(sheetName);
    if (useColumn && col.company == null) return { error: '거래처명 칸이 없음' };

    const cell = (r, key) => (col[key] == null ? '' : r[col[key]]);
    const text = (r, key) => String(cell(r, key) ?? '').trim();
    const out = [];
    let blank = 0;
    for (const r of rows.slice(headerIdx + 1)) {
        if (!r || !r.some(c => String(c ?? '').trim() !== '')) continue;
        const item = {
            company: useColumn ? text(r, 'company') : String(sheetName).trim(),
            wholesale_company: text(r, 'wholesale_company'),
            wholesale_product: text(r, 'wholesale_product'),
            retail_product: text(r, 'retail_product'),
            color: text(r, 'color'),
            size: text(r, 'size'),
            quantity: stockQty(cell(r, 'quantity')),
            location: text(r, 'location'),
            stocked_on: stockDateKey(cell(r, 'stocked_on')),
            customer: text(r, 'customer'),
            label: text(r, 'label'),
        };
        Object.assign(item, stockParseShipped(cell(r, 'shipped_on'), item.stocked_on));
        const defect = defectIdx >= 0 ? String(r[defectIdx] ?? '').trim() : '';
        if (defect && defect !== '0') item.memo = [item.memo, `불량 ${defect}개`].filter(Boolean).join(' · ');
        // 상품명이 없어도 반품고객명·재고생성일이 있으면 반품 기록이라 올립니다. 아무것도 없는 줄(도매처 주소 목록 등)만 뺍니다.
        const hasInfo = item.wholesale_product || item.retail_product || item.customer || item.stocked_on;
        if (!item.company || !hasInfo) { blank++; continue; }
        out.push(item);
    }
    return { rows: out, blank };
}

function uploadStockWorkbook(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
        let wb;
        try {
            wb = XLSX.read(new Uint8Array(evt.target.result), { type: 'array', cellDates: true });
        } catch (e) {
            alert('엑셀 파일을 읽지 못했습니다.\n\n' + e.message);
            return;
        }
        const byCompany = new Map();
        const sheets = [];
        for (const name of wb.SheetNames) {
            const skip = stockSkipReason(name);
            if (skip) { sheets.push({ name, note: `건너뜀 (${skip})` }); continue; }
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true });
            const parsed = parseStockSheet(name, rows);
            if (parsed.error) { sheets.push({ name, note: `건너뜀 (${parsed.error})` }); continue; }
            sheets.push({ name, note: `${parsed.rows.length}줄` + (parsed.blank ? ` · 빈 줄 ${parsed.blank}개 제외` : '') });
            for (const item of parsed.rows) {
                const key = stockNorm(item.company);
                if (!byCompany.has(key)) byCompany.set(key, { company: item.company, rows: [] });
                byCompany.get(key).rows.push(item);
            }
        }
        if (!byCompany.size) {
            alert('올릴 재고를 찾지 못했습니다.\n\n' + sheets.map(s => `· ${s.name}: ${s.note}`).join('\n'));
            return;
        }
        stockUpload = {
            fileName: file.name,
            sheets,
            companies: [...byCompany.values()].sort((a, b) => a.company.localeCompare(b.company, 'ko')),
        };
        renderStockUploadPreview();
    };
    reader.readAsArrayBuffer(file);
}

function renderStockUploadPreview() {
    const up = stockUpload;
    const existing = new Map(stockCompanySummary().map(s => [stockNorm(s.company), s]));
    const total = up.companies.reduce((n, c) => n + c.rows.length, 0);
    document.getElementById('stock-upload-info').innerHTML =
        `<b>${escapeHtml(up.fileName)}</b> · 업체 ${up.companies.length}곳 · ${total.toLocaleString('ko-KR')}줄`;
    document.getElementById('stock-upload-sheets').innerHTML = up.sheets
        .map(s => `<span class="inline-block mr-2 mb-1 px-2 py-0.5 rounded ${s.note.startsWith('건너뜀') ? 'bg-slate-100 text-slate-400' : 'bg-indigo-50 text-indigo-700'}">${escapeHtml(s.name)}: ${escapeHtml(s.note)}</span>`)
        .join('');
    document.getElementById('stock-upload-list').innerHTML = up.companies.map(c => {
        const key = stockNorm(c.company);
        const kept = c.rows.filter(r => !stockIsShipped(r)).length;
        const before = existing.get(key);
        const seller = stockSellerCompanies.get(key);
        return `
        <tr class="hover:bg-slate-50">
            <td class="p-2 font-bold">${escapeHtml(c.company)}</td>
            <td class="p-2 text-right">${kept}건</td>
            <td class="p-2 text-right text-slate-400">${c.rows.length - kept}</td>
            <td class="p-2 text-right text-slate-500">${before ? `${before.kept + before.shipped}줄 → 교체` : '새로 등록'}</td>
            <td class="p-2 text-center">${seller
                ? '<span class="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10px] font-bold">연결됨</span>'
                : '<span class="px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded text-[10px] font-bold">미가입</span>'}</td>
        </tr>`;
    }).join('');
    stockShowModal('stock-upload-modal', true);
}

function closeStockUpload() {
    stockShowModal('stock-upload-modal', false);
    stockUpload = null;
}

async function confirmStockUpload() {
    const up = stockUpload;
    if (!up) return;
    const btn = document.getElementById('stock-upload-confirm');
    btn.disabled = true;
    const status = document.getElementById('stock-upload-status');
    let done = 0;
    try {
        for (const c of up.companies) {
            status.textContent = `저장 중... ${done}/${up.companies.length}곳 (${c.company})`;
            const key = stockNorm(c.company);
            // 새 재고를 먼저 넣고 나서 예전 재고를 지웁니다 (중간에 끊겨도 재고가 비지 않게).
            const oldIds = stockItems.filter(r => stockNorm(r.company) === key).map(r => r.id);
            for (let i = 0; i < c.rows.length; i += 500) {
                const { error } = await supabaseClient.from('stock_items').insert(c.rows.slice(i, i + 500));
                if (error) throw error;
            }
            for (let i = 0; i < oldIds.length; i += 200) {
                const { error } = await supabaseClient.from('stock_items').delete().in('id', oldIds.slice(i, i + 200));
                if (error) throw error;
            }
            done++;
        }
        status.textContent = '';
        alert(`재고 ${up.companies.length}곳을 저장했습니다.`);
        closeStockUpload();
    } catch (error) {
        status.textContent = '';
        alert(`저장 중 오류가 났습니다. (${done}곳까지 저장됨)\n\n` + dbErrorMessage(error));
    } finally {
        btn.disabled = false;
        stockChecked.clear();
        await fetchStockItems();
    }
}

// ---------------------------------------------------------------------
// 5. 엑셀 다운로드 (지금 보이는 조건, 업체마다 탭 — 원래 재고표와 같은 칸)
// ---------------------------------------------------------------------
function downloadStockExcel() {
    const list = stockFilteredList();
    if (!list.length) { alert('다운로드할 재고가 없습니다.'); return; }
    const header = STOCK_COLUMNS.map(c => c.label);
    const wb = XLSX.utils.book_new();
    const groups = new Map();
    for (const r of list) {
        if (!groups.has(r.company)) groups.set(r.company, []);
        groups.get(r.company).push(r);
    }
    const usedNames = new Set();
    for (const [company, rows] of groups) {
        const data = [header, ...rows.map(r => STOCK_COLUMNS.map(c => {
            const v = r[c.key];
            if (c.key === 'quantity') return Number(v);
            if (c.key === 'shipped_on') return [r.shipped_on, r.shipped_note].filter(Boolean).join(' ');
            return v ?? '';
        }))];
        const ws = XLSX.utils.aoa_to_sheet(data);
        ws['!cols'] = header.map((h, i) => ({ wch: [12, 12, 18, 30, 8, 8, 6, 10, 11, 11, 14, 6][i] || 10 }));
        // 시트 이름: 31자 제한, 쓸 수 없는 글자 제거, 중복 피하기
        let name = String(company).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || '업체';
        for (let n = 2; usedNames.has(name); n++) name = `${String(company).slice(0, 27)} (${n})`;
        usedNames.add(name);
        XLSX.utils.book_append_sheet(wb, ws, name);
    }
    XLSX.writeFile(wb, `거래처재고표_${stockToday()}.xlsx`);
}
