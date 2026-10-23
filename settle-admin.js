// =====================================================================
// 관리자 > 정산서 발송
//  - 정산 거래처 연락처 관리 (엑셀 일괄 등록 / 개별 수정)
//  - 정산청구서 엑셀(.xlsm)의 정산서DB 시트 → 업체별 정산서 저장 → 링크 생성
//  index.html 의 supabaseClient, currentRole, escapeHtml, fetchAllRows, dbErrorMessage 를 사용합니다.
// =====================================================================

const SETTLE_PAGE_PATH = '/settle';
const SETTLE_RESULT_MESSAGE = { '청구': '입금 부탁드립니다.', '이월': '결제완료, 잔여금입니다.', '영수': '결제완료' };

let settleContacts = [];          // [{company, phone, memo}]
let settleExcelRows = null;       // 엑셀에서 읽은 정산서 (정산일 무관 전체)
let settleExcelFileName = '';
let settleExcelDuplicates = new Map(); // 정산일 → [{company, totals}] 같은 날 두 번 이상 나온 상호
let settleSaved = [];             // 선택한 정산일의 저장된 정산서
let settleLoadedTab = false;
let settleChecked = new Set();     // 발송할 업체로 체크한 상호 (비어 있으면 전체 발송)
let settleCheckedDate = null;
// 조회 조건 ([조회] 버튼을 눌렀을 때만 바뀜)
const SETTLE_QUERY_DEFAULT = { status: 'all', result: 'all', phone: 'all', keyword: '', sort: 'seq' };
let settleQuery = { ...SETTLE_QUERY_DEFAULT };

function settleNorm(value) {
    return String(value ?? '').replace(/\s+/g, '').toLowerCase();
}

// 숫자만 남겨 휴대폰/전화번호 형식이면 돌려주고, 아니면 null ("연락처 없음" 등)
function settlePhone(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (/^01\d{8,9}$/.test(digits) || /^0\d{8,10}$/.test(digits)) return digits;
    return null;
}

function settlePhoneLabel(phone) {
    if (!phone) return '';
    if (phone.length === 11) return `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`;
    if (phone.length === 10) return `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`;
    return phone;
}

function settleWon(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString('ko-KR') : '';
}

function settleRandomToken() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function settleLink(token) {
    return `${location.origin}${SETTLE_PAGE_PATH}?t=${token}`;
}

// 엑셀 날짜(일련번호 / 문자열 / Date) → 'YYYY-MM-DD'
function settleDateKey(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') {
        const d = new Date(Math.round((value - 25569) * 86400000));
        return d.toISOString().slice(0, 10);
    }
    if (value instanceof Date) {
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    }
    const m = String(value).trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

// DB(jsonb)는 키 순서를 바꿔 저장하므로, 비교할 때는 키를 정렬해서 문자열로 만듭니다.
function settleStableJson(value) {
    if (Array.isArray(value)) return '[' + value.map(settleStableJson).join(',') + ']';
    if (value && typeof value === 'object') {
        return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + settleStableJson(value[k])).join(',') + '}';
    }
    return JSON.stringify(value ?? null);
}

function settleShortDate(key) {
    const [, m, d] = String(key || '').split('-');
    return m && d ? `${m}/${d}` : key;
}

// ---------------------------------------------------------------------
// 탭 진입
// ---------------------------------------------------------------------
function onSettleTabOpened() {
    if (settleLoadedTab) return;
    settleLoadedTab = true;
    const dateInput = document.getElementById('settle-date');
    if (!dateInput.value) dateInput.value = settleDateKey(new Date());
    fetchSettleContacts();
    loadSavedSettlements();
}

// ---------------------------------------------------------------------
// 1. 정산 거래처 연락처
// ---------------------------------------------------------------------
async function fetchSettleContacts() {
    if (!supabaseClient || currentRole !== 'admin') return;
    const { data, error } = await fetchAllRows(() =>
        supabaseClient.from('settle_contacts').select('*').order('company')
    );
    if (error) {
        alert('정산 거래처 연락처를 불러오지 못했습니다.\n\n' + dbErrorMessage(error)
            + '\n\n(Supabase에서 supabase/settlement.sql 을 실행했는지 확인해주세요)');
        return;
    }
    settleContacts = data;
    renderSettleContacts();
    renderSettleTable();
}

function settleContactPhone(company) {
    const key = settleNorm(company);
    const c = settleContacts.find(x => settleNorm(x.company) === key);
    return c ? c.phone : null;
}

