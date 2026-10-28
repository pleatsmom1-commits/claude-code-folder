// =====================================================================
// 관리자 > 운송장 전송
//  - 출고/미출고/부분출고 송장 엑셀(송화인 · 수화인명 · 운송장번호 · 상품명 · 부피추가비용)을 올리면
//    업체(상호)별로 운송장 목록을 만들어 저장하고(supabase/shipping.sql), 업체마다 확인 링크(/ship?t=...)를 만듭니다.
//  - 체크한 업체만 골라 "운송장정보가 전달되었습니다 + 출고 N건" 알림을 보냅니다 (worker/shipping.js).
//  - 출고건수 = 서로 다른 송장번호 개수 (같은 송장으로 합포장된 상품은 1건, '미출고'는 빼고 셈)
//  index.html 의 supabaseClient, escapeHtml, dbErrorMessage, sellerProfiles 와
//  settle-admin.js 의 settleNorm, settlePhone, settleContacts 등 공통 함수를 사용합니다.
// =====================================================================

const SHIP_PAGE_PATH = '/ship';
const SHIP_STORE_SENDER = '밤낮딜리버리';   // 송화인이 이 이름뿐이면 매장으로 보내는 건 (수화인 = 업체)

let shipExcel = null;          // 엑셀에서 읽은 업체별 묶음 { company: {company, items, ...} }
let shipExcelFileName = '';
let shipExcelWarnings = [];
let shipSaved = [];            // 선택한 출고일에 저장된 운송장 (shipments)
let shipChecked = new Set();
let shipLoadedTab = false;
let shipReady = true;          // shipping.sql 을 실행하지 않았으면 false

function shipLink(token) { return `${location.origin}${SHIP_PAGE_PATH}?t=${token}`; }

function onShipTabOpened() {
    if (shipLoadedTab) return;
    shipLoadedTab = true;
    const dateInput = document.getElementById('ship-date');
    if (!dateInput.value) dateInput.value = settleDateKey(new Date());
    if (!settleContacts.length) fetchSettleContacts().then(renderShipTable);
    loadSavedShipments();
}

// 정산서 발송 탭의 거래처 연락처 → 없으면 회원가입 연락처
function shipContactPhone(company) {
    const phone = settleContactPhone(company);
    if (phone) return phone;
    const key = settleNorm(company);
    const p = (typeof sellerProfiles !== 'undefined' ? sellerProfiles : []).find(x => settleNorm(x.company) === key);
    return p ? settlePhone(p.phone) : null;
}

// 이미 알고 있는 상호 (연락처 · 회원가입 · 이 엑셀의 송화인 괄호 안 상호)
function shipKnownCompanies(extra = []) {
    const set = new Set(extra.map(settleNorm));
    settleContacts.forEach(c => set.add(settleNorm(c.company)));
    (typeof sellerProfiles !== 'undefined' ? sellerProfiles : []).forEach(p => set.add(settleNorm(p.company)));
    return set;
}

// 운송장번호 칸: '6082251369497' → 출고, '6082251369522/부출' → 부분출고, '미출고' 또는 번호 없음 → 미출고
function shipParseTracking(value) {
    const raw = String(value ?? '').trim();
    const m = raw.replace(/[\s-]/g, '').match(/\d{8,}/);
    if (!m) return { tracking: '', state: '미출고', raw };
    return { tracking: m[0], state: /부출|부분/.test(raw) ? '부분출고' : '출고', raw };
}

