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
let aiOrder = { mode: 'order', fileName: '', sheetName: '', platform: '', rows: [], products: null, stock: new Map(),
    ownStock: new Map(), ownReady: false, useOwn: true };  // ownStock: 셀러 '내 재고표'(seller_own_stock, 'buy' 화면에서만)

// 화면이 두 곳: 'order' = 풀필먼트 [쇼핑몰 주문서 그대로 올리기] 탭, 'buy' = 매장/사무실 택배 화면의 [사입 목록 만들기] (2026-11-19)
//  'buy' 는 주문 접수 없이, 주문서를 읽어 도매 매장별 사입할 상품만 정리 (풀필먼트·재고보관을 안 쓰는 택배 업체용)
const AI_IDS = {
    order: { result: 'ai-result', drop: 'ai-drop-zone', status: 'ai-status' },
    buy: { result: 'buy-ai-result', drop: 'buy-ai-drop-zone', status: 'buy-ai-status' },
};
const aiEl = k => document.getElementById(AI_IDS[aiOrder.mode][k]);
// 다른 화면에서 새 파일을 올리면 앞 화면의 결과는 닫음 (같은 aiOrder 를 같이 쓰므로)
function aiUseMode(mode) {
    if (aiOrder.mode === mode) return;
    if (aiOrder.rows.length) aiReset();
    aiOrder.mode = mode;
}

const AI_FIELD_LABEL = { recipient: '받는분', phone: '연락처', address: '주소', product: '상품명', option: '옵션', qty: '수량', memo: '배송메세지' };
const aiEsc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const aiNorm = v => String(v ?? '').replace(/\s+/g, '').toLowerCase();
const aiCell = v => (v === undefined || v === null) ? '' : String(v).trim();

function aiDrop(e, mode = 'order') {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget?.classList.remove('border-indigo-500', 'bg-indigo-50', 'border-amber-500', 'bg-amber-100');
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (files.length !== 1) { alert('주문서 파일은 한 번에 1개씩 올려주세요.'); return; }
    aiFileChosen({ target: { files, value: '' } }, mode);
}

async function aiFileChosen(e, mode = 'order') {
    aiUseMode(mode);
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!canAddOrders()) { alert(mode === 'buy' ? '관리자 승인 전이거나 이용이 정지된 계정은 사용할 수 없습니다.' : '관리자 승인 전이거나 이용이 정지된 계정은 주문을 등록할 수 없습니다.'); return; }
    if (mode !== 'buy' && blockIfShipClosed()) return;
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
    aiOrder.ownDone = false;
    aiOrder.shipSaved = '';
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

// 마스터상품코드 "독도(SSXR802)96898558" → 도매처 '독도', 도매상품명 'SSXR802' (끝 숫자는 무시)
//  온더포엑스 주문서에 있는 칸 (2026-11-23 대표님 요청). 이 모양이 아니면 null
function parseMasterCode(v) {
    const m = aiCell(v).match(/^([^()]+?)\s*\(\s*([^()]+?)\s*\)\s*[\d\-]*$/);
    return m ? { company: m[1].trim(), product: m[2].trim() } : null;
}
// 제목줄에서 마스터상품코드 칸 위치 (없으면 -1)
const masterCodeCol = head => (head || []).findIndex(h => /마스터\s*상품\s*코드/.test(aiCell(h)));

