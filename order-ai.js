// =====================================================================
// 쇼핑몰 주문서 그대로 올리기 (셀러 화면 · 재고관리 v2 5단계)
//  1) 셀러가 쇼핑몰에서 받은 주문서 엑셀을 그대로 올림
//  2) 맨 위 몇 줄(연락처 일부 가림)만 /api/order-ai 로 보내 AI 가 칸 구성을 알아냄 (같은 양식은 저장된 정보로 AI 없이)
//  3) 확인표: 받는분·연락처·주소·상품·도매처 + 우리 상품관리 매칭·재고. 출고에 필요한 칸이 비면 접수 막음.
//     (합)은 같은 받는분 주문 중 부분출고를 원하지 않을 때만 셀러가 체크
//  4) [이대로 주문접수] → 기존 엑셀 일괄 등록과 같은 규칙으로 풀필먼트 주문 저장
//     보내는사람 = 밤낮딜리버리(상호), C/S 연락처 = 직전 풀필먼트 접수 번호 → 없으면 가입 연락처
// index.html 의 전역 값(supabaseClient, currentSellerAccount, ordersMaster …)을 그대로 씁니다.
// =====================================================================
let aiOrder = { fileName: '', sheetName: '', platform: '', rows: [], products: null, stock: new Map() };

const AI_FIELD_LABEL = { recipient: '받는분', phone: '연락처', address: '주소', product: '상품명', option: '옵션', qty: '수량', memo: '배송메세지' };
const aiEsc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const aiNorm = v => String(v ?? '').replace(/\s+/g, '').toLowerCase();
const aiCell = v => (v === undefined || v === null) ? '' : String(v).trim();

function aiDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('ai-drop-zone').classList.remove('border-indigo-500', 'bg-indigo-50');
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (files.length !== 1) { alert('주문서 파일은 한 번에 1개씩 올려주세요.'); return; }
    aiFileChosen({ target: { files, value: '' } });
}

async function aiFileChosen(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!canAddOrders()) { alert('관리자 승인 전이거나 이용이 정지된 계정은 주문을 등록할 수 없습니다.'); return; }
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { alert('엑셀 파일(.xlsx, .xls, .csv)만 올릴 수 있습니다.'); return; }
    aiStatus('📄 주문서를 읽는 중…');
    let rows;
    try {
        rows = await aiReadSheet(file);
    } catch (err) {
        console.error(err);
        const locked = /password|encrypt|protected|CFB/i.test(String(err && err.message));
        aiStatus(locked
            ? '🔒 비밀번호가 걸린 파일이라 읽을 수 없어요. 엑셀에서 파일을 열고 [다른 이름으로 저장] 할 때 비밀번호를 지운 뒤 다시 올려 주세요.'
            : '파일을 읽지 못했어요. 엑셀에서 열리는 파일인지 확인해 주세요.', true);
        return;
    }
    if (rows.length < 2) { aiStatus('주문서에 읽을 내용이 없어요.', true); return; }

    // 제목줄 후보: 맨 위 10줄 중 글자 칸이 가장 많은 줄 (같은 쇼핑몰 양식이면 늘 같은 줄 → 저장된 칸 정보를 다시 씀)
    let cand = 0, best = -1;
    rows.slice(0, 10).forEach((r, i) => {
        const n = (r || []).filter(c => aiCell(c) && isNaN(Number(c))).length;
        if (n > best) { best = n; cand = i; }
    });
    const signature = (rows[cand] || []).map(c => aiNorm(c)).join('|');
    const sample = rows.slice(0, Math.min(rows.length, cand + 4, 10)).map((r, i) => (r || []).map(c => i === cand ? aiCell(c) : aiMask(c)));

    aiStatus('🤖 AI 가 주문서 칸(받는분·주소·연락처·상품…)을 확인하는 중… (처음 보는 양식은 10초 정도 걸려요)');
    let res = await aiAskMapping({ signature, rows: sample, file_name: file.name });
    if (res.error) { aiStatus('❌ ' + res.error, true); return; }

    await aiLoadProducts();
    aiOrder.fileName = file.name;
    // 저장된 칸 정보의 제목줄 위치가 이번 파일과 다를 수 있음(같은 양식이라도 위쪽 안내줄 수가 다른 경우)
    // → 저장된 위치로 못 읽으면 이번 파일의 제목줄(cand)로 다시 읽고, 그래도 안 되면 AI 에 새로 물어봄
    let built = aiBuildRows(rows, res.mapping);
    if (built.length === 0 && res.mapping.header_row !== cand) built = aiBuildRows(rows, { ...res.mapping, header_row: cand });
    if (built.length === 0 && res.cached) {
        const fresh = await aiAskMapping({ signature, rows: sample, file_name: file.name, fresh: true });
        if (!fresh.error) { res = fresh; built = aiBuildRows(rows, res.mapping); }
    }
    aiOrder.platform = res.platform || '';
    aiOrder.rows = built;
    if (aiOrder.rows.length === 0) { aiStatus('주문서에서 주문 줄을 찾지 못했어요. 받는분·주소·상품명 칸이 있는 주문서인지 확인해 주세요.', true); return; }
    aiStatus('');
    aiRender();
}