function renderSettleContacts() {
    const keyword = settleNorm(document.getElementById('settle-contact-search').value);
    const withPhone = settleContacts.filter(c => c.phone).length;
    document.getElementById('settle-contact-count').textContent =
        `총 ${settleContacts.length}곳 · 연락처 있음 ${withPhone} · 없음 ${settleContacts.length - withPhone}`;

    const list = settleContacts.filter(c =>
        !keyword || settleNorm(c.company).includes(keyword) || String(c.phone || '').includes(keyword.replace(/\D/g, '') || '@@'));
    const tbody = document.getElementById('settle-contact-list');
    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="3" class="p-6 text-center text-slate-400">${settleContacts.length ? '검색 결과가 없습니다.' : '등록된 연락처가 없습니다. [연락처 엑셀 올리기]로 등록하세요.'}</td></tr>`;
        return;
    }
    tbody.innerHTML = list.map(c => `
        <tr class="hover:bg-slate-50">
            <td class="p-2.5 font-bold">${escapeHtml(c.company)}</td>
            <td class="p-2.5">
                <input type="text" value="${escapeHtml(settlePhoneLabel(c.phone))}" placeholder="연락처 없음"
                    data-company="${escapeHtml(c.company)}" onchange="saveSettleContactPhone(this)"
                    class="w-36 px-2 py-1 border rounded text-xs ${c.phone ? '' : 'bg-rose-50 border-rose-200'}">
            </td>
            <td class="p-2.5 text-center">
                <button data-company="${escapeHtml(c.company)}" onclick="deleteSettleContact(this.dataset.company)"
                    class="px-2 py-1 text-[11px] text-rose-600 hover:bg-rose-50 rounded">삭제</button>
            </td>
        </tr>`).join('');
}

async function saveSettleContactPhone(input) {
    const company = input.dataset.company;
    const raw = input.value.trim();
    const phone = settlePhone(raw);
    if (raw && !phone) {
        alert('연락처 형식이 올바르지 않습니다. (예: 010-1234-5678)\n연락처를 모르면 칸을 비워두세요.');
        input.focus();
        return;
    }
    const { error } = await supabaseClient.from('settle_contacts')
        .upsert({ company, phone, updated_at: new Date().toISOString() });
    if (error) { alert('저장 실패: ' + dbErrorMessage(error)); return; }
    const c = settleContacts.find(x => x.company === company);
    if (c) c.phone = phone;
    renderSettleContacts();
    renderSettleTable();
}

async function addSettleContact() {
    const company = (prompt('추가할 상호를 입력하세요 (정산청구서와 같은 표기)') || '').trim();
    if (!company) return;
    const raw = (prompt(`[${company}] 연락처 (모르면 비워두세요)`) || '').trim();
    const phone = settlePhone(raw);
    if (raw && !phone) { alert('연락처 형식이 올바르지 않습니다.'); return; }
    const { error } = await supabaseClient.from('settle_contacts')
        .upsert({ company, phone, updated_at: new Date().toISOString() });
    if (error) { alert('저장 실패: ' + dbErrorMessage(error)); return; }
    fetchSettleContacts();
}

async function deleteSettleContact(company) {
    if (!confirm(`[${company}] 연락처를 삭제할까요?`)) return;
    const { error } = await supabaseClient.from('settle_contacts').delete().eq('company', company);
    if (error) { alert('삭제 실패: ' + dbErrorMessage(error)); return; }
    fetchSettleContacts();
}

// 첫 줄에 '상호'와 '연락처' 머리글이 있는 시트를 찾아 일괄 등록
function uploadSettleContacts(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
        try {
            const wb = XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
            let rows = null;
            for (const name of wb.SheetNames) {
                const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
                const head = (aoa[0] || []).map(v => settleNorm(v));
                const ci = head.findIndex(h => h === '상호' || h.startsWith('상호('));
                const pi = head.findIndex(h => h.includes('연락처') || h.includes('핸드폰') || h.includes('휴대폰') || h.includes('전화'));
                if (ci >= 0 && pi >= 0) {
                    rows = aoa.slice(1).map(r => ({ company: String(r[ci] || '').trim(), raw: String(r[pi] || '').trim() }))
                        .filter(r => r.company);
                    break;
                }
            }
            if (!rows) {
                alert('첫 줄에 "상호"와 "연락처" 머리글이 있는 시트를 찾지 못했습니다.');
                return;
            }
            const map = new Map();
            for (const r of rows) map.set(r.company, settlePhone(r.raw)); // 같은 상호가 여러 번이면 마지막 값
            const payload = [...map].map(([company, phone]) => ({ company, phone, updated_at: new Date().toISOString() }));
            const withPhone = payload.filter(p => p.phone).length;
            if (!confirm(`${payload.length}곳을 등록합니다. (연락처 있음 ${withPhone}곳 / 없음 ${payload.length - withPhone}곳)\n\n이미 등록된 상호는 이 파일의 연락처로 바뀝니다. 계속할까요?`)) return;

            for (let i = 0; i < payload.length; i += 500) {
                const { error } = await supabaseClient.from('settle_contacts').upsert(payload.slice(i, i + 500));
                if (error) { alert('등록 실패: ' + dbErrorMessage(error)); return; }
            }
            alert(`${payload.length}곳 등록 완료`);
            fetchSettleContacts();
        } catch (err) {
            alert('엑셀을 읽지 못했습니다: ' + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
}

// ---------------------------------------------------------------------
// 2. 정산청구서 엑셀 → 업체별 정산서
// ---------------------------------------------------------------------
// 정산서DB 시트의 열 순서 (1번째 열 = 0). 단가 열(8,12,17,19)은 거래처에게 보여주지 않으므로 읽지 않습니다.
function settleRowToData(r) {
    const v = i => (r[i] === '' || r[i] == null ? null : r[i]);
    const stores = [];
    for (let i = 29; i < r.length; i += 3) {
        if (v(i) == null && v(i + 1) == null && v(i + 2) == null) continue;
        stores.push({ name: v(i), info: v(i + 1), amount: v(i + 2) });
    }
    return {
        company: String(r[0]).trim(),
        phone: v(1),
        date: settleDateKey(r[3]),
        account: v(4),
        deliveryType: v(5),
        pickupStores: v(6),
        pickupCost: v(8),           // ① 총 픽업/반납 비용
        prepaid: v(9),              // ② 총 대납금액
        unsentStores: v(10),
        unsentCost: v(12),          // ③ 총 대납미송 비용
        shippingFee: v(13),         // ④ 적용택배비
        trackingNo: v(14),
        fulfillCount: v(15),
        fulfillExtraCount: v(17),
        fulfillExtraShipping: v(19),
        fulfillCost: v(20),         // ⑤ 풀필 총 비용
        etcCost: v(21),             // ⑥ 기타비용청구
        etcNote: v(22),
        paid: v(23),                // 입금액
        serviceTotal: v(24),        // ⑦ 당일 서비스 비용 합계
        vat: v(25),                 // ⑧ 부가세합계
        carryOver: v(26),           // ⑨ 전일 청구금 / 이월잔여금
        total: v(27),               // 총 청구금액
        result: v(28),              // 청구 / 영수 / 이월
        stores,
    };
}

function uploadSettleWorkbook(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const status = document.getElementById('settle-file-status');
    status.textContent = `"${file.name}" 읽는 중... (파일이 커서 몇 초 걸릴 수 있습니다)`;
    const reader = new FileReader();
    reader.onload = (evt) => {
        setTimeout(() => {
            try {
                const wb = XLSX.read(new Uint8Array(evt.target.result), { type: 'array', sheets: ['정산서DB'], dense: true });
                const ws = wb.Sheets['정산서DB'];
                if (!ws) throw new Error('"정산서DB" 시트가 없습니다. 정산청구서 파일이 맞는지 확인해주세요.');
                const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
                const head = aoa[0] || [];
                if (settleNorm(head[0]) !== settleNorm('상호(입금자명)') || !String(head[28] || '').includes('결과값')) {
                    throw new Error('정산서DB 시트의 머리글 순서가 예상과 다릅니다. (A열 상호, AC열 결과값)');
                }
                // 같은 날짜에 같은 상호가 두 번 있으면(정산서DB에 두 번 기록된 경우) 아래쪽(나중) 줄을 씁니다.
                // 나중 줄이 앞 줄을 '전일 청구금'으로 포함한 최종 금액인 경우가 대부분이고, 다음 정산의 이월 계산도 나중 줄 기준입니다.
                const byKey = new Map();
                settleExcelDuplicates = new Map();
                aoa.slice(1).forEach((r, idx) => {
                    if (!String(r[0] || '').trim()) return;
                    const data = settleRowToData(r);
                    if (!data.date) return;
                    data.seq = idx + 1;
                    const key = data.date + '|' + settleNorm(data.company);
                    const prev = byKey.get(key);
                    if (prev) {
                        const dups = settleExcelDuplicates.get(data.date) || [];
                        const d = dups.find(x => x.company === data.company);
                        if (d) d.totals.push(data.total); else dups.push({ company: data.company, totals: [prev.total, data.total] });
                        settleExcelDuplicates.set(data.date, dups);
                        data.seq = prev.seq; // 목록 순서는 처음 나온 자리 유지
                    }
                    byKey.set(key, data);
                });
                settleExcelRows = [...byKey.values()].sort((a, b) => a.seq - b.seq);
                settleExcelFileName = file.name;

                const dates = [...new Set(settleExcelRows.map(r => r.date))].sort();
                const latest = dates[dates.length - 1];
                document.getElementById('settle-date').value = latest || '';
                status.textContent = `"${file.name}" · 정산서 ${settleExcelRows.length.toLocaleString()}건 · 마지막 정산일 ${latest || '-'}`;
                loadSavedSettlements();
            } catch (err) {
                settleExcelRows = null;
                status.textContent = '';
                alert('정산청구서를 읽지 못했습니다.\n\n' + err.message);
            }
        }, 30);
    };
    reader.readAsArrayBuffer(file);
}

async function loadSavedSettlements() {
    const date = document.getElementById('settle-date').value;
    if (date !== settleCheckedDate) { settleChecked.clear(); settleCheckedDate = date; }
    settleSaved = [];
    if (date && supabaseClient && currentRole === 'admin') {
        const { data, error } = await supabaseClient.from('settlements')
            .select('id, token, company, settle_date, seq, total, result, data, sent_at, send_status, send_error')
            .eq('settle_date', date).order('seq');
        if (error) {
            alert('저장된 정산서를 불러오지 못했습니다.\n\n' + dbErrorMessage(error)
                + '\n\n(Supabase에서 supabase/settlement.sql 을 실행했는지 확인해주세요)');
        } else {
            settleSaved = data;
        }
    }
    renderSettleTable();
}

// 화면에 보여줄 목록: 엑셀을 올렸으면 엑셀 기준(저장 여부 표시), 아니면 저장된 정산서
function settleCurrentList() {
    const date = document.getElementById('settle-date').value;
    const savedBy = new Map(settleSaved.map(s => [s.company, s]));
    if (settleExcelRows) {
        const rows = settleExcelRows.filter(r => r.date === date);
        if (rows.length) {
            return rows.map(r => {
                const saved = savedBy.get(r.company);
                return {
                    company: r.company, total: r.total, result: r.result, data: r,
                    token: saved ? saved.token : null,
                    changed: saved ? settleStableJson(saved.data) !== settleStableJson(r) : false,
                    sent_at: saved ? saved.sent_at : null,
                    send_status: saved ? saved.send_status : null,
                    send_error: saved ? saved.send_error : null,
                };
            });
        }
    }
    return settleSaved.map(s => ({
        company: s.company, total: s.total, result: s.result, data: s.data, token: s.token, changed: false,
        sent_at: s.sent_at, send_status: s.send_status, send_error: s.send_error,
    }));
}

function renderSettleTable() {
    const tbody = document.getElementById('settle-list');
    if (!tbody) return;
    const list = settleCurrentList();
    const date = document.getElementById('settle-date').value;
    const unsaved = list.filter(r => !r.token || r.changed).length;
    const noPhone = list.filter(r => !settleContactPhone(r.company)).length;

    document.getElementById('settle-summary').innerHTML = list.length
        ? `<b>${escapeHtml(date)}</b> 정산 <b>${list.length}</b>곳 · 연락처 없음 <b class="${noPhone ? 'text-rose-600' : ''}">${noPhone}</b>곳`
          + (unsaved ? ` · <span class="text-amber-600 font-bold">저장 안 됨 ${unsaved}곳</span>` : ' · <span class="text-emerald-600 font-bold">모두 저장됨</span>')
          + settleDuplicateNotice(date)
        : (settleExcelRows ? '이 날짜의 정산서가 엑셀에 없습니다.' : '정산청구서 엑셀을 올리거나, 저장된 정산일을 고르세요.');
    document.getElementById('settle-save-btn').disabled = !settleExcelRows || !unsaved;
    document.getElementById('settle-test-btn').disabled = !list.some(r => r.token && !r.changed);

    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-slate-400">표시할 정산서가 없습니다.</td></tr>`;
        document.getElementById('settle-filter-count').textContent = '';
        settleUpdateCheckUI(list);
        return;
    }
    settleFillResultOptions(list);
    const shown = settleFilteredList(list);
    document.getElementById('settle-filter-count').textContent = `조회 ${shown.length}곳 / 전체 ${list.length}곳`;
    if (!shown.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-slate-400">조회 조건에 맞는 정산서가 없습니다.</td></tr>`;
        settleUpdateCheckUI(list);
        return;
    }
    tbody.innerHTML = shown.map(r => {
        const i = r.__seq - 1;   // 순번은 조회와 상관없이 원래 순서
        const phone = settleContactPhone(r.company);
        const state = !r.token ? '<span class="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-bold">저장 전</span>'
            : r.changed ? '<span class="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-bold">변경됨·다시 저장</span>'
            : r.sent_at ? `<span class="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold" title="${escapeHtml(new Date(r.sent_at).toLocaleString('ko-KR'))}">발송완료</span>`
            : r.send_status === '실패' ? `<span class="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 font-bold" title="${escapeHtml(r.send_error || '')}">발송실패</span><div class="text-[10px] text-rose-500 mt-0.5">${escapeHtml(r.send_error || '')}</div>`
            : '<span class="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-bold">링크 생성됨</span>';
        const resultColor = r.result === '청구' ? 'text-rose-600' : 'text-emerald-600';
        const checkable = settleCheckable(r);
        return `
        <tr class="hover:bg-slate-50 ${settleChecked.has(r.company) ? 'bg-amber-50/60' : ''}">
            <td class="p-2.5"><input type="checkbox" data-company="${escapeHtml(r.company)}" ${checkable ? '' : 'disabled title="저장한 뒤 선택할 수 있습니다"'}
                ${settleChecked.has(r.company) ? 'checked' : ''} onchange="toggleSettleCheck(this.dataset.company, this.checked)" class="w-4 h-4 align-middle cursor-pointer disabled:cursor-not-allowed"></td>
            <td class="p-2.5 text-slate-400">${i + 1}</td>
            <td class="p-2.5 font-bold">${escapeHtml(r.company)}</td>
            <td class="p-2.5 font-bold ${resultColor}">${escapeHtml(r.result || '')}</td>
            <td class="p-2.5 text-right font-bold">${settleWon(r.total)}</td>
            <td class="p-2.5">${phone ? escapeHtml(settlePhoneLabel(phone)) : '<span class="text-rose-500 font-bold">연락처 없음</span>'}</td>
            <td class="p-2.5">${state}</td>
            <td class="p-2.5 whitespace-nowrap">
                ${r.token ? `
                <a href="${escapeHtml(settleLink(r.token))}" target="_blank" class="px-2 py-1 text-[11px] font-bold text-indigo-600 hover:bg-indigo-50 rounded">보기</a>
                <button data-company="${escapeHtml(r.company)}" onclick="copySettleMessage(this.dataset.company)" class="px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-100 rounded">링크 복사</button>
                ${IS_PRODUCTION && !r.changed && phone && (r.sent_at || r.send_status === '실패') ? `<button data-company="${escapeHtml(r.company)}" onclick="resendSettlement(this.dataset.company)" class="px-2 py-1 text-[11px] font-bold text-amber-700 hover:bg-amber-50 rounded">다시 보내기</button>` : ''}`
                : `<button data-company="${escapeHtml(r.company)}" onclick="previewSettle(this.dataset.company)" class="px-2 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-100 rounded">미리보기</button>`}
            </td>
        </tr>`;
    }).join('');
    settleUpdateCheckUI(list);
}