function aiBuildRows(rows, mapping) {
    const c = mapping.columns, at = (r, k) => (c[k] >= 0 ? aiCell(r[c[k]]) : '');
    // 주문서에 도매처 칸이 있으면 그대로 읽음 (우리 요청서의 '도매거래처명'·'도매상품명' 등, 2026-11-17)
    //  AI 칸 정보에는 이 칸이 없어서, 제목줄 글자로 직접 찾습니다
    const head = (rows[mapping.header_row] || []).map(h => aiNorm(h).replace(/[()\[\]]/g, ''));
    const findCol = re => head.findIndex(h => re.test(h));
    const wpCol = findCol(/^도매(상품|제품)(명|이름)?$/);
    const wcCol = findCol(/^도매(거래처|처|업체|매장|상가)(명|이름)?$/);
    const mcCol = masterCodeCol(rows[mapping.header_row]);
    const cell = (r, i) => (i >= 0 ? aiCell(r[i]) : '');
    const out = [];
    for (let i = mapping.header_row + 1; i < rows.length; i++) {
        const r = rows[i] || [];
        const recipient = at(r, 'recipient'), product = at(r, 'product');
        let address = at(r, 'address');
        if (!recipient && !address && !product) continue;
        const detail = at(r, 'address_detail');
        const addrBase = address;   // 운송장 양식에 기본/상세 주소 칸이 따로 있을 때 쓰려고 나눠 둠 ('buy' 화면 → 내 택배 주문)
        if (detail && !address.includes(detail)) address = `${address} ${detail}`.trim();
        const phoneRaw = at(r, 'phone') || at(r, 'phone2');
        out.push({
            excelRow: i + 1,
            recipient,
            phone: isValidPhone(phoneRaw) ? formatPhone(normalizePhone(phoneRaw)) : '',
            zipcode: at(r, 'zipcode'),
            address,
            addrBase, addrDetail: detail && !addrBase.includes(detail) ? detail : '',
            phone2: (() => { const p2 = at(r, 'phone2'); return p2 && isValidPhone(p2) ? formatPhone(normalizePhone(p2)) : ''; })(),
            orderNo: at(r, 'order_no'),
            mallProduct: product,
            option: at(r, 'option'),
            qty: parseInt(String(at(r, 'qty')).replace(/[^\d]/g, ''), 10) || 1,
            memo: at(r, 'memo'),
            fileWholesaleCompany: cell(r, wcCol) || (parseMasterCode(cell(r, mcCol)) || {}).company || '',
            fileWholesaleProduct: cell(r, wpCol) || (parseMasterCode(cell(r, mcCol)) || {}).product || '',
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
        o.combined = /\(합\)/.test(o.mallProduct);   // 셀러가 이미 (합)을 적었으면 그대로
        o.match = aiMatch(o);
        o.wholesaleCompany = o.match ? o.match.wholesale_company : o.fileWholesaleCompany;
        o.wholesaleProduct = o.match ? o.match.wholesale_product : o.fileWholesaleProduct;
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
        if (aiOrder.mode === 'buy') await aiLoadOwnStock();
    } catch (err) {
        console.warn('상품관리 불러오기 실패 (매칭 없이 진행)', err);
    }
}

// 셀러 '내 재고표' (supabase/own_stock.sql). SQL 실행 전이면 표가 없어 재고 없이 계산
async function aiLoadOwnStock() {
    const { data, error } = await fetchAllRows(() => supabaseClient.from('seller_own_stock').select('product_id,qty').order('product_id'));
    aiOrder.ownReady = !error;
    aiOrder.ownStock = new Map((data || []).map(r => [r.product_id, r.qty]));
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
    // (합)·(킵) 표시는 hap-keep.js 의 hkMark: 이미 있으면 두 번 붙이지 않음
    return typeof hkMark === 'function' ? hkMark(base + qty, o.combined, !!o.hkKeep) : (o.combined ? '(합)' : '') + base + qty;
};
const AI_DUP_TEXT = '최근 3일안에 동일한 주문건이 있으니 확인해주세요.';
const AI_UNKNOWN_TEXT = '도매처명·도매상품명을 모르는 주문은 쇼핑몰상품명과 같게 기록되며, 이로 인한 출고 오류는 책임질 수 없습니다.';

function aiRender() {
    if (aiOrder.mode === 'buy') return aiRenderBuy();
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
    // (킵): 맡긴 재고가 있는 상품은 저절로 체크, 위쪽 줄부터 재고 배정 (hap-keep.js)
    if (typeof hkAllocate === 'function') {
        aiOrder.rows.forEach(o => { if (o.removed) o.hkKeep = ''; });
        hkAllocate(live.map(o => Object.assign(o, { product: aiMallText(o) })));
    }
    const keepN = live.filter(o => o.hkKeep).length;
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
            <td class="px-2 py-2 min-w-[160px]">${o.mallProduct ? (typeof hkBadges === 'function' ? hkBadges(aiProductText(o)) : aiEsc(aiProductText(o))) : '<span class="text-rose-600">(없음)</span>'}</td>
            <td class="px-2 py-2 text-center">${o.qty}</td>
            <td class="px-2 py-2">${input(i, 'wholesaleCompany', o.wholesaleCompany, '도매처명')}</td>
            <td class="px-2 py-2">${input(i, 'wholesaleProduct', o.wholesaleProduct, '도매상품명')}${o.wholesaleUnknown ? '<div class="text-[10px] text-amber-700 mt-0.5">모름 → 쇼핑몰상품명</div>' : ''}</td>
            <td class="px-2 py-2 min-w-[80px]">${matchTxt}</td>
            <td class="px-2 py-2">${combine}</td>
            <td class="px-2 py-2">${o.removed || typeof hkKeepCell !== 'function' ? '' : hkKeepCell(o, `aiSetKeep(${i}, this.checked)`)}</td>
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
        ${keepN ? `<p class="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">📦 맡긴 재고가 있는 상품 <b>${keepN}건은 상품명 앞에 (킵)</b>이 붙어 재고에서 먼저 출고됩니다. 재고로 보내지 않을 주문만 체크를 빼 주세요.</p>` : ''}
        ${groups ? `<p class="text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">같은 받는분 주문이 있어요. <b>부분출고 없이 모두 모아서 한 번에 보내길 원할 때만</b> (합)에 체크해 주세요. 체크하지 않으면 준비된 상품부터 따로 출고될 수 있어요.</p>` : ''}
        <div class="overflow-x-auto border border-slate-200 rounded-lg">
            <table class="w-full text-xs">
                <thead class="bg-slate-50 text-slate-500"><tr>
                    <th class="px-2 py-2 text-left">줄</th><th class="px-2 py-2 text-left">받는분</th><th class="px-2 py-2 text-left">연락처</th>
                    <th class="px-2 py-2 text-left">주소</th><th class="px-2 py-2 text-left">상품명 / 컬러 / 사이즈 / 수량</th><th class="px-2 py-2">수량</th>
                    <th class="px-2 py-2 text-left">도매처명</th><th class="px-2 py-2 text-left">도매상품명</th>
                    <th class="px-2 py-2 text-left">우리 상품 · 재고</th><th class="px-2 py-2 text-left">합배송</th><th class="px-2 py-2 text-left">재고에서 출고 (킵)</th><th class="px-2 py-2 text-left">상태</th><th></th>
                </tr></thead>
                <tbody>${tr}</tbody>
            </table>
        </div>
        ${aiBuyBox(live)}
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

// 사입할 상품 목록 (2026-11-17 대표님 요청): 사무실 재고로 못 채우는 수량만 도매처별로 모아 보여줌
//  상품관리에 있는 상품: 같은 상품 주문 수량을 합친 뒤 지금 재고만큼 빼고 남는 수량
//  상품관리에 없는 상품: 재고를 알 수 없으므로 주문 수량 그대로
//  'buy' 화면(택배 업체용)은 사무실 재고를 쓰지 않으므로 재고를 빼지 않고 주문 수량 그대로
function aiBuyList(live) {
    const map = new Map();
    const buy = aiOrder.mode === 'buy';
    const useStock = !buy || (aiOrder.ownReady && aiOrder.useOwn);
    const stockOf = id => buy ? (aiOrder.ownStock.get(id) || 0) : (aiOrder.stock.get(id) || 0);
    let fromStock = 0;
    live.forEach(o => {
        const parts = aiOptionParts(o.option);
        const p = o.match;
        // 도매상품명을 모르면 쇼핑몰상품명으로 구분 (다른 상품이 한 줄로 합쳐지지 않게)
        const key = p ? 'p' + p.id : [o.wholesaleCompany, o.wholesaleProduct || o.mallProduct, o.option].map(aiNorm).join('|');
        const row = map.get(key) || {
            company: (p && p.wholesale_company) || o.wholesaleCompany || '',
            product: (p && p.wholesale_product) || o.wholesaleProduct || o.mallProduct || '',
            color: p ? (p.color || '') : (parts[0] || ''),
            size: p ? (p.size || '') : (parts[1] || ''),
            ordered: 0, stock: p && useStock ? stockOf(p.id) : null, pid: p ? p.id : null,
            mall: new Set(),
        };
        row.ordered += o.qty;
        if (o.mallProduct) row.mall.add(o.mallProduct);
        map.set(key, row);
    });
    const rows = [], stockRows = [];
    map.forEach(r => {
        const use = r.stock === null ? 0 : Math.min(r.stock, r.ordered);
        fromStock += use;
        r.use = use;
        r.need = r.ordered - use;
        if (r.need > 0) rows.push(r);
        if (use > 0) stockRows.push(r);
    });
    rows.sort((a, b) => (a.company || '힣').localeCompare(b.company || '힣', 'ko') || a.product.localeCompare(b.product, 'ko'));
    return { rows, stockRows, fromStock, needTotal: rows.reduce((n, r) => n + r.need, 0) };
}

const aiBuyNote = r => aiOrder.mode === 'buy'
    ? [...r.mall].slice(0, 2).join(', ') + (r.stock !== null ? ` (주문 ${r.ordered} · 내 재고 ${r.stock})` : '')
    : r.stock !== null ? `주문 ${r.ordered} · 재고 ${r.stock}` : '상품관리에 없음';
function aiBuyBox(live) {
    const b = aiBuyList(live);
    if (!live.length) return '';
    const buy = aiOrder.mode === 'buy';
    const body = b.rows.map(r => `<tr class="border-b border-amber-100">
        <td class="px-2 py-1.5 font-bold">${aiEsc(r.company) || '<span class="text-rose-600">(도매처 없음)</span>'}</td>
        <td class="px-2 py-1.5">${aiEsc(r.product)}</td>
        <td class="px-2 py-1.5">${aiEsc(r.color)}</td>
        <td class="px-2 py-1.5">${aiEsc(r.size)}</td>
        <td class="px-2 py-1.5 text-center font-black text-amber-800">${r.need}</td>
        <td class="px-2 py-1.5 text-[11px] text-slate-500">${aiEsc(aiBuyNote(r))}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="px-2 py-4 text-center text-emerald-700 font-bold">모두 사무실 재고로 나갈 수 있어요. 사입할 상품이 없습니다.</td></tr>';
    return `<div id="ai-buy-box" class="border border-amber-200 bg-amber-50/60 rounded-lg p-3 space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
                <p class="text-sm font-black text-amber-800">🛒 사입할 상품 목록 <span class="text-xs font-bold">(${b.rows.length}가지 · ${b.needTotal}개)</span></p>
                <p class="text-[11px] text-slate-600 mt-0.5">${buy
                    ? (aiOrder.ownReady && aiOrder.useOwn ? `📦 내 재고로 보낼 상품 <b class="text-emerald-700">${b.fromStock}개</b> · ` : '')
                      + `🛒 도매 매장 <b class="text-amber-800">${new Set(b.rows.map(r => r.company)).size}곳</b>에서 사입할 상품 <b class="text-amber-800">${b.needTotal}개</b> — 같은 상품은 주문 수량을 합쳤어요.`
                    : `📦 사무실 재고로 나갈 상품 <b class="text-emerald-700">${b.fromStock}개</b> · 🛒 매장에서 사입할 상품 <b class="text-amber-800">${b.needTotal}개</b> — 재고는 지금 기준이며, 출고 때 먼저 들어온 주문부터 재고가 쓰여요.`}</p>
            </div>
            <div class="flex gap-1.5">
                <button onclick="aiBuyExcel()" ${b.rows.length ? '' : 'disabled'} class="px-3 py-1.5 bg-white border border-amber-300 hover:bg-amber-100 disabled:opacity-40 text-amber-800 text-xs font-bold rounded-lg">엑셀 받기</button>
                <button onclick="aiBuyCopy()" ${b.rows.length ? '' : 'disabled'} class="px-3 py-1.5 bg-white border border-amber-300 hover:bg-amber-100 disabled:opacity-40 text-amber-800 text-xs font-bold rounded-lg">텍스트 복사</button>
            </div>
        </div>
        <div class="overflow-x-auto bg-white border border-amber-100 rounded-lg">
            <table class="w-full text-xs">
                <thead class="bg-amber-50 text-amber-800"><tr>
                    <th class="px-2 py-1.5 text-left">도매처명</th><th class="px-2 py-1.5 text-left">도매상품명</th><th class="px-2 py-1.5 text-left">컬러</th>
                    <th class="px-2 py-1.5 text-left">사이즈</th><th class="px-2 py-1.5">사입할 수량</th><th class="px-2 py-1.5 text-left">${buy ? '쇼핑몰상품명' : '참고'}</th>
                </tr></thead>
                <tbody>${body}</tbody>
            </table>
        </div>
        ${buy && aiOrder.ownReady ? `<div class="flex flex-wrap items-center gap-3 pt-1">
            <label class="flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer"><input type="checkbox" id="buy-use-own" ${aiOrder.useOwn ? 'checked' : ''} ${aiOrder.ownDone ? 'disabled' : ''} onchange="aiSetUseOwn(this.checked)" class="w-4 h-4"> <a href="/my-stock" target="_blank" class="text-teal-700 underline">내 재고표</a> 수량만큼 빼고 계산</label>
            ${aiOrder.ownDone ? '<span class="text-xs font-bold text-teal-700">✅ 내 재고표에서 뺐어요</span>' : aiOrder.useOwn && b.fromStock ? `<button id="btn-buy-own-out" onclick="aiOwnStockOut()" class="px-3 py-1.5 bg-white border border-teal-300 hover:bg-teal-50 text-teal-800 text-xs font-bold rounded-lg">내 재고로 보낸 ${b.fromStock}개, 내 재고표에서 빼기</button>
            <span class="text-[11px] text-slate-500">상품을 다 보낸 뒤 눌러 주세요.</span>` : ''}
        </div>` : ''}
    </div>`;
}

function aiSetUseOwn(on) { if (aiOrder.ownDone) return; aiOrder.useOwn = on; aiRender(); }

// 내 재고로 보낸 만큼 '내 재고표'에서 빼기 (한 번만 누르도록 누른 뒤엔 재고를 다시 불러와 0개로 보임)
async function aiOwnStockOut() {
    const b = aiBuyList(aiOrder.rows.filter(o => !o.removed));
    const items = b.stockRows.filter(r => r.pid && r.use > 0).map(r => ({ product_id: r.pid, change: -r.use }));
    if (!items.length) return;
    if (!confirm(`내 재고표에서 ${b.fromStock}개(${items.length}가지 상품)를 뺄까요?\n상품을 다 보낸 뒤에만 눌러 주세요.`)) return;
    const { error } = await supabaseClient.rpc('own_stock_apply', { p_items: items, p_mode: 'add', p_reason: `주문서 출고 (${aiOrder.fileName})`.slice(0, 200) });
    if (error) { alert('내 재고표를 바꾸지 못했어요.\n' + (error.message || '')); return; }
    aiOrder.ownDone = true;   // 같은 주문서로 두 번 빼지 않게 (화면의 계산은 뺀 전 기준 그대로)
    aiRender();
    alert(`내 재고표에서 ${b.fromStock}개를 뺐어요.`);
}

function aiBuyExcel() {
    const b = aiBuyList(aiOrder.rows.filter(o => !o.removed));
    if (!b.rows.length) return;
    const aoa = [['도매처명', '도매상품명', '컬러', '사이즈', '사입할 수량', aiOrder.mode === 'buy' ? '쇼핑몰상품명' : '참고']]
        .concat(b.rows.map(r => [r.company, r.product, r.color, r.size, r.need, aiOrder.mode === 'buy' ? [...r.mall].join(', ') : aiBuyNote(r)]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '사입할 상품');
    const d = new Date(), ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    XLSX.writeFile(wb, `사입할상품_${ymd}.xlsx`);
}

async function aiBuyCopy() {
    const b = aiBuyList(aiOrder.rows.filter(o => !o.removed));
    if (!b.rows.length) return;
    const groups = new Map();
    b.rows.forEach(r => { const k = r.company || '(도매처 없음)'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
    const text = `[사입할 상품] ${new Date().toLocaleDateString('ko-KR')}\n` + [...groups.entries()].map(([k, list]) =>
        `\n■ ${k}\n` + list.map(r => `- ${[r.product, r.color, r.size].filter(Boolean).join(' / ')} : ${r.need}개`).join('\n')).join('\n');
    try { await navigator.clipboard.writeText(text); alert('복사했습니다. 카톡 등에 붙여넣으세요.'); }
    catch { prompt('아래 내용을 복사하세요 (Ctrl+C)', text); }
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

// (킵) 체크를 빼면 그 줄은 재고를 쓰지 않음 (다시 체크하면 재고 배정)
function aiSetKeep(i, on) { aiOrder.rows[i].keepOff = !on; aiRender(); }

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
    aiEl('result').classList.add('hidden');
    aiEl('result').innerHTML = '';  // 두 화면에 같은 id(ai-buy-box)가 남지 않게
    aiEl('drop').classList.remove('hidden');
    aiStatus('');
}

function aiStatus(text, isError) {
    const el = aiEl('status');
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

// [이대로 주문접수] 전 최종 확인창: 접수될 내용을 표로 한 번 더 보여주고 "이대로 접수하겠습니까?" (2026-11-16 대표님 요청)
function aiFinalCheck(live, notes, np) {
    return new Promise(resolve => {
        document.getElementById('ai-final-modal')?.remove();
        const wrap = document.createElement('div');
        wrap.id = 'ai-final-modal';
        wrap.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50';
        const rows = live.map((o, i) => `<tr class="border-b border-slate-100 align-top">
            <td class="px-2 py-1.5 text-slate-400">${i + 1}</td>
            <td class="px-2 py-1.5 font-bold whitespace-nowrap">${aiEsc(o.recipient)}</td>
            <td class="px-2 py-1.5 whitespace-nowrap">${aiEsc(o.phone)}</td>
            <td class="px-2 py-1.5 min-w-[160px]">${aiEsc(o.address)}</td>
            <td class="px-2 py-1.5 min-w-[200px] font-bold text-indigo-700">${aiEsc(aiProductText(o))}</td>
            <td class="px-2 py-1.5 text-center">${o.qty}</td>
            <td class="px-2 py-1.5 min-w-[120px]">${aiEsc(o.wholesaleCompany)}<div class="text-slate-500">${aiEsc(o.wholesaleProduct)}</div></td>
        </tr>`).join('');
        wrap.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl max-w-4xl w-full p-5 space-y-3 border border-slate-100 max-h-[90vh] flex flex-col">
            <div>
                <p class="text-base font-black text-slate-800">📋 최종 확인: 아래 내용으로 접수돼요</p>
                <p class="text-xs text-slate-500 mt-0.5">받는분·주소·상품명·수량·도매처가 맞는지 한 번 더 확인해 주세요. 틀린 곳이 있으면 [다시 확인할게요]를 눌러 고친 뒤 접수하세요.</p>
            </div>
            <div class="overflow-auto border border-slate-200 rounded-xl">
                <table class="w-full text-xs">
                    <thead class="bg-slate-50 text-slate-500 sticky top-0"><tr>
                        <th class="px-2 py-2 text-left"></th><th class="px-2 py-2 text-left">받는분</th><th class="px-2 py-2 text-left">연락처</th><th class="px-2 py-2 text-left">주소</th>
                        <th class="px-2 py-2 text-left">상품명 (접수되는 그대로)</th><th class="px-2 py-2">수량</th><th class="px-2 py-2 text-left">도매처 / 도매상품</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <div class="text-xs text-slate-700 space-y-1 whitespace-pre-line">${notes.map(n => `<p>${aiEsc(n.trim())}</p>`).join('')}</div>
            ${np ? `<label class="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 cursor-pointer">
                <input type="checkbox" id="ai-reg-products" checked class="w-4 h-4 mt-0.5">
                <span class="text-xs text-emerald-900"><b>상품관리에 없던 상품 ${np.creates.length + np.adds.length}개를 상품관리에도 등록하기</b>
                    <span class="block text-[11px] text-emerald-800 mt-0.5">적어 주신 도매처명·도매상품명·컬러·사이즈·쇼핑몰상품명으로 등록돼요. 다음부터 같은 상품은 도매처 칸이 저절로 채워지고 재고도 보여요. (재고는 0으로 시작)</span>
                    <span class="block text-[11px] text-emerald-700 mt-1">${np.creates.map(c => aiEsc([c.wholesale_company, c.wholesale_product, c.color, c.size].filter(Boolean).join(' / '))).concat(np.adds.map(a => aiEsc(a.product.code + ' 에 쇼핑몰상품명 추가'))).join(' · ')}</span></span>
            </label>` : ''}
            <p class="text-sm font-black text-slate-800 text-center">총 ${live.length}건, 이대로 접수하시겠습니까?</p>
            <div class="flex gap-2">
                <button type="button" id="btn-ai-final-cancel" class="flex-1 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm">다시 확인할게요</button>
                <button type="button" id="btn-ai-final-ok" class="flex-1 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm">네, 이대로 접수할게요 (${live.length}건)</button>
            </div>
        </div>`;
        const done = ok => { wrap.remove(); resolve(ok); };
        wrap.addEventListener('click', e => { if (e.target === wrap) done(false); });
        document.body.appendChild(wrap);
        document.getElementById('btn-ai-final-cancel').onclick = () => done(false);
        document.getElementById('btn-ai-final-ok').onclick = () => done(document.getElementById('ai-reg-products')?.checked ? 'reg' : true);
    });
}

// 주문서에 적은 도매처로 상품관리에 새 상품 자동 등록 (2026-11-17 대표님 요청)
//  대상: 상품관리에 없던 줄 중 도매처명·도매상품명을 직접 적은 줄 ([쇼핑몰상품명으로 채우기] 한 줄은 제외)
//  같은 도매처·도매상품·컬러·사이즈 상품이 이미 있으면 새로 만들지 않고 쇼핑몰상품명만 덧붙임. 재고는 건드리지 않음
function aiNewProducts(live) {
    const keyOf = (wc, wp, c, sz) => [wc, wp, c, sz].map(aiNorm).join('|');
    const existing = new Map((aiOrder.products || []).map(p => [keyOf(p.wholesale_company, p.wholesale_product, p.color, p.size), p]));
    const creates = new Map(), adds = new Map();
    live.forEach(o => {
        if (o.match || o.wholesaleUnknown || !o.wholesaleCompany || !o.wholesaleProduct || !o.mallProduct) return;
        const parts = aiOptionParts(o.option);
        const color = parts[0] || '', size = parts[1] || '';
        const name = { platform: aiOrder.platform || '', name: o.mallProduct };
        const k = keyOf(o.wholesaleCompany, o.wholesaleProduct, color, size);
        const has = (list, n) => list.some(x => aiNorm(x.platform) === aiNorm(n.platform) && aiNorm(x.name) === aiNorm(n.name));
        const old = existing.get(k);
        if (old) {
            const a = adds.get(old.id) || { product: old, names: [] };
            if (!has((old.mall_names || []).concat(a.names), name)) a.names.push(name);
            if (a.names.length) adds.set(old.id, a);
            return;
        }
        const c = creates.get(k) || { company: currentSellerAccount.company, wholesale_company: o.wholesaleCompany, wholesale_product: o.wholesaleProduct, color, size, mall_names: [] };
        if (!has(c.mall_names, name)) c.mall_names.push(name);
        creates.set(k, c);
    });
    return { creates: [...creates.values()], adds: [...adds.values()] };
}

// 주문 저장이 끝난 뒤 실행. 실패해도 주문은 이미 접수됐으므로 안내만 함
async function aiSaveNewProducts(np) {
    if (!supabaseClient || (!np.creates.length && !np.adds.length)) return '';
    let made = 0, added = 0;
    const fails = [];
    for (const c of np.creates) {
        const { error } = await supabaseClient.from('products').insert(c);
        if (error) fails.push(`${c.wholesale_company} ${c.wholesale_product}`); else made++;
    }
    for (const a of np.adds) {
        const { error } = await supabaseClient.from('products').update({ mall_names: (a.product.mall_names || []).concat(a.names) }).eq('id', a.product.id);
        if (error) fails.push(`${a.product.wholesale_company} ${a.product.wholesale_product}`); else added++;
    }
    let msg = '';
    if (made) msg += `\n🗂️ 상품관리에 새 상품 ${made}개를 등록했어요.`;
    if (added) msg += `\n🗂️ 기존 상품 ${added}개에 쇼핑몰상품명을 덧붙였어요.`;
    if (fails.length) msg += `\n⚠️ 상품관리 등록이 안 된 상품 ${fails.length}개: ${fails.slice(0, 5).join(', ')} (${aiOrder.mode === 'buy' ? '' : '주문은 정상 접수됨, '}[상품관리]에서 직접 등록해 주세요)`;
    return msg.trim();
}

async function aiSubmit() {
    if (!canAddOrders()) { alert('관리자 승인 전이거나 이용이 정지된 계정은 주문을 등록할 수 없습니다.'); return; }
    if (aiOrder.mode !== 'buy' && blockIfShipClosed()) return;
    const live = aiOrder.rows.filter(o => !o.removed);
    if (live.some(o => aiProblem(o).length)) { alert('받는분·연락처·주소·쇼핑몰상품명·도매처명·도매상품명 중 빈 칸이 있는 주문은 접수할 수 없어요.'); return; }
    if (!live.length) return;
    const keep = readKeepRequest();
    if (!keep) return;
    const dups = live.filter(o => o.dup).length;
    const combined = live.filter(o => o.combined).length;
    const keepN = live.filter(o => o.hkKeep).length;
    const unknown = live.filter(o => o.wholesaleUnknown).length;
    const lines = [`총 ${live.length}건을 풀필먼트 주문으로 접수할까요?`];
    lines.push(combined ? `\n📦 (합) 합배송 ${combined}건: 부분출고 없이 모두 모아서 한 번에 출고됩니다.` : '\n📦 (합) 체크한 주문 없음: 준비된 상품부터 출고될 수 있습니다.');
    if (keepN) lines.push(`\n📥 (킵) 재고에서 출고 ${keepN}건: 맡긴 재고에서 먼저 출고됩니다.`);
    if (unknown) lines.push(`\n⚠️ 도매처를 모르는 주문 ${unknown}건: ${AI_UNKNOWN_TEXT}`);
    if (dups) lines.push(`\n⚠️ ${dups}건: ${AI_DUP_TEXT} 중복이면 [다시 확인할게요] 후 [빼기]를 눌러 주세요.`);
    const np = aiNewProducts(live);
    const regCount = np.creates.length + np.adds.length;
    const ok = await aiFinalCheck(live, lines.slice(1), regCount ? np : null);
    if (!ok) return;
    const regProducts = ok === 'reg';

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
    const regMsg = regProducts ? await aiSaveNewProducts(np) : '';
    if (regMsg) alert(regMsg);
    if (typeof showLeftoverModal === 'function') showLeftoverModal(`풀필먼트 주문 총 ${batch.length}건이 접수되었어요`);
    else { alert(`총 ${batch.length}건의 주문이 접수되었습니다!`); if (isKakaoNoticeTime()) alert(KAKAO_NOTICE_MESSAGE); }
    aiReset();
}

// =====================================================================
// 사입 목록 만들기 (매장/사무실 택배 화면, 2026-11-19 대표님 요청)
//  풀필먼트·재고보관을 안 쓰는 일반/당일택배 업체: 쇼핑몰 주문서를 올리면 주문 접수 없이
//  도매 매장별로 사입할 상품(도매상품명·컬러·사이즈·수량)만 정리 → 엑셀 받기 / 텍스트 복사
//  받는분·연락처·주소는 화면에 보여주지 않고 저장하지도 않음 (상품만 정리)
// =====================================================================
// 같은 쇼핑몰상품명+옵션 줄을 한 묶음으로 (도매처는 묶음 단위로 한 번만 적으면 됨)
function aiBuyGroups() {
    const map = new Map();
    aiOrder.rows.forEach((o, i) => {
        const k = aiNorm(o.mallProduct) + '|' + aiNorm(o.option);
        const g = map.get(k) || { key: k, idx: [], first: o, qty: 0, removed: true };
        g.idx.push(i);
        if (!o.removed) { g.qty += o.qty; g.removed = false; }
        map.set(k, g);
    });
    return [...map.values()];
}

function aiSetGroupField(gi, field, value) {
    const g = aiBuyGroups()[gi];
    if (!g) return;
    g.idx.forEach(i => { aiOrder.rows[i][field] = String(value || '').trim(); });
    aiRender();
}

function aiToggleGroup(gi) {
    const g = aiBuyGroups()[gi];
    if (!g) return;
    g.idx.forEach(i => { aiOrder.rows[i].removed = !g.removed; });
    aiRender();
}

// 적어 준 도매처를 상품관리에 기억 → 다음에 같은 상품은 도매처가 저절로 채워짐
async function aiBuyRemember() {
    const np = aiNewProducts(aiOrder.rows.filter(o => !o.removed));
    if (!np.creates.length && !np.adds.length) return;
    const btn = document.getElementById('btn-buy-remember');
    if (btn) btn.disabled = true;
    const msg = await aiSaveNewProducts(np);
    await aiLoadProducts();
    aiOrder.rows.forEach(o => {
        if (o.match) return;
        o.match = aiMatch(o);
        if (o.match) { o.wholesaleCompany = o.match.wholesale_company; o.wholesaleProduct = o.match.wholesale_product; }
    });
    aiRender();
    if (msg) alert(msg + '\n다음부터 같은 상품은 도매처가 저절로 채워져요.');
}

function aiRenderBuy() {
    const box = aiEl('result');
    const live = aiOrder.rows.filter(o => !o.removed);
    const groups = aiBuyGroups();
    const noCompany = groups.filter(g => !g.removed && !g.first.wholesaleCompany).length;
    const np = aiNewProducts(live);
    const regCount = np.creates.length + np.adds.length;
    const input = (gi, field, v, ph) => `<input type="text" value="${aiEsc(v)}" placeholder="${ph}" onchange="aiSetGroupField(${gi}, '${field}', this.value)"
        class="w-full min-w-[110px] px-2 py-1 border rounded text-xs ${v ? 'border-slate-200' : 'border-amber-400 bg-amber-50'}">`;
    const tr = groups.map((g, gi) => {
        const o = g.first;
        const matchTxt = o.match ? `<span class="text-emerald-700 font-bold">상품관리 ${aiEsc(o.match.code)}</span>` : '<span class="text-slate-400">처음 보는 상품</span>';
        return `<tr class="${g.removed ? 'opacity-40 line-through' : !o.wholesaleCompany ? 'bg-amber-50/60' : ''} border-b border-slate-100 align-top">
            <td class="px-2 py-2 min-w-[180px]">${o.mallProduct ? aiEsc(aiMallText(o)) : '<span class="text-rose-600">(상품명 없음)</span>'}</td>
            <td class="px-2 py-2 text-center font-bold">${g.removed ? '-' : g.qty}</td>
            <td class="px-2 py-2">${input(gi, 'wholesaleCompany', o.wholesaleCompany, '도매처명 (예: 청평화 A동 12호)')}</td>
            <td class="px-2 py-2">${input(gi, 'wholesaleProduct', o.wholesaleProduct, '도매상품명 (모르면 비워두세요)')}</td>
            <td class="px-2 py-2 whitespace-nowrap text-[11px]">${matchTxt}</td>
            <td class="px-2 py-2"><button onclick="aiToggleGroup(${gi})" class="px-2 py-1 border border-slate-200 rounded text-[11px] font-bold text-slate-600 hover:bg-slate-50 whitespace-nowrap">${g.removed ? '되살리기' : '빼기'}</button></td>
        </tr>`;
    }).join('');
    box.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
                <p class="text-sm font-bold text-slate-800">📋 ${aiEsc(aiOrder.fileName)}${aiOrder.sheetName ? ` <span class="text-xs font-normal text-slate-500">· '${aiEsc(aiOrder.sheetName)}' 시트를 읽었어요</span>` : ''} ${aiOrder.platform ? `<span class="ml-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px]">${aiEsc(aiOrder.platform)} 양식</span>` : ''}</p>
                <p class="text-xs text-slate-500 mt-0.5">주문 ${live.length}줄 · 상품 ${groups.filter(g => !g.removed).length}가지 · 이 화면은 <b>사입 목록만 정리</b>해요 (주문 접수·저장 안 됨)</p>
            </div>
            <button onclick="aiReset()" class="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-lg">다른 파일 올리기</button>
        </div>
        ${noCompany ? `<p class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">처음 보는 상품 ${noCompany}가지는 <b>도매처명</b>을 적어 주세요. 비워두면 사입 목록에 '(도매처 없음)'으로 모여요.</p>` : ''}
        <div class="overflow-x-auto border border-slate-200 rounded-lg">
            <table class="w-full text-xs">
                <thead class="bg-slate-50 text-slate-500"><tr>
                    <th class="px-2 py-2 text-left">쇼핑몰 상품 / 옵션</th><th class="px-2 py-2">주문 수량</th>
                    <th class="px-2 py-2 text-left">도매처명</th><th class="px-2 py-2 text-left">도매상품명</th><th class="px-2 py-2 text-left">상품관리</th><th></th>
                </tr></thead>
                <tbody>${tr}</tbody>
            </table>
        </div>
        ${regCount ? `<div class="flex flex-wrap items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <span class="text-xs text-emerald-800">적어 주신 도매처를 기억해 둘까요? 다음부터 같은 상품은 저절로 채워져요.</span>
            <button id="btn-buy-remember" onclick="aiBuyRemember()" class="px-2.5 py-1 bg-white border border-emerald-300 hover:bg-emerald-100 text-emerald-800 text-[11px] font-bold rounded">상품관리에 기억하기 (${regCount}가지)</button>
        </div>` : ''}
        ${aiBuyBox(live)}
        ${aiShipBox(live)}`;
    box.classList.remove('hidden');
    aiEl('drop').classList.add('hidden');
}

// ---------------------------------------------------------------------
// 내 택배 주문 목록에 넣기 (2026-11-20 대표님 요청, my-ship.html · supabase/ship_orders.sql)
//  직접 택배를 보내는 업체가 같은 주문서로 운송장 엑셀까지 만들 수 있게 받는분·주소·상품을 저장
//  같은 주문번호(또는 주문번호가 없으면 같은 날 같은 받는분·연락처·상품)는 두 번 넣지 않음
// ---------------------------------------------------------------------
function aiShipBox(live) {
    if (!live.length) return '';
    const done = aiOrder.shipSaved;
    return `<div id="ai-ship-box" class="border border-blue-200 bg-blue-50/60 rounded-lg p-3 flex flex-wrap items-center gap-2">
        <div class="flex-1 min-w-[240px]">
            <p class="text-sm font-black text-blue-800">📮 직접 택배로 보내시나요?</p>
            <p class="text-[11px] text-slate-600 mt-0.5">이 주문서를 <b>내 택배 주문 목록</b>에 넣어 두면, 대표님이 쓰시는 <b>운송장 프로그램 엑셀 양식 그대로</b> 내려받을 수 있어요. (밤낮딜리버리 접수 아님 · 손님 정보는 90일 뒤 자동 삭제)</p>
        </div>
        ${done ? `<span class="text-xs font-bold text-blue-800">✅ ${done}</span>
            <a href="/my-ship" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg">내 택배 주문 보기 →</a>`
            : `<button id="btn-ship-save" onclick="aiShipSave()" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg">📮 내 택배 주문 목록에 넣기 (${live.length}건)</button>`}
    </div>`;
}

async function aiShipSave() {
    const live = aiOrder.rows.filter(o => !o.removed);
    if (!live.length || !supabaseClient) return;
    const btn = document.getElementById('btn-ship-save');
    if (btn) btn.disabled = true;
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    // 이미 넣은 주문 (최근 90일, 내 것만 — 다른 업체 것은 DB가 돌려주지 않음)
    const { data: old, error: oldErr } = await fetchAllRows(() => supabaseClient.from('seller_ship_orders')
        .select('order_no,recipient,phone,product,option,ship_date').order('id'));
    if (oldErr) {
        alert('아직 준비 중이에요. 관리자에게 문의해 주세요. (ship_orders.sql 실행 필요)');
        if (btn) btn.disabled = false;
        return;
    }
    const key = (d, o) => [d, o.recipient, o.phone, o.product, o.option].map(aiNorm).join('|');
    const haveNo = new Set((old || []).filter(r => r.order_no).map(r => aiNorm(r.order_no)));
    const haveKey = new Set((old || []).map(r => key(r.ship_date, r)));
    const rows = [];
    let skipped = 0;
    live.forEach(o => {
        const r = {
            company: currentSellerAccount.company, ship_date: today, source_file: aiOrder.fileName.slice(0, 200), platform: aiOrder.platform || '',
            order_no: o.orderNo || '', recipient: o.recipient, phone: o.phone, phone2: o.phone2 || '', zipcode: o.zipcode || '',
            address: o.addrBase || o.address, address_detail: o.addrDetail || '', product: o.mallProduct, option: o.option || '',
            qty: o.qty, memo: o.memo || '',
        };
        if ((r.order_no && haveNo.has(aiNorm(r.order_no))) || haveKey.has(key(today, r))) { skipped++; return; }
        if (r.order_no) haveNo.add(aiNorm(r.order_no));
        haveKey.add(key(today, r));
        rows.push(r);
    });
    if (rows.length) {
        const { error } = await supabaseClient.from('seller_ship_orders').insert(rows);
        if (error) { alert('저장하지 못했어요.\n' + dbErrorMessage(error)); if (btn) btn.disabled = false; return; }
    }
    aiOrder.shipSaved = `${rows.length}건 넣었어요` + (skipped ? ` (이미 있던 ${skipped}건은 빼고)` : '');
    aiRender();
}