// /api/order-ai 에 칸 구성 묻기. fresh: true 면 저장된 칸 정보를 쓰지 않고 AI 에 새로 물어봄
async function aiAskMapping(payload) {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const r = await fetch('/api/order-ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
            body: JSON.stringify(payload),
        });
        const res = await r.json().catch(() => ({ error: `서버 응답 오류 (HTTP ${r.status})` }));
        if (!r.ok && !res.error) res.error = `서버 응답 오류 (HTTP ${r.status})`;
        if (!res.error && !(res.mapping && res.mapping.columns)) res.error = '주문서의 칸 구성을 알아내지 못했어요.';
        return res;
    } catch (err) {
        return { error: '인터넷 연결을 확인해 주세요.' };
    }
}

// 엑셀·CSV → 2차원 배열. CSV 는 한글이 깨지지 않게 UTF-8 → 안 되면 EUC-KR 로 읽음
async function aiReadSheet(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    let wb;
    if (/\.csv$/i.test(file.name)) {
        let text = new TextDecoder('utf-8').decode(buf);
        if (text.includes('�')) text = new TextDecoder('euc-kr').decode(buf);
        wb = XLSX.read(text, { type: 'string', raw: true });
    } else {
        wb = XLSX.read(buf, { type: 'array' });
    }
    // 시트가 여러 개면 "진짜 주문서" 시트를 고름 (작성안내·예시 시트는 피함) → aiPickSheet
    const picked = aiPickSheet(wb);
    aiOrder.sheetName = wb.SheetNames.length > 1 ? picked.name : '';
    return picked.rows;
}

// 주문서 시트 고르기
//  1) 맨 위 10줄 안에 받는분·주소·상품명 같은 제목줄이 있는 시트만 후보 (제목 글자 2개 이상)
//  2) 예시·작성안내 시트는 뒤로: 시트 이름에 안내/예시/샘플/작성방법/설명 이 있거나,
//     칸 안에 "작성예시", "예시)", "홍길동" 같은 예시 표시가 있으면 예시 시트로 봄
//  3) 남은 것 중 제목줄 아래 주문 줄이 가장 많은 시트
const AI_HEAD = /수취인|수령인|수화인|받는\s*(분|사람)|받으시는|배송지|주소|상품명|옵션|수량|연락처|전화|휴대폰/;
const AI_GUIDE_NAME = /안내|예시|샘플|작성\s*방법|작성법|설명|sample|example|guide/i;
const AI_GUIDE_CELL = /작성\s*예시|예시\s*\)|^예\)|홍길동|\(예시\)|샘플/;
function aiPickSheet(wb) {
    let best = null;
    for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false });
        let headIdx = -1, head = 0;
        rows.slice(0, 10).forEach((x, i) => {
            const n = (x || []).filter(c => { const t = aiCell(c); return t.length <= 40 && AI_HEAD.test(t); }).length;
            if (n > head) { head = n; headIdx = i; }
        });
        const data = headIdx < 0 ? 0 : rows.slice(headIdx + 1).filter(x => (x || []).filter(c => aiCell(c)).length >= 3).length;
        const guide = AI_GUIDE_NAME.test(name) || rows.some(x => (x || []).some(c => AI_GUIDE_CELL.test(aiCell(c))));
        // 점수: 제목줄 있음 > 예시 시트 아님 > 제목 글자 수(주문서다움) > 주문 줄 수 > (같으면 앞 시트)
        const score = (head >= 2 ? 1e9 : 0) + (guide ? 0 : 5e8) + Math.min(head, 10) * 1e6 + Math.min(data, 1e6 - 1) + (head >= 2 ? 0 : Math.min(rows.length, 1e5) / 1e6);
        if (!best || score > best.score) best = { name, rows, score };
    }
    return best || { name: '', rows: [] };
}