// 송장 엑셀 → 업체별 묶음
function shipParseRows(aoa) {
    const headIdx = aoa.findIndex(r => r.some(c => /송화인/.test(String(c))) && r.some(c => /송장/.test(String(c))));
    if (headIdx < 0) throw new Error('머리글(송화인 · 수화인명 · 운송장번호 · 상품명)을 찾지 못했습니다.');
    const head = aoa[headIdx].map(c => String(c ?? '').replace(/\s+/g, ''));
    const col = re => head.findIndex(h => re.test(h));
    const c = { sender: col(/송화인|보내는/), recipient: col(/수화인|받는|수취인/), tracking: col(/송장/), product: col(/상품/), fee: col(/부피|추가비용/) };
    if (c.sender < 0 || c.recipient < 0 || c.tracking < 0) throw new Error('송화인 / 수화인명 / 운송장번호 열이 모두 있어야 합니다.');

    const rows = aoa.slice(headIdx + 1).map((r, i) => ({ r, line: headIdx + i + 2 }))
        .filter(({ r }) => String(r[c.sender] ?? '').trim() || String(r[c.recipient] ?? '').trim());
    const inParens = rows.map(({ r }) => (String(r[c.sender] ?? '').trim().match(/^밤낮딜리버리\s*\((.+)\)\s*$/) || [])[1]).filter(Boolean);
    const known = shipKnownCompanies(inParens);
    const groups = {};
    const warnings = [];
    for (const { r, line } of rows) {
        const sender = String(r[c.sender] ?? '').trim();
        const recipient = String(r[c.recipient] ?? '').trim();
        const m = sender.match(/^밤낮딜리버리\s*\((.+)\)\s*$/);
        let company = m ? m[1].trim() : sender;
        let store = false;
        if (sender.replace(/\s/g, '') === SHIP_STORE_SENDER) {
            // 매장으로 보내는 건: 수화인이 업체. '유어피치(눈타이드)'처럼 괄호가 있으면 아는 상호 쪽으로
            store = true;
            const pm = recipient.match(/^(.+?)\s*\((.+)\)\s*$/);
            const options = pm ? [recipient, pm[2], pm[1]] : [recipient];
            company = options.find(o => known.has(settleNorm(o))) || recipient;
        }
        if (!company) { warnings.push(`${line}행: 업체를 알 수 없음`); continue; }
        const t = shipParseTracking(r[c.tracking]);
        if (t.state === '미출고' && t.raw && !/미출고/.test(t.raw)) warnings.push(`${line}행 [${company}] 운송장번호 "${t.raw}" 를 읽지 못해 미출고로 넣었습니다`);
        const fee = c.fee >= 0 ? Number(String(r[c.fee] ?? '').replace(/[^\d.-]/g, '')) || 0 : 0;
        const g = groups[company] = groups[company] || { company, items: [] };
        g.items.push({ recipient, tracking: t.tracking, state: t.state, product: String(r[c.product] ?? '').trim(), fee, store });
    }
    Object.values(groups).forEach(g => Object.assign(g, shipCounts(g.items)));
    return { groups, warnings, rows: rows.length };
}

function shipCounts(items) {
    return {
        parcel_count: new Set(items.filter(x => x.tracking).map(x => x.tracking)).size,
        unshipped_count: items.filter(x => !x.tracking).length,
        partial_count: new Set(items.filter(x => x.state === '부분출고').map(x => x.tracking)).size,
        extra_fee: items.reduce((s, x) => s + (Number(x.fee) || 0), 0),
    };
}

