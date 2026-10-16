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
let settleSaved = [];             // 선택한 정산일의 저장된 정산서
let settleLoadedTab = false;

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
                settleExcelRows = [];
                aoa.slice(1).forEach((r, idx) => {
                    if (!String(r[0] || '').trim()) return;
                    const data = settleRowToData(r);
                    if (!data.date) return;
                    data.seq = idx + 1;
                    settleExcelRows.push(data);
                });
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
    settleSaved = [];
    if (date && supabaseClient && currentRole === 'admin') {
        const { data, error } = await supabaseClient.from('settlements')
            .select('id, token, company, settle_date, seq, total, result, data, sent_at, send_status')
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
                };
            });
        }
    }
    return settleSaved.map(s => ({ company: s.company, total: s.total, result: s.result, data: s.data, token: s.token, changed: false, sent_at: s.sent_at }));
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
        : (settleExcelRows ? '이 날짜의 정산서가 엑셀에 없습니다.' : '정산청구서 엑셀을 올리거나, 저장된 정산일을 고르세요.');
    document.getElementById('settle-save-btn').disabled = !settleExcelRows || !unsaved;

    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400">표시할 정산서가 없습니다.</td></tr>`;
        return;
    }
    tbody.innerHTML = list.map((r, i) => {
        const phone = settleContactPhone(r.company);
        const state = !r.token ? '<span class="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-bold">저장 전</span>'
            : r.changed ? '<span class="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-bold">변경됨·다시 저장</span>'
            : r.sent_at ? '<span class="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold">발송완료</span>'
            : '<span class="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-bold">링크 생성됨</span>';
        const resultColor = r.result === '청구' ? 'text-rose-600' : 'text-emerald-600';
        return `
        <tr class="hover:bg-slate-50">
            <td class="p-2.5 text-slate-400">${i + 1}</td>
            <td class="p-2.5 font-bold">${escapeHtml(r.company)}</td>
            <td class="p-2.5 font-bold ${resultColor}">${escapeHtml(r.result || '')}</td>
            <td class="p-2.5 text-right font-bold">${settleWon(r.total)}</td>
            <td class="p-2.5">${phone ? escapeHtml(settlePhoneLabel(phone)) : '<span class="text-rose-500 font-bold">연락처 없음</span>'}</td>
            <td class="p-2.5">${state}</td>
            <td class="p-2.5 whitespace-nowrap">
                ${r.token ? `
                <a href="${escapeHtml(settleLink(r.token))}" target="_blank" class="px-2 py-1 text-[11px] font-bold text-indigo-600 hover:bg-indigo-50 rounded">보기</a>
                <button data-company="${escapeHtml(r.company)}" onclick="copySettleMessage(this.dataset.company)" class="px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-100 rounded">링크 복사</button>`
                : `<button data-company="${escapeHtml(r.company)}" onclick="previewSettle(this.dataset.company)" class="px-2 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-100 rounded">미리보기</button>`}
            </td>
        </tr>`;
    }).join('');
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