// AI 에 보내는 줄의 개인정보 가리기: 숫자가 많은 칸(연락처·주문번호)은 앞 3자리만, 긴 칸은 앞부분만
function aiMask(v) {
    let s = aiCell(v);
    if ((s.match(/\d/g) || []).length >= 7) { let k = 0; s = s.replace(/\d/g, d => (++k <= 3 ? d : '*')); }
    if (/^[가-힣]{2,4}$/.test(s)) s = s[0] + '*'.repeat(s.length - 1);
    return s.slice(0, 15);
}

function aiBuildRows(rows, mapping) {
    const c = mapping.columns, at = (r, k) => (c[k] >= 0 ? aiCell(r[c[k]]) : '');
    const out = [];
    for (let i = mapping.header_row + 1; i < rows.length; i++) {
        const r = rows[i] || [];
        const recipient = at(r, 'recipient'), product = at(r, 'product');
        let address = at(r, 'address');
        if (!recipient && !address && !product) continue;
        const detail = at(r, 'address_detail');
        if (detail && !address.includes(detail)) address = `${address} ${detail}`.trim();
        const phoneRaw = at(r, 'phone') || at(r, 'phone2');
        out.push({
            excelRow: i + 1,
            recipient,
            phone: isValidPhone(phoneRaw) ? formatPhone(normalizePhone(phoneRaw)) : '',
            zipcode: at(r, 'zipcode'),
            address,
            mallProduct: product,
            option: at(r, 'option'),
            qty: parseInt(String(at(r, 'qty')).replace(/[^\d]/g, ''), 10) || 1,
            memo: at(r, 'memo'),
            removed: false,
        });
    }
    // 같은 받는분·연락처·주소가 2줄 이상이면 (합) 후보. (합)은 부분출고를 원하지 않을 때만 셀러가 직접 체크합니다.
    const key = o => aiNorm(o.recipient) + '|' + aiNorm(o.phone) + '|' + aiNorm(o.address);
    const count = new Map();
    out.forEach(o => count.set(key(o), (count.get(key(o)) || 0) + 1));
    out.forEach(o => {
        o.group = key(o);
        o.groupSize = count.get(o.group);
        o.combined = false;
        o.match = aiMatch(o);
        o.wholesaleCompany = o.match ? o.match.wholesale_company : '';
        o.wholesaleProduct = o.match ? o.match.wholesale_product : '';
        o.wholesaleUnknown = false;
        o.dup = aiLooksDuplicate(o);
    });
    return out;
}

// 우리 상품관리(products)에서 같은 상품 찾기 — 재고출고(picking.html)와 같은 순서: 상품코드 → 쇼핑몰상품명 → 포함
async function aiLoadProducts() {
    aiOrder.products = [];
    try {
        const [p, s] = await Promise.all([
            fetchAllRows(() => supabaseClient.from('products').select('id,code,wholesale_company,wholesale_product,color,size,mall_names').is('deleted_at', null).order('id')),
            fetchAllRows(() => supabaseClient.from('inventory').select('product_id,qty_a').order('product_id')),
        ]);
        aiOrder.products = p.data || [];
        aiOrder.stock = new Map((s.data || []).map(r => [r.product_id, r.qty_a]));
    } catch (err) {
        console.warn('상품관리 불러오기 실패 (매칭 없이 진행)', err);
    }
}

function aiMatch(o) {
    const list = aiOrder.products || [];
    if (!list.length) return null;
    const text = aiNorm(o.mallProduct + ' ' + o.option);
    const code = (String(o.mallProduct + ' ' + o.option).toUpperCase().match(/P\d{6}/) || [])[0];
    if (code) { const p = list.find(x => x.code === code); if (p) return p; }
    const narrow = l => {
        for (const f of ['color', 'size']) { const hit = l.filter(p => p[f] && text.includes(aiNorm(p[f]))); if (hit.length) l = hit; }
        return l;
    };
    const name = aiNorm(o.mallProduct);
    const steps = [
        list.filter(p => (p.mall_names || []).some(n => aiNorm(n.name) === name)),
        list.filter(p => (p.mall_names || []).some(n => aiNorm(n.name) && (name.includes(aiNorm(n.name)) || aiNorm(n.name).includes(name)))),
    ];
    for (const s of steps) {
        const l = narrow(s);
        if (l.length === 1) return l[0];
        if (l.length > 1) return null;
    }
    return null;
}