async function saveSettlements() {
    const date = document.getElementById('settle-date').value;
    const list = settleCurrentList().filter(r => !r.token || r.changed);
    if (!list.length) return;
    if (!confirm(`${date} 정산서 ${list.length}곳을 저장하고 링크를 만듭니다. 계속할까요?`)) return;

    const now = new Date().toISOString();
    const payload = list.map(r => ({
        token: r.token || settleRandomToken(),
        company: r.company,
        settle_date: date,
        seq: r.data.seq,
        total: Number.isFinite(Number(r.total)) ? Number(r.total) : null,
        result: r.result,
        data: r.data,
        updated_at: now,
    }));
    const btn = document.getElementById('settle-save-btn');
    btn.disabled = true;
    const { error } = await supabaseClient.from('settlements').upsert(payload, { onConflict: 'company,settle_date' });
    if (error) {
        alert('저장 실패: ' + dbErrorMessage(error));
        btn.disabled = false;
        return;
    }
    await loadSavedSettlements();
    alert(`${payload.length}곳 저장 완료. 이제 [보기]로 확인하고 [링크 복사]로 보낼 수 있습니다.`);
}

// 연락처가 없거나 직접 보낼 때: 카톡에 바로 붙여넣을 안내문 + 링크 복사
async function copySettleMessage(company) {
    const r = settleCurrentList().find(x => x.company === company);
    if (!r || !r.token) return;
    const d = r.data || {};
    const lines = [
        `[밤낮딜리버리 정산 안내]`,
        `${company}님, ${settleShortDate(d.date || document.getElementById('settle-date').value)} 정산서를 안내드립니다.`,
        ``,
        `■ 정산결과: ${r.result || ''}`,
        `■ 청구금액: ${settleWon(r.total)}원`,
        d.account ? `■ 입금계좌: ${d.account}` : null,
        ``,
        `상세 정산서: ${settleLink(r.token)}`,
    ].filter(x => x !== null);
    try {
        await navigator.clipboard.writeText(lines.join('\n'));
        alert(`[${company}] 안내문과 링크를 복사했습니다. 카톡방에 붙여넣으세요.`);
    } catch (e) {
        prompt('아래 내용을 복사하세요 (Ctrl+C)', lines.join('\n'));
    }
}