function uploadShipWorkbook(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
        try {
            const wb = XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
            const parsed = shipParseRows(aoa);
            shipExcel = parsed.groups;
            shipExcelWarnings = parsed.warnings;
            shipExcelFileName = file.name;
            document.getElementById('ship-file-status').textContent = `"${file.name}" · ${parsed.rows}줄 · 업체 ${Object.keys(shipExcel).length}곳`;
            shipChecked.clear();
            renderShipTable();
            if (parsed.warnings.length) alert('확인이 필요한 줄이 있습니다.\n\n' + parsed.warnings.slice(0, 12).join('\n') + (parsed.warnings.length > 12 ? `\n… 외 ${parsed.warnings.length - 12}줄` : ''));
        } catch (err) {
            shipExcel = null;
            alert('송장 엑셀을 읽지 못했습니다.\n\n' + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
}

async function loadSavedShipments() {
    const date = document.getElementById('ship-date').value;
    shipSaved = [];
    if (!supabaseClient || !date) { renderShipTable(); return; }
    const { data, error } = await supabaseClient.from('shipments').select('*').eq('ship_date', date).order('company');
    if (error) {
        shipReady = false;
        document.getElementById('ship-summary').innerHTML = '<span class="text-rose-600 font-bold">운송장 저장 표가 없습니다. Supabase 에서 shipping.sql 을 먼저 실행해 주세요.</span>';
        renderShipTable();
        return;
    }
    shipReady = true;
    shipSaved = (data || []).map(settleApplyStale);
    renderShipTable();
}

// 엑셀(이번에 올린 것) + 저장된 것을 합친 목록
function shipCurrentList() {
    const saved = new Map(shipSaved.map(s => [s.company, s]));
    const list = [];
    if (shipExcel) {
        for (const g of Object.values(shipExcel)) {
            const s = saved.get(g.company);
            const changed = !s || settleStableJson(s.items) !== settleStableJson(g.items);
            list.push({ ...(s || {}), ...g, saved: s || null, changed });
            saved.delete(g.company);
        }
    }
    for (const s of saved.values()) list.push({ ...s, partial_count: shipCounts(s.items || []).partial_count, saved: s, changed: false, notInExcel: !!shipExcel });
    return list.sort((a, b) => a.company.localeCompare(b.company, 'ko'));
}

function shipStateHtml(r) {
    if (!r.saved) return '<span class="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-bold">저장 전</span>';
    if (r.changed) return '<span class="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-bold" title="저장된 내용과 이번 엑셀이 다릅니다">바뀜·다시 저장</span>';
    if (r.sent_at) return `<span class="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold">발송완료</span><div class="text-[10px] text-slate-400 mt-0.5">${escapeHtml(settleSentTime(r.sent_at))}</div>`;
    if (r.stale_sent_at) return `<span class="px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 font-bold" title="보낸 뒤 운송장 내용이 바뀌어 다시 저장됐습니다">수정됨·미발송</span><div class="text-[10px] text-slate-400 mt-0.5">이전 발송 ${escapeHtml(settleSentTime(r.stale_sent_at))}</div>`;
    if (r.send_status === '실패') return `<span class="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 font-bold">발송실패</span><div class="text-[10px] text-rose-500 mt-0.5">${escapeHtml(r.send_error || '')}</div>`;
    return '<span class="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-bold">미발송</span>';
}

function shipCheckable(r) { return !!(r.saved && !r.changed); }

function renderShipTable() {
    const tbody = document.getElementById('ship-list');
    if (!tbody) return;
    const list = shipCurrentList();
    const date = document.getElementById('ship-date').value;
    const unsaved = list.filter(r => r.changed).length;
    const parcels = list.reduce((s, r) => s + (r.parcel_count || 0), 0);
    const unshipped = list.reduce((s, r) => s + (r.unshipped_count || 0), 0);
    const sent = list.filter(r => r.sent_at && !r.changed).length;
    if (shipReady) {
        document.getElementById('ship-summary').innerHTML = list.length
            ? `<b>${escapeHtml(date)}</b> 업체 <b>${list.length}</b>곳 · 출고 <b>${parcels}</b>건 · 미출고 <b class="${unshipped ? 'text-orange-600' : ''}">${unshipped}</b>개 · 발송완료 <b class="text-emerald-600">${sent}</b>곳`
              + (unsaved ? ` · <span class="text-amber-600 font-bold">저장 안 됨 ${unsaved}곳</span>` : '')
            : '송장 엑셀을 올리거나, 저장된 출고일을 고르세요.';
    }
    document.getElementById('ship-save-btn').disabled = !shipReady || !unsaved;
    document.getElementById('ship-checked-count').textContent = shipChecked.size ? `체크 ${shipChecked.size}곳` : '';
    document.getElementById('ship-warnings').innerHTML = shipExcelWarnings.length
        ? `⚠️ 확인이 필요한 줄 ${shipExcelWarnings.length}개: ${shipExcelWarnings.slice(0, 5).map(escapeHtml).join(' / ')}${shipExcelWarnings.length > 5 ? ' …' : ''}` : '';

    if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="10" class="p-8 text-center text-slate-400">표시할 운송장이 없습니다.</td></tr>';
        return;
    }
    tbody.innerHTML = list.map(r => {
        const phone = shipContactPhone(r.company);
        const checkable = shipCheckable(r);
        const c = escapeHtml(r.company);
        return `
        <tr class="hover:bg-slate-50 ${shipChecked.has(r.company) ? 'bg-amber-50/60' : ''}">
            <td class="p-2.5"><input type="checkbox" data-company="${c}" ${checkable ? '' : 'disabled title="저장한 뒤 선택할 수 있습니다"'} ${shipChecked.has(r.company) ? 'checked' : ''}
                onchange="toggleShipCheck(this.dataset.company, this.checked)" class="w-4 h-4 align-middle cursor-pointer disabled:cursor-not-allowed"></td>
            <td class="p-2.5 font-bold">${c}${r.notInExcel ? '<span class="ml-1 text-[10px] text-slate-400 font-normal">(이번 엑셀에 없음)</span>' : ''}</td>
            <td class="p-2.5 text-right font-black text-indigo-700">${r.parcel_count || 0}건</td>
            <td class="p-2.5 text-right">${(r.items || []).length}개</td>
            <td class="p-2.5 text-right ${r.unshipped_count ? 'text-orange-600 font-bold' : 'text-slate-300'}">${r.unshipped_count || 0}</td>
            <td class="p-2.5 text-right ${r.partial_count ? 'text-orange-600 font-bold' : 'text-slate-300'}">${r.partial_count || 0}</td>
            <td class="p-2.5 text-right ${r.extra_fee ? 'font-bold' : 'text-slate-300'}">${Number(r.extra_fee || 0).toLocaleString('ko-KR')}</td>
            <td class="p-2.5">${phone ? escapeHtml(settlePhoneLabel(phone)) : '<span class="text-rose-500 font-bold">연락처 없음</span>'}</td>
            <td class="p-2.5">${shipStateHtml(r)}</td>
            <td class="p-2.5 whitespace-nowrap">
                <button data-company="${c}" onclick="previewShip(this.dataset.company)" class="px-2 py-1 text-[11px] font-bold text-indigo-600 hover:bg-indigo-50 rounded">보기</button>
                ${checkable ? `<button data-company="${c}" onclick="copyShipMessage(this.dataset.company)" class="px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-100 rounded" title="단톡방에 붙여넣을 안내문과 링크를 복사합니다">단톡방용 문구 복사</button>` : ''}
            </td>
        </tr>`;
    }).join('');
}

function toggleShipCheck(company, checked) {
    if (checked) shipChecked.add(company); else shipChecked.delete(company);
    renderShipTable();
}

function checkShipByState(which) {
    shipChecked.clear();
    shipCurrentList().filter(shipCheckable).filter(r => which === 'all' || !r.sent_at).forEach(r => shipChecked.add(r.company));
    renderShipTable();
}

function clearShipChecks() { shipChecked.clear(); renderShipTable(); }

async function saveShipments() {
    const date = document.getElementById('ship-date').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { alert('출고일을 먼저 골라 주세요.'); return; }
    const list = shipCurrentList().filter(r => r.changed);
    if (!list.length) return;
    const resent = list.filter(r => r.saved && (r.saved.sent_at || r.saved.stale_sent_at));
    if (!confirm(`${date} 운송장 ${list.length}곳을 저장합니다.` + (resent.length ? `\n\n이미 보낸 ${resent.length}곳(${resent.map(r => r.company).join(', ')})은 내용이 바뀌어 '수정됨·미발송'이 됩니다.` : '') + '\n\n계속할까요?')) return;
    const now = new Date().toISOString();
    const payload = list.map(r => ({
        token: (r.saved && r.saved.token) || settleRandomToken(),
        company: r.company,
        ship_date: date,
        items: r.items,
        parcel_count: r.parcel_count,
        unshipped_count: r.unshipped_count,
        extra_fee: r.extra_fee,
        updated_at: now,
    }));
    const btn = document.getElementById('ship-save-btn');
    btn.disabled = true;
    const { error } = await supabaseClient.from('shipments').upsert(payload, { onConflict: 'company,ship_date' });
    if (error) { alert('저장 실패: ' + dbErrorMessage(error)); btn.disabled = false; return; }
    await loadSavedShipments();
    alert(`${payload.length}곳 저장 완료. 보낼 업체를 체크하고 [선택 업체 발송]을 눌러 주세요.`);
}

function shipMessageText(r) {
    const [, m, d] = String(r.ship_date || document.getElementById('ship-date').value).split('-');
    return [
        `[밤낮딜리버리] ${r.company}님, ${Number(m)}월 ${Number(d)}일 운송장정보가 전달되었습니다.`,
        `출고건수: ${r.parcel_count || 0}건` + (r.unshipped_count ? ` (미출고 ${r.unshipped_count}개 상품)` : ''),
        '',
        `운송장 확인: ${shipLink(r.token)}`,
    ].join('\n');
}

async function copyShipMessage(company) {
    const r = shipCurrentList().find(x => x.company === company);
    if (!r || !r.token) return;
    const text = shipMessageText(r);
    try {
        await navigator.clipboard.writeText(text);
        alert(`[${company}] 안내문과 링크를 복사했습니다. 단톡방에 붙여넣으세요.`);
    } catch (e) {
        prompt('아래 내용을 복사하세요 (Ctrl+C)', text);
    }
}

function previewShip(company) {
    const r = shipCurrentList().find(x => x.company === company);
    if (!r) return;
    if (r.token && !r.changed) { window.open(shipLink(r.token), '_blank'); return; }
    try { localStorage.setItem('shipPreview', JSON.stringify({ company, ship_date: document.getElementById('ship-date').value, items: r.items, parcel_count: r.parcel_count, unshipped_count: r.unshipped_count, extra_fee: r.extra_fee })); } catch (e) { /* 무시 */ }
    window.open(`${SHIP_PAGE_PATH}?preview=1`, '_blank');
}

async function sendShipments() {
    const date = document.getElementById('ship-date').value;
    const list = shipCurrentList().filter(r => shipChecked.has(r.company) && shipCheckable(r));
    if (!list.length) { alert('보낼 업체를 체크해 주세요. (저장한 업체만 체크할 수 있습니다)'); return; }
    if (!IS_PRODUCTION) { alert('테스트 사이트에서는 업체에게 보낼 수 없습니다. [시험 발송 (내 번호)]로 확인해 주세요.'); return; }
    const withPhone = list.filter(r => shipContactPhone(r.company));
    const noPhone = list.filter(r => !shipContactPhone(r.company));
    const again = withPhone.filter(r => r.sent_at);
    if (!withPhone.length) { alert('체크한 업체 모두 연락처가 없습니다. [단톡방용 문구 복사]로 보내 주세요.'); return; }
    let msg = `${date} 운송장 안내를 ${withPhone.length}곳에 보냅니다.\n(${withPhone.slice(0, 6).map(r => r.company).join(', ')}${withPhone.length > 6 ? ` 외 ${withPhone.length - 6}곳` : ''})`;
    if (again.length) msg += `\n· 이미 보낸 ${again.length}곳도 다시 보냅니다`;
    if (noPhone.length) msg += `\n· 연락처 없는 ${noPhone.length}곳(${noPhone.map(r => r.company).join(', ')})은 건너뜁니다`;
    if (!confirm(msg + '\n\n보낼까요?')) return;
    const btn = document.getElementById('ship-send-btn');
    btn.disabled = true;
    try {
        const data = await settleSendInChunks(withPhone.map(r => r.company), { date, resend: true },
            (done, total) => { btn.lastChild.textContent = ` 보내는 중 ${done}/${total}`; }, '/api/ship/send');
        alert(settleResultReport(data));
        shipChecked.clear();
    } finally {
        btn.disabled = false;
        btn.lastChild.textContent = ' 선택 업체 발송';
        await loadSavedShipments();
    }
}

async function sendShipTest() {
    const date = document.getElementById('ship-date').value;
    const list = shipCurrentList();
    const first = list.find(r => shipChecked.has(r.company) && shipCheckable(r)) || list.find(shipCheckable);
    if (!first) { alert('먼저 [저장]을 해 주세요.'); return; }
    const raw = prompt(`시험으로 받을 휴대폰 번호를 입력하세요.\n([${first.company}] 내용으로 1건만 갑니다. 업체에게는 가지 않습니다)`, '');
    if (raw === null) return;
    const phone = settlePhone(raw);
    if (!phone) { alert('휴대폰 번호 형식이 올바르지 않습니다.'); return; }
    try {
        const data = await settleSendApi({ date, companies: [first.company], testPhone: phone }, '/api/ship/send');
        const r = data.results[0];
        alert(r.status === 'sent' ? `시험 발송 접수 완료 (${r.to})\n잠시 후 휴대폰을 확인해 주세요.` : `시험 발송 실패\n\n${r.message}`);
    } catch (err) {
        alert('시험 발송하지 못했습니다.\n\n' + err.message);
    }
}