// 최근 3일 안에 같은 받는분·연락처·상품으로 접수한 주문이 있으면 확인 안내 (막지는 않음)
function aiLooksDuplicate(o) {
    const since = Date.now() - 3 * 86400000;
    const name = aiNorm(o.mallProduct);
    return ordersMaster.some(x => x.seller_id === currentUserId && new Date(x.created_at).getTime() > since
        && aiNorm(x.recipient) === aiNorm(o.recipient) && aiNorm(x.phone) === aiNorm(o.phone)
        && aiNorm(x.product).includes(name));
}

// 출고에 꼭 필요한 칸: 하나라도 비면 접수 막음
const aiProblem = o => [!o.recipient && '받는분', !o.phone && '연락처', !o.address && '주소', !o.mallProduct && '쇼핑몰상품명',
    !o.wholesaleCompany && '도매처명', !o.wholesaleProduct && '도매상품명'].filter(Boolean);

// 우리 양식 상품명: "상품명 / 컬러 / 사이즈 / 수량개" (2026-11-16 대표님 요청)
//  옵션 칸이 따로 있으면 "컬러: 블랙 / 사이즈: M", "블랙/FREE", "블랙,M" 등을 나눠 " / " 로 이어 붙임
const aiOptionParts = opt => aiCell(opt).split(/\s*[\/,]\s*|\n/)
    .map(t => t.replace(/^(컬러|색상|색깔|color|colour|사이즈|size|옵션|선택)\s*[:：=]\s*/i, '').trim()).filter(Boolean);
const aiMallText = o => {
    const parts = [o.mallProduct];
    if (o.option && !o.mallProduct.includes(o.option)) parts.push(...aiOptionParts(o.option));
    return parts.filter(Boolean).join(' / ');
};
const aiProductText = o => {
    const base = aiMallText(o);
    const qty = /\d+\s*개\s*$/.test(base) ? '' : ` / ${o.qty}개`;
    return (o.combined ? '(합)' : '') + base + qty;
};
const AI_DUP_TEXT = '최근 3일안에 동일한 주문건이 있으니 확인해주세요.';
const AI_UNKNOWN_TEXT = '도매처명·도매상품명을 모르는 주문은 쇼핑몰상품명과 같게 기록되며, 이로 인한 출고 오류는 책임질 수 없습니다.';