// 저장 전 미리보기: 새 창에 정산서 화면을 그대로 띄움
function previewSettle(company) {
    const r = settleCurrentList().find(x => x.company === company);
    if (!r) return;
    try { localStorage.setItem('settlePreview', JSON.stringify({ company, settle_date: r.data.date, data: r.data })); } catch (e) { /* 무시 */ }
    window.open(`${SETTLE_PAGE_PATH}?preview=1`, '_blank');
}

// ---------------------------------------------------------------------
// 3. 알림톡 발송 (서버: worker/alimtalk.js, 솔라피)
// ---------------------------------------------------------------------
async function settleSendApi(payload) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) throw new Error('로그인이 필요합니다. 다시 로그인해 주세요.');
    const res = await fetch('/api/settle/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `발송 서버 오류 (HTTP ${res.status})`);
    return data;
}

function settleResultReport(data) {
    const failed = data.results.filter(r => r.status === 'failed');
    const skipped = data.results.filter(r => r.status === 'skipped');
    let msg = `발송 접수 ${data.summary.sent}곳`;
    if (failed.length) msg += `\n\n❌ 실패 ${failed.length}곳\n` + failed.map(r => `- ${r.company}: ${r.message}`).join('\n');
    if (skipped.length) msg += `\n\n⏭ 건너뜀 ${skipped.length}곳\n` + skipped.map(r => `- ${r.company}: ${r.message}`).join('\n');
    return msg;
}

async function sendSettlementsAlimtalk() {
    const date = document.getElementById('settle-date').value;
    const list = settleCurrentList();
    const plan = settleSendPlan(list);
    const targets = [...plan.fresh, ...plan.again];
    const filtered = settleFilteredList(list).length !== list.length;
    if (!targets.length) {
        alert(plan.selected ? '체크한 업체 중 보낼 수 있는 곳이 없습니다. (연락처 없음 / 저장 전)' : '보낼 정산서가 없습니다. (저장 전이거나, 이미 모두 발송했습니다)');
        return;
    }
    let msg = plan.selected
        ? `${date} 정산서를 체크한 ${targets.length}곳에만 알림톡으로 보냅니다.\n(${targets.slice(0, 5).map(r => r.company).join(', ')}${targets.length > 5 ? ` 외 ${targets.length - 5}곳` : ''})`
        : filtered ? `${date} 정산서를 지금 조회된 업체 중 ${targets.length}곳에 알림톡으로 보냅니다.`
        : `${date} 정산서를 ${targets.length}곳 전체에 알림톡으로 보냅니다.`;
    if (plan.again.length) msg += `\n· 이미 보낸 ${plan.again.length}곳(${plan.again.map(r => r.company).join(', ')})도 다시 보냅니다`;
    if (plan.noPhone.length) msg += `\n· 연락처 없는 ${plan.noPhone.length}곳은 건너뜁니다 ([링크 복사]로 따로 보내주세요)`;
    if (plan.unsaved) msg += `\n· 저장 안 된 ${plan.unsaved}곳은 보내지 않습니다`;
    if (!confirm(msg + '\n\n보낼까요?')) return;

    const btn = document.getElementById('settle-send-btn');
    btn.disabled = true;
    btn.lastChild.textContent = ' 보내는 중...';
    try {
        const data = await settleSendApi({ date, companies: targets.map(r => r.company), resend: plan.again.length > 0 });
        alert(settleResultReport(data));
        settleChecked.clear();
    } catch (err) {
        alert('발송하지 못했습니다.\n\n' + err.message);
    } finally {
        await loadSavedSettlements();
    }
}