function aiRender() {
    const box = document.getElementById('ai-result');
    const live = aiOrder.rows.filter(o => !o.removed);
    const bad = live.filter(o => aiProblem(o).length);
    const matched = live.filter(o => o.match).length;
    const groups = live.filter(o => o.groupSize > 1).length;
    const noWholesale = live.filter(o => !o.wholesaleCompany || !o.wholesaleProduct).length;
    // [이대로 주문접수] 버튼이 왜 안 눌리는지 버튼 옆에 알려줌
    let whyOff = '';
    if (!live.length) whyOff = '접수할 주문이 없어요. 모두 [빼기] 되어 있어요.';
    else if (bad.length) {
        const cnt = {};
        bad.forEach(o => { const k = aiProblem(o).join('·') + ' 없음'; cnt[k] = (cnt[k] || 0) + 1; });
        const fields = Object.entries(cnt).map(([f, n]) => `${f} ${n}건`).join(', ');
        const onlyWholesale = bad.every(o => aiProblem(o).every(f => f === '도매처명' || f === '도매상품명'));
        whyOff = `<b>빈 칸이 있는 주문 ${bad.length}건 때문에 아직 접수할 수 없어요.</b> (${fields})<br>`
            + (onlyWholesale ? '도매처명·도매상품명을 직접 적거나, 모르면 오른쪽 버튼을 눌러 주세요. 필요 없는 주문은 [빼기]를 누르면 돼요.'
                : '빨간 줄의 빈 칸을 채우거나 [빼기]를 눌러 주세요.');
    }
    const input = (i, field, v, ph) => `<input type="text" value="${aiEsc(v)}" placeholder="${ph}" onchange="aiSetField(${i}, '${field}', this.value)"
        class="w-full min-w-[110px] px-2 py-1 border rounded text-xs ${v ? 'border-slate-200' : 'border-rose-300 bg-white'}">`;
    const tr = aiOrder.rows.map((o, i) => {
        const prob = aiProblem(o);
        const stock = o.match ? aiOrder.stock.get(o.match.id) : undefined;
        const stockTxt = !o.match ? '' : stock > 0 ? `<span class="text-emerald-700">재고 ${stock}</span>` : '<span class="text-amber-700">재고 없음</span>';
        const matchTxt = o.match ? `<div class="font-bold text-slate-700">${aiEsc(o.match.code)}</div>${stockTxt}` : '<span class="text-slate-400">상품관리에 없음</span>';
        const combine = o.groupSize > 1
            ? `<label class="flex items-center gap-1 whitespace-nowrap cursor-pointer"><input type="checkbox" ${o.combined ? 'checked' : ''} onchange="aiSetCombined(${i}, this.checked)" class="w-4 h-4"> (합)</label><div class="text-[10px] text-slate-400 whitespace-nowrap">같은 받는분 ${o.groupSize}건</div>`
            : '<span class="text-slate-300">-</span>';
        const state = o.removed ? '<span class="text-slate-400">빼기</span>'
            : (prob.length ? `<div class="text-rose-600 font-bold">${prob.join('·')} 없음</div>` : o.dup ? '' : '<span class="text-emerald-700 font-bold">OK</span>')
              + (o.dup ? `<div class="text-amber-700 font-bold">${AI_DUP_TEXT}</div>` : '');
        return `<tr class="${o.removed ? 'opacity-40 line-through' : prob.length ? 'bg-rose-50' : ''} border-b border-slate-100 align-top">
            <td class="px-2 py-2 text-slate-400">${o.excelRow}</td>
            <td class="px-2 py-2 font-bold whitespace-nowrap">${aiEsc(o.recipient) || '<span class="text-rose-600">(없음)</span>'}</td>
            <td class="px-2 py-2 whitespace-nowrap">${aiEsc(o.phone) || '<span class="text-rose-600">(없음)</span>'}</td>
            <td class="px-2 py-2 min-w-[180px]">${aiEsc(o.address) || '<span class="text-rose-600">(없음)</span>'}${o.memo ? `<div class="text-slate-400">메세지: ${aiEsc(o.memo)}</div>` : ''}</td>
            <td class="px-2 py-2 min-w-[160px]">${o.combined ? '<span class="px-1 rounded bg-indigo-100 text-indigo-700 font-bold">(합)</span> ' : ''}${o.mallProduct ? aiEsc(aiProductText({ ...o, combined: false })) : '<span class="text-rose-600">(없음)</span>'}</td>
            <td class="px-2 py-2 text-center">${o.qty}</td>
            <td class="px-2 py-2">${input(i, 'wholesaleCompany', o.wholesaleCompany, '도매처명')}</td>
            <td class="px-2 py-2">${input(i, 'wholesaleProduct', o.wholesaleProduct, '도매상품명')}${o.wholesaleUnknown ? '<div class="text-[10px] text-amber-700 mt-0.5">모름 → 쇼핑몰상품명</div>' : ''}</td>
            <td class="px-2 py-2 min-w-[80px]">${matchTxt}</td>
            <td class="px-2 py-2">${combine}</td>
            <td class="px-2 py-2 min-w-[90px]">${state}</td>
            <td class="px-2 py-2"><button onclick="aiToggleRow(${i})" class="px-2 py-1 border border-slate-200 rounded text-[11px] font-bold text-slate-600 hover:bg-slate-50 whitespace-nowrap">${o.removed ? '되살리기' : '빼기'}</button></td>
        </tr>`;
    }).join('');
    box.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
                <p class="text-sm font-bold text-slate-800">📋 ${aiEsc(aiOrder.fileName)}${aiOrder.sheetName ? ` <span class="text-xs font-normal text-slate-500">· '${aiEsc(aiOrder.sheetName)}' 시트를 읽었어요</span>` : ''} ${aiOrder.platform ? `<span class="ml-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[11px]">${aiEsc(aiOrder.platform)} 양식</span>` : ''}</p>
                <p class="text-xs text-slate-500 mt-0.5">주문 ${live.length}건 · 상품관리 매칭 ${matched}건 · 보내는사람 <b>밤낮딜리버리(${aiEsc(currentSellerAccount.company)})</b> · C/S 연락처 <b>${aiEsc(aiCsPhone() || '(없음)')}</b></p>
            </div>
            <button onclick="aiReset()" class="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-lg">다른 파일 올리기</button>
        </div>
        ${bad.length ? `<p class="text-xs font-bold text-rose-600">⚠️ 받는분·연락처·주소·쇼핑몰상품명·도매처명·도매상품명 중 빈 칸이 있는 주문 ${bad.length}건은 접수할 수 없어요. 빈 칸을 채우거나 [빼기]를 눌러 주세요.</p>` : ''}
        ${noWholesale ? `<div class="flex flex-wrap items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <span class="text-xs text-amber-800">도매처명·도매상품명을 모르면 → </span>
            <button onclick="aiFillUnknownWholesale()" class="px-2.5 py-1 bg-white border border-amber-300 hover:bg-amber-100 text-amber-800 text-[11px] font-bold rounded">빈 도매처 칸을 쇼핑몰상품명으로 채우기 (${noWholesale}건)</button>
            <span class="text-[11px] text-amber-700">※ ${AI_UNKNOWN_TEXT}</span>
        </div>` : ''}
        ${groups ? `<p class="text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">같은 받는분 주문이 있어요. <b>부분출고 없이 모두 모아서 한 번에 보내길 원할 때만</b> (합)에 체크해 주세요. 체크하지 않으면 준비된 상품부터 따로 출고될 수 있어요.</p>` : ''}
        <div class="overflow-x-auto border border-slate-200 rounded-lg">
            <table class="w-full text-xs">
                <thead class="bg-slate-50 text-slate-500"><tr>
                    <th class="px-2 py-2 text-left">줄</th><th class="px-2 py-2 text-left">받는분</th><th class="px-2 py-2 text-left">연락처</th>
                    <th class="px-2 py-2 text-left">주소</th><th class="px-2 py-2 text-left">상품명 / 컬러 / 사이즈 / 수량</th><th class="px-2 py-2">수량</th>
                    <th class="px-2 py-2 text-left">도매처명</th><th class="px-2 py-2 text-left">도매상품명</th>
                    <th class="px-2 py-2 text-left">우리 상품 · 재고</th><th class="px-2 py-2 text-left">합배송</th><th class="px-2 py-2 text-left">상태</th><th></th>
                </tr></thead>
                <tbody>${tr}</tbody>
            </table>
        </div>
        <div class="flex justify-end items-center gap-3 flex-wrap">
            ${whyOff ? `<div id="ai-submit-why" class="flex-1 min-w-[240px] max-w-2xl text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">⚠️ ${whyOff}</div>` : ''}
            ${whyOff && noWholesale ? `<button onclick="aiFillUnknownWholesale()" class="px-3 py-2 bg-white border border-amber-300 hover:bg-amber-100 text-amber-800 text-xs font-bold rounded-lg">빈 도매처 칸을 쇼핑몰상품명으로 채우기 (${noWholesale}건)</button>` : ''}
            <button id="btn-ai-submit" onclick="aiSubmit()" ${bad.length || !live.length ? 'disabled' : ''} class="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold rounded-lg text-sm shadow">
                이대로 주문접수 (${live.length}건)
            </button>
        </div>`;
    box.classList.remove('hidden');
    document.getElementById('ai-drop-zone').classList.add('hidden');
}

function aiSetField(i, field, value) {
    const o = aiOrder.rows[i];
    o[field] = String(value || '').trim();
    o.wholesaleUnknown = false;
    aiRender();
}

// (합)은 같은 받는분 주문 전체에 함께 붙거나 빠짐
function aiSetCombined(i, on) {
    const g = aiOrder.rows[i].group;
    aiOrder.rows.forEach(o => { if (o.group === g) o.combined = on; });
    aiRender();
}

function aiFillUnknownWholesale() {
    aiOrder.rows.forEach(o => {
        if (o.removed || (o.wholesaleCompany && o.wholesaleProduct)) return;
        if (!o.wholesaleCompany) o.wholesaleCompany = aiMallText(o);
        if (!o.wholesaleProduct) o.wholesaleProduct = aiMallText(o);
        o.wholesaleUnknown = true;
    });
    aiRender();
}

function aiToggleRow(i) { aiOrder.rows[i].removed = !aiOrder.rows[i].removed; aiRender(); }

function aiReset() {
    aiOrder.rows = [];
    document.getElementById('ai-result').classList.add('hidden');
    document.getElementById('ai-drop-zone').classList.remove('hidden');
    aiStatus('');
}

function aiStatus(text, isError) {
    const el = document.getElementById('ai-status');
    el.textContent = text;
    el.className = `mt-3 text-xs font-bold ${isError ? 'text-rose-600' : 'text-indigo-700'} ${text ? '' : 'hidden'}`;
}

// C/S 연락처: 직전 풀필먼트 접수에 쓴 번호 → 없으면 가입 연락처 (단건 접수의 [최근 접수내용 재등록]과 같은 기준)
function aiCsPhone() {
    const recent = ordersMaster
        .filter(o => o.seller_id === currentUserId && orderTypeOf(o) === 'fulfillment' && o.cs_phone)
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
    return formatPhone((recent && recent.cs_phone) || currentSellerAccount.phone || '');
}

async function aiSubmit() {
    if (!canAddOrders()) { alert('관리자 승인 전이거나 이용이 정지된 계정은 주문을 등록할 수 없습니다.'); return; }
    const live = aiOrder.rows.filter(o => !o.removed);
    if (live.some(o => aiProblem(o).length)) { alert('받는분·연락처·주소·쇼핑몰상품명·도매처명·도매상품명 중 빈 칸이 있는 주문은 접수할 수 없어요.'); return; }
    if (!live.length) return;
    const keep = readKeepRequest();
    if (!keep) return;
    const dups = live.filter(o => o.dup).length;
    const combined = live.filter(o => o.combined).length;
    const unknown = live.filter(o => o.wholesaleUnknown).length;
    const lines = [`총 ${live.length}건을 풀필먼트 주문으로 접수할까요?`];
    lines.push(combined ? `\n📦 (합) 합배송 ${combined}건: 부분출고 없이 모두 모아서 한 번에 출고됩니다.` : '\n📦 (합) 체크한 주문 없음: 준비된 상품부터 출고될 수 있습니다.');
    if (unknown) lines.push(`\n⚠️ 도매처를 모르는 주문 ${unknown}건: ${AI_UNKNOWN_TEXT}`);
    if (dups) lines.push(`\n⚠️ ${dups}건: ${AI_DUP_TEXT} 중복이면 [취소] 후 [빼기]를 눌러 주세요.`);
    if (!confirm(lines.join('\n'))) return;

    const company = currentSellerAccount.company;
    const csPhone = aiCsPhone();
    const batch = live.map(o => ({
        id: generateOrderId('ORD-EXCEL'),
        seller_company: company,
        sender_name: `밤낮딜리버리(${company})`,
        cs_phone: csPhone,
        recipient: o.recipient,
        zipcode: o.zipcode,
        address: o.address,
        product: aiProductText(o),
        wholesale_company: o.wholesaleCompany,
        wholesale_product: o.wholesaleProduct,
        phone: o.phone,
        memo: o.memo,
        bamnat_memo: '',
        keep_request: keep.keep_request,
        keep_memo: keep.keep_memo,
        qty: o.qty,
        status: '접수대기',
    }));
    const btn = document.getElementById('btn-ai-submit');
    btn.disabled = true;
    let saved = batch.map(o => ({ ...o, created_at: new Date().toISOString() }));
    if (supabaseClient) {
        // 한 번에 저장 → 오류 시 일부만 들어가는 일 없이 전체 취소
        const { data, error } = await supabaseClient.from('orders').insert(batch).select();
        if (error) {
            alert('주문 저장 중 오류가 발생하여 접수가 취소되었습니다.\n\n' + dbErrorMessage(error));
            btn.disabled = false;
            return;
        }
        if (data && data.length) saved = data;
    }
    ordersMaster.unshift(...saved);
    sortOrdersMaster();
    renderSellerTable();
    if (typeof showLeftoverModal === 'function') showLeftoverModal(`풀필먼트 주문 총 ${batch.length}건이 접수되었어요`);
    else { alert(`총 ${batch.length}건의 주문이 접수되었습니다!`); if (isKakaoNoticeTime()) alert(KAKAO_NOTICE_MESSAGE); }
    aiReset();
}