async function resendSettlement(company) {
    const date = document.getElementById('settle-date').value;
    if (!confirm(`[${company}]에게 ${date} 정산서를 다시 보낼까요?`)) return;
    try {
        const data = await settleSendApi({ date, companies: [company], resend: true });
        alert(settleResultReport(data));
    } catch (err) {
        alert('발송하지 못했습니다.\n\n' + err.message);
    }
    await loadSavedSettlements();
}

// 시험 발송: 첫 번째 저장된 정산서 1건을 내 휴대폰으로만 보냄 (거래처에게는 안 감, 발송 기록도 안 남음)
async function sendSettlementTest() {
    const date = document.getElementById('settle-date').value;
    const list = settleCurrentList();
    const first = list.find(r => settleChecked.has(r.company) && r.token && !r.changed) || list.find(r => r.token && !r.changed);
    if (!first) { alert('먼저 [정산서 저장]을 해 주세요.'); return; }
    const raw = prompt(`시험으로 받을 휴대폰 번호를 입력하세요.\n([${first.company}] 정산서 내용으로 1건만 갑니다. 거래처에게는 가지 않습니다)`, '');
    if (raw === null) return;
    const phone = settlePhone(raw);
    if (!phone) { alert('휴대폰 번호 형식이 올바르지 않습니다.'); return; }
    try {
        const data = await settleSendApi({ date, companies: [first.company], testPhone: phone });
        const r = data.results[0];
        alert(r.status === 'sent' ? `시험 발송 접수 완료 (${r.to})\n잠시 후 카톡을 확인해 주세요.` : `시험 발송 실패\n\n${r.message}`);
    } catch (err) {
        alert('시험 발송하지 못했습니다.\n\n' + err.message);
    }
}

// ---------------------------------------------------------------------
// 4. 체크박스: 체크한 업체만 발송 (아무것도 체크 안 하면 전체 발송)
// ---------------------------------------------------------------------
function settleCheckable(r) { return !!(r.token && !r.changed); }

// 이번에 보낼 대상: 체크가 있으면 체크한 곳(이미 보낸 곳은 다시 보냄), 없으면 아직 안 보낸 전체
// (체크가 없으면 지금 [조회]로 보이는 업체만 대상)
function settleSendPlan(list) {
    const selected = list.some(r => settleChecked.has(r.company));
    const pool = selected ? list.filter(r => settleChecked.has(r.company)) : settleFilteredList(list);
    const ready = pool.filter(r => settleCheckable(r) && settleContactPhone(r.company));
    return {
        selected,
        fresh: ready.filter(r => !r.sent_at),
        again: selected ? ready.filter(r => r.sent_at) : [],
        noPhone: pool.filter(r => settleCheckable(r) && !settleContactPhone(r.company) && (selected || !r.sent_at)),
        unsaved: pool.filter(r => !settleCheckable(r)).length,
    };
}

function toggleSettleCheck(company, checked) {
    if (checked) settleChecked.add(company); else settleChecked.delete(company);
    renderSettleTable();
}

function toggleSettleCheckAll(checked) {
    settleChecked.clear();
    if (checked) settleFilteredList(settleCurrentList()).filter(settleCheckable).forEach(r => settleChecked.add(r.company));
    renderSettleTable();
}

// 빠른 체크: 지금 조회된 업체 중 발송완료(sent) / 미발송(unsent)만 체크
function checkSettleByState(which) {
    const rows = settleFilteredList(settleCurrentList()).filter(settleCheckable)
        .filter(r => (which === 'sent' ? !!r.sent_at : !r.sent_at));
    settleChecked.clear();
    rows.forEach(r => settleChecked.add(r.company));
    renderSettleTable();
    if (!rows.length) alert(which === 'sent' ? '조회된 업체 중 발송완료된 곳이 없습니다.' : '조회된 업체 중 미발송인 곳이 없습니다. (저장 전인 곳은 먼저 [정산서 저장]을 해주세요)');
}

// ---------------------------------------------------------------------
// 5. 조회: 상태 / 결과 / 연락처 / 상호 검색 / 정렬
// ---------------------------------------------------------------------
function settleStateKey(r) {
    if (!r.token || r.changed) return 'unsaved';
    if (r.sent_at) return 'sent';
    if (r.send_status === '실패') return 'failed';
    return 'ready';
}

function settleFilteredList(list) {
    const { status, result, phone, keyword, sort } = settleQuery;
    const kw = (keyword || '').trim().toLowerCase();
    const digits = kw.replace(/\D/g, '');
    const rows = list.map((r, i) => ({ ...r, __seq: i + 1 })).filter(r => {
        const st = settleStateKey(r);
        if (status === 'unsent' ? st === 'sent' : (status !== 'all' && st !== status)) return false;
        if (result !== 'all' && (r.result || '') !== result) return false;
        const p = settleContactPhone(r.company);
        if (phone === 'yes' && !p) return false;
        if (phone === 'no' && p) return false;
        if (kw) {
            const hit = String(r.company || '').toLowerCase().includes(kw)
                || (digits.length >= 3 && String(p || '').replace(/\D/g, '').includes(digits));
            if (!hit) return false;
        }
        return true;
    });
    if (sort === 'company') rows.sort((a, b) => String(a.company).localeCompare(String(b.company), 'ko'));
    else if (sort === 'total_desc') rows.sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));
    else if (sort === 'total_asc') rows.sort((a, b) => (Number(a.total) || 0) - (Number(b.total) || 0));
    return rows;
}

// 결과(청구 등) 선택지는 지금 정산일의 값으로 채웁니다.
function settleFillResultOptions(list) {
    const sel = document.getElementById('settle-f-result');
    if (!sel) return;
    const values = [...new Set(list.map(r => r.result || '').filter(Boolean))].sort();
    const current = sel.value;
    sel.innerHTML = '<option value="all">결과 전체</option>' + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    sel.value = values.includes(current) ? current : 'all';
}

function runSettleSearch() {
    settleQuery = {
        status: document.getElementById('settle-f-status').value,
        result: document.getElementById('settle-f-result').value,
        phone: document.getElementById('settle-f-phone').value,
        keyword: document.getElementById('settle-f-keyword').value,
        sort: document.getElementById('settle-f-sort').value,
    };
    renderSettleTable();
}

function resetSettleSearch() {
    document.getElementById('settle-f-status').value = 'all';
    document.getElementById('settle-f-result').value = 'all';
    document.getElementById('settle-f-phone').value = 'all';
    document.getElementById('settle-f-keyword').value = '';
    document.getElementById('settle-f-sort').value = 'seq';
    settleQuery = { ...SETTLE_QUERY_DEFAULT };
    renderSettleTable();
}

function settleUpdateCheckUI(list) {
    const checkable = list.filter(settleCheckable);
    for (const c of [...settleChecked]) if (!checkable.some(r => r.company === c)) settleChecked.delete(c);
    const all = document.getElementById('settle-check-all');
    if (all) {
        const shownCheckable = settleFilteredList(list).filter(settleCheckable);
        const shownChecked = shownCheckable.filter(r => settleChecked.has(r.company)).length;
        all.checked = shownCheckable.length > 0 && shownChecked === shownCheckable.length;
        all.indeterminate = shownChecked > 0 && shownChecked < shownCheckable.length;
        all.disabled = !shownCheckable.length;
    }
    const plan = settleSendPlan(list);
    const count = plan.fresh.length + plan.again.length;
    const btn = document.getElementById('settle-send-btn');
    btn.disabled = !IS_PRODUCTION || !count;
    const filtered = settleFilteredList(list).length !== list.length;
    btn.lastChild.textContent = plan.selected ? ` 선택 ${count}곳 발송` : ` 알림톡 발송 (${filtered ? '조회된' : '전체'} ${count}곳)`;
    btn.title = !IS_PRODUCTION ? '테스트 사이트에서는 실제 거래처에게 보낼 수 없습니다 (시험 발송만 가능)'
        : count ? (plan.selected ? '체크한 업체에만 보냅니다' : '아직 안 보낸 업체 전체에 보냅니다. 일부만 보내려면 왼쪽 칸을 체크하세요')
        : '보낼 정산서가 없습니다';
}

// 같은 날 같은 상호가 엑셀에 두 번 이상 있을 때 안내 (마지막 줄 금액을 사용)
function settleDuplicateNotice(date) {
    const dups = settleExcelRows ? (settleExcelDuplicates.get(date) || []) : [];
    if (!dups.length) return '';
    const text = dups.map(d => `${d.company}(${d.totals.map(settleWon).join(' → ')}원)`).join(', ');
    return `<div class="mt-1 text-amber-700 font-bold">⚠ 정산서DB에 같은 날 두 번 기록된 상호 ${dups.length}곳: ${escapeHtml(text)} — 마지막 줄 금액으로 저장합니다. 엑셀에서 금액이 맞는지 확인해 주세요.</div>`;
}
