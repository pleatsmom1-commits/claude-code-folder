// =====================================================================
// 관리자: 직원 아이디 + 작업 기록 (supabase/staff_activity.sql)
//  - [직원 아이디] 탭: 대표가 직원 아이디를 만들고, 끄고, 다시 켭니다.
//    비밀번호는 대표가 정하지 않고, 직원 이메일로 '비밀번호 정하기' 메일이 가서 직원이 직접 정합니다.
//  - [작업 기록] 탭: 관리자(대표·직원)가 주문·재고·정산 등을 바꾼 기록을 누가·언제·무엇을 순서로 봅니다.
//  index.html 의 supabaseClient, sellerProfiles, currentSellerAccount, escapeHtml, dbErrorMessage,
//  formatKstDateTime, kstDateKey, getAppUrl, fetchSellersFromDB, updateSellerProfile 를 함께 씁니다.
// =====================================================================

// 지금 로그인한 관리자 아이디가 대표인지 (SQL 실행 전에는 admin_level 칸이 없으므로 대표로 봅니다)
function isOwnerAccount() {
    return currentRole === 'admin' && (currentSellerAccount?.admin_level || 'owner') === 'owner';
}
function isStaffProfile(p) { return p && p.admin_level === 'staff'; }

// ---------------------------------------------------------------------
// 1. 직원 아이디
// ---------------------------------------------------------------------
let staffPanelReady = false;

function onStaffTabOpened() {
    const panel = document.getElementById('admin-staff-panel');
    if (!staffPanelReady) {
        staffPanelReady = true;
        panel.innerHTML = `
            <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
                <div>
                    <h3 class="text-base font-bold text-slate-900">직원 아이디</h3>
                    <p class="text-xs text-slate-500 mt-1">직원마다 아이디를 따로 쓰면 <b>[작업 기록]</b>에 누가 했는지 이름이 남아요. 직원도 관리자 화면 기능을 대표님과 똑같이 쓸 수 있고, 이 [직원 관리] 메뉴만 대표님만 보입니다.</p>
                </div>
                <form id="staff-add-form" onsubmit="createStaffAccount(event)" class="bg-indigo-50/60 border border-indigo-100 rounded-xl p-4 space-y-3">
                    <div class="flex flex-wrap items-end gap-2">
                        <label class="text-xs font-bold text-slate-700">직원 이름
                            <input type="text" id="staff-add-name" required maxlength="20" placeholder="예: 김민지" class="mt-1 block w-40 px-3 py-2 border rounded-lg text-sm bg-white focus:outline-indigo-500">
                        </label>
                        <label class="text-xs font-bold text-slate-700">직원 이메일 (로그인 아이디)
                            <input type="email" id="staff-add-email" required placeholder="staff@email.com" class="mt-1 block w-64 px-3 py-2 border rounded-lg text-sm bg-white focus:outline-indigo-500">
                        </label>
                        <button type="submit" id="staff-add-btn" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-sm rounded-lg shadow flex items-center gap-1.5">
                            <i data-lucide="user-plus" class="w-4 h-4"></i> 직원 아이디 만들기
                        </button>
                    </div>
                    <ol class="text-[11px] text-slate-600 list-decimal pl-4 space-y-0.5">
                        <li>만들면 직원 이메일로 <b>'비밀번호 재설정'</b> 메일이 가요. (비밀번호는 직원이 직접 정해서 대표님도 모르게 안전해요)</li>
                        <li>직원이 메일의 링크를 눌러 비밀번호를 정한 뒤, 주문사이트 <b>[관리자 로그인]</b>으로 들어오면 됩니다.</li>
                        <li>메일이 안 오면 직원이 로그인 화면의 <b>[비밀번호 찾기]</b>를 눌러도 됩니다.</li>
                    </ol>
                </form>
                <div class="overflow-x-auto">
                    <table class="w-full text-left text-xs">
                        <thead class="bg-slate-800 text-slate-200 font-bold">
                            <tr>
                                <th class="p-3">구분</th>
                                <th class="p-3">이름 (작업 기록에 보이는 이름)</th>
                                <th class="p-3">이메일(로그인 아이디)</th>
                                <th class="p-3">상태</th>
                                <th class="p-3">만든 날</th>
                                <th class="p-3 text-center">관리</th>
                            </tr>
                        </thead>
                        <tbody id="staff-list" class="divide-y divide-slate-100 text-slate-700"></tbody>
                    </table>
                </div>
                <p id="staff-sql-notice" class="hidden text-[11px] font-bold text-rose-600">직원 기능을 쓰려면 Supabase 에서 supabase/staff_activity.sql 을 먼저 실행해 주세요.</p>
            </div>`;
        lucide.createIcons();
    }
    fetchSellersFromDB();
    renderStaffTable();
}

function renderStaffTable() {
    const tbody = document.getElementById('staff-list');
    if (!tbody) return;
    const sqlReady = sellerProfiles.some(p => 'admin_level' in p);
    document.getElementById('staff-sql-notice').classList.toggle('hidden', sqlReady || sellerProfiles.length === 0);
    const owners = sellerProfiles.filter(p => p.role === 'admin' && !isStaffProfile(p));
    const staff = sellerProfiles.filter(isStaffProfile)
        .sort((a, b) => (a.role === 'admin' ? 0 : 1) - (b.role === 'admin' ? 0 : 1) || String(a.created_at).localeCompare(String(b.created_at)));
    const btn = (label, action, cls, id) =>
        `<button data-id="${escapeHtml(id)}" onclick="${action}" class="px-2 py-1 ${cls} font-bold rounded text-[11px] whitespace-nowrap">${label}</button>`;
    const row = (p, kind) => {
        const on = p.role === 'admin';
        const me = p.id === currentUserId;
        let actions = '';
        if (kind === 'owner') {
            actions = me ? btn('이름 바꾸기', 'renameStaff(this.dataset.id)', 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100', p.id) : '<span class="text-slate-300">-</span>';
        } else {
            actions = btn('이름 바꾸기', 'renameStaff(this.dataset.id)', 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100', p.id)
                + (on
                    ? btn('비밀번호 메일 다시 보내기', 'resendStaffMail(this.dataset.id)', 'bg-slate-100 text-slate-600 hover:bg-slate-200', p.id)
                      + btn('끄기', 'setStaffOn(this.dataset.id, false)', 'bg-rose-50 text-rose-600 hover:bg-rose-100', p.id)
                    : btn('다시 켜기', 'setStaffOn(this.dataset.id, true)', 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100', p.id));
        }
        const badge = kind === 'owner'
            ? '<span class="px-2 py-1 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700">대표</span>'
            : '<span class="px-2 py-1 rounded text-[10px] font-bold bg-sky-100 text-sky-700">직원</span>';
        const state = on
            ? '<span class="px-2 py-1 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">사용 중</span>'
            : '<span class="px-2 py-1 rounded text-[10px] font-bold bg-slate-200 text-slate-500">꺼짐 (로그인 불가)</span>';
        return `<tr class="hover:bg-slate-50 ${on ? '' : 'opacity-60'}">
            <td class="p-3">${badge}</td>
            <td class="p-3 font-bold text-slate-900">${escapeHtml(p.name || '(이름 없음)')}${me ? ' <span class="text-[10px] text-indigo-500">(나)</span>' : ''}</td>
            <td class="p-3">${escapeHtml(p.email || '-')}</td>
            <td class="p-3">${state}</td>
            <td class="p-3 text-slate-400 whitespace-nowrap">${escapeHtml(formatKstDateTime(p.created_at))}</td>
            <td class="p-3"><div class="flex items-center justify-center gap-1 flex-wrap">${actions}</div></td>
        </tr>`;
    };
    tbody.innerHTML = owners.map(p => row(p, 'owner')).join('') + staff.map(p => row(p, 'staff')).join('')
        + (staff.length ? '' : `<tr><td colspan="6" class="text-center py-5 text-slate-400">아직 만든 직원 아이디가 없습니다. 위에서 이름과 이메일을 넣고 [직원 아이디 만들기]를 눌러 주세요.</td></tr>`);
}

function staffRandomPassword() {
    const a = new Uint8Array(18);
    crypto.getRandomValues(a);
    return btoa(String.fromCharCode(...a)).replace(/[^A-Za-z0-9]/g, '') + 'Aa1!';
}

async function sendStaffPasswordMail(email) {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: getAppUrl() });
    return error
        ? `다만 '비밀번호 재설정' 메일은 보내지 못했어요. (${authErrorMessage(error)})\n직원이 주문사이트 로그인 화면의 [비밀번호 찾기]를 눌러 직접 받으면 됩니다.`
        : `직원 이메일(${email})로 '비밀번호 재설정' 메일을 보냈어요.\n직원이 메일의 링크를 눌러 비밀번호를 정한 뒤 [관리자 로그인]으로 들어오면 됩니다.\n(가입 확인 메일이 함께 오면 그건 무시해도 돼요)`;
}

async function createStaffAccount(e) {
    e.preventDefault();
    if (!isOwnerAccount()) { alert('직원 아이디는 대표 아이디로만 만들 수 있어요.'); return; }
    const name = document.getElementById('staff-add-name').value.trim();
    const email = document.getElementById('staff-add-email').value.trim().toLowerCase();
    if (!name) { alert('직원 이름을 입력해 주세요.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert('이메일 주소를 다시 확인해 주세요.'); return; }

    const existing = sellerProfiles.find(p => String(p.email || '').toLowerCase() === email);
    if (existing && existing.role === 'admin') { alert(isStaffProfile(existing) ? '이미 사용 중인 직원 아이디입니다.' : '대표 아이디는 직원으로 바꿀 수 없습니다.'); return; }
    if (existing && !isStaffProfile(existing)
        && !confirm(`[${email}] 은 이미 가입된 아이디입니다 (상호: ${existing.company}).\n이 아이디를 직원 아이디로 바꿀까요?\n(거래처가 쓰던 아이디라면 [취소]를 누르고 직원용 새 이메일을 넣어 주세요)`)) return;
    if (!existing && !confirm(`직원 아이디를 만들까요?\n\n이름: ${name}\n아이디(이메일): ${email}\n\n직원은 관리자 화면 기능(주문·재고·정산 등)을 쓸 수 있어요.`)) return;

    const btnEl = document.getElementById('staff-add-btn');
    btnEl.disabled = true;
    try {
        if (!existing) {
            // 대표님 로그인이 풀리지 않도록, 가입은 따로 만든 임시 연결로 합니다.
            const tmp = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
                auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'bamnat-staff-signup' }
            });
            const { error } = await tmp.auth.signUp({
                email,
                password: staffRandomPassword(),
                options: { data: { company: '직원:' + email, name }, emailRedirectTo: getAppUrl() }
            });
            if (error && !/already registered|already exists/i.test(error.message || '')) {
                alert('직원 아이디를 만들지 못했어요.\n\n' + authErrorMessage(error));
                return;
            }
        }
        const { error: rpcError } = await supabaseClient.rpc('staff_set', { p_email: email, p_name: name, p_on: true });
        if (rpcError) {
            alert('직원으로 지정하지 못했어요.\n\n' + dbErrorMessage(rpcError)
                + (/staff_set|function/i.test(rpcError.message || '') ? '\n\n(Supabase 에서 supabase/staff_activity.sql 을 먼저 실행해 주세요)' : ''));
            return;
        }
        const mailMsg = await sendStaffPasswordMail(email);
        document.getElementById('staff-add-form').reset();
        await fetchSellersFromDB();
        alert(`[${name}] 직원 아이디를 만들었어요.\n\n${mailMsg}`);
    } finally {
        btnEl.disabled = false;
    }
}

async function setStaffOn(id, on) {
    const p = sellerProfiles.find(x => x.id === id);
    if (!p) return;
    const msg = on
        ? `[${p.name || p.email}] 직원 아이디를 다시 켤까요?\n다시 로그인하면 관리자 화면을 쓸 수 있어요.`
        : `[${p.name || p.email}] 직원 아이디를 끌까요?\n바로 관리자 기능이 막히고 로그인할 수 없어요.\n(그동안의 작업 기록은 그대로 남아요)`;
    if (!confirm(msg)) return;
    const { error } = await supabaseClient.rpc('staff_set', { p_email: p.email, p_name: p.name || '', p_on: on });
    if (error) { alert('처리하지 못했어요.\n\n' + dbErrorMessage(error)); return; }
    await fetchSellersFromDB();
    alert(on ? '다시 켰어요.' : '껐어요.');
}

async function renameStaff(id) {
    const p = sellerProfiles.find(x => x.id === id);
    if (!p) return;
    const name = (prompt('작업 기록에 보일 이름을 입력해 주세요.', p.name || '') || '').trim();
    if (!name || name === p.name) return;
    if (isStaffProfile(p)) {
        const { error } = await supabaseClient.rpc('staff_set', { p_email: p.email, p_name: name, p_on: p.role === 'admin' });
        if (error) { alert('이름을 바꾸지 못했어요.\n\n' + dbErrorMessage(error)); return; }
        await fetchSellersFromDB();
    } else {
        if (!await updateSellerProfile(id, { name })) return;
        if (id === currentUserId) { currentSellerAccount.name = name; updateNavUserArea(); }
        renderStaffTable();
    }
}

async function resendStaffMail(id) {
    const p = sellerProfiles.find(x => x.id === id);
    if (!p || !confirm(`[${p.name || p.email}] 직원 이메일로 '비밀번호 재설정' 메일을 다시 보낼까요?`)) return;
    alert(await sendStaffPasswordMail(p.email));
}

// ---------------------------------------------------------------------
// 2. 작업 기록
// ---------------------------------------------------------------------
const ACTIVITY_TABLE_LABEL = {
    orders: '주문', admin_hidden_orders: '주문 숨기기', admin_separate_orders: '주문 따로 처리됨',
    quick_orders: '비회원 간단접수', pickup_requests: '사입픽업요청',
    shipments: '운송장 전송', couriers: '택배사',
    stock_items: '재고관리', stock_visibility: '셀러에게 재고 숨기기', products: '상품관리', product_aliases: '상품 다른 이름',
    inventory: '재고표', inventory_days: '재고정리완료', order_stock_picks: '재고출고',
    settlements: '정산서', settle_contacts: '정산서 받는 번호',
    profiles: '셀러·직원 정보', inquiries: 'AI 상담 문의', ai_faq: 'AI 상담 답변',
};
const ACTIVITY_MENUS = {
    order: { label: '주문·픽업', tables: ['orders', 'admin_hidden_orders', 'admin_separate_orders', 'quick_orders', 'pickup_requests'] },
    ship: { label: '송장', tables: ['shipments', 'couriers'] },
    stock: { label: '재고·상품·출고', tables: ['stock_items', 'stock_visibility', 'products', 'product_aliases', 'inventory', 'inventory_days', 'order_stock_picks'] },
    settle: { label: '정산', tables: ['settlements', 'settle_contacts'] },
    sellers: { label: '셀러·직원', tables: ['profiles'] },
    inquiry: { label: 'AI 상담', tables: ['inquiries', 'ai_faq'] },
};
const ACTIVITY_COL_LABEL = {
    status: '상태', ship_status: '출고상태', recipient: '받는분', phone: '연락처', address: '주소', detail_address: '상세주소',
    zipcode: '우편번호', product: '상품명', qty: '수량', memo: '메모', bamnat_memo: '밤낮 메모', wholesale_company: '도매업체',
    wholesale_product: '도매상품', retail_product: '소매상품', tracking_no: '송장번호', courier: '택배사', order_no: '주문번호',
    item_no: '상품번호', seller_company: '업체', company: '업체', sender_name: '송화인', cs_phone: 'CS 연락처', name: '이름',
    role: '권한', admin_level: '대표/직원', accepted_at: '관리자 접수시각', shipped_at: '출고시각', keep_request: '보관요청',
    keep_memo: '보관메모', admin_memo: '관리자 메모', handled_at: '처리시각', qty_a: '상품화', qty_b: '미상품화',
    qty_defect: '불량', location: '재고위치', quantity: '수량', color: '컬러', size: '사이즈', total: '청구금액',
    result: '청구/영수', data: '정산 내용', sent_at: '발송시각', send_status: '발송결과', items: '송장 목록', hidden: '숨김',
    biz_no: '사업자번호', biz_name: '상호(법인명)', biz_ceo: '대표자(사업자)', tax_email: '세금계산서 이메일',
    deleted_at: '삭제시각', mall_names: '쇼핑몰상품명', photo_url: '사진', stocked_on: '재고생성일', shipped_on: '재고출고일',
    shipped_note: '출고 메모', customer: '반품고객', label: '라벨', code: '상품코드', settle_date: '정산일', ship_date: '출고일',
    order_type: '주문종류', confirmed_at: '확정시각', times: '확정횟수', answer: '답변', question: '질문', prepay: '대납',
    prepay_misong: '대납미송', store_name: '매장상호', store_location: '매장위치', alias: '다른 이름',
    seller_order_no: '셀러 접수번호', origin_created_at: '처음 접수시각', created_at: '접수시각', email: '이메일',
};
const ACTIVITY_ACTION_LABEL = { insert: '추가', update: '수정', delete: '삭제' };
const ACTIVITY_MAX_ROWS = 5000;
let activityRows = [];
let activityPanelReady = false;

function onActivityTabOpened() {
    const panel = document.getElementById('admin-activity-panel');
    if (!activityPanelReady) {
        activityPanelReady = true;
        const today = kstDateKey();
        panel.innerHTML = `
            <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
                <div>
                    <h3 class="text-base font-bold text-slate-900">작업 기록</h3>
                    <p class="text-xs text-slate-500 mt-1">관리자 아이디(대표·직원)로 주문·픽업·송장·재고·정산·셀러 정보를 추가·수정·삭제하면 <b>누가 · 언제 · 무엇을</b> 했는지 자동으로 남아요. 셀러가 직접 한 일은 남지 않아요. 기록은 대표님만 볼 수 있고 아무도 고치거나 지울 수 없어요.</p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <input type="date" id="activity-from" value="${today}" class="px-3 py-1.5 border rounded-lg text-xs">
                    <span class="text-xs text-slate-400">~</span>
                    <input type="date" id="activity-to" value="${today}" class="px-3 py-1.5 border rounded-lg text-xs">
                    <select id="activity-actor" class="px-3 py-1.5 border rounded-lg text-xs font-medium"><option value="ALL">모든 사람</option></select>
                    <select id="activity-menu" class="px-3 py-1.5 border rounded-lg text-xs font-medium">
                        <option value="ALL">모든 메뉴</option>
                        ${Object.entries(ACTIVITY_MENUS).map(([k, m]) => `<option value="${k}">${m.label}</option>`).join('')}
                    </select>
                    <input type="text" id="activity-search" oninput="renderActivityTable()" placeholder="업체·받는분·상품명 검색" class="px-3 py-1.5 border rounded-lg text-xs w-48 focus:outline-indigo-500">
                    <button onclick="fetchActivity()" class="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg shadow flex items-center gap-1">
                        <i data-lucide="search" class="w-3.5 h-3.5"></i> 조회
                    </button>
                    <span id="activity-count" class="text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-full">-</span>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-left text-xs">
                        <thead class="bg-slate-800 text-slate-200 font-bold">
                            <tr>
                                <th class="p-3 whitespace-nowrap">시간</th>
                                <th class="p-3 whitespace-nowrap">누가</th>
                                <th class="p-3 whitespace-nowrap">메뉴</th>
                                <th class="p-3 whitespace-nowrap">작업</th>
                                <th class="p-3">무엇을</th>
                            </tr>
                        </thead>
                        <tbody id="activity-list" class="divide-y divide-slate-100 text-slate-700"></tbody>
                    </table>
                </div>
            </div>`;
        lucide.createIcons();
    }
    fillActivityActors();
    fetchActivity();
}

function fillActivityActors() {
    const sel = document.getElementById('activity-actor');
    if (!sel) return;
    const keep = sel.value;
    const people = sellerProfiles.filter(p => p.role === 'admin' || isStaffProfile(p));
    sel.innerHTML = '<option value="ALL">모든 사람</option>'
        + people.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.email)} (${isStaffProfile(p) ? '직원' : '대표'})</option>`).join('');
    if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
}

function kstDayStartIso(day, addDays = 0) {
    const d = new Date(`${day}T00:00:00+09:00`);
    d.setUTCDate(d.getUTCDate() + addDays);
    return d.toISOString();
}

async function fetchActivity() {
    const from = document.getElementById('activity-from').value;
    const to = document.getElementById('activity-to').value || from;
    if (!from) { alert('날짜를 골라 주세요.'); return; }
    const actor = document.getElementById('activity-actor').value;
    const menu = document.getElementById('activity-menu').value;
    const tbody = document.getElementById('activity-list');
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-slate-400">불러오는 중…</td></tr>`;
    let all = [];
    for (let offset = 0; offset < ACTIVITY_MAX_ROWS; offset += 1000) {
        let q = supabaseClient.from('admin_activity').select('*')
            .gte('at', kstDayStartIso(from)).lt('at', kstDayStartIso(to, 1))
            .order('at', { ascending: false }).order('id', { ascending: false });
        if (actor !== 'ALL') q = q.eq('actor_id', actor);
        if (menu !== 'ALL') q = q.in('table_name', ACTIVITY_MENUS[menu].tables);
        const { data, error } = await q.range(offset, offset + 999);
        if (error) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-rose-600 font-bold">작업 기록을 불러오지 못했어요. ${escapeHtml(dbErrorMessage(error))}<br>(Supabase 에서 supabase/staff_activity.sql 을 실행했는지 확인해 주세요)</td></tr>`;
            return;
        }
        all = all.concat(data || []);
        if (!data || data.length < 1000) break;
    }
    activityRows = all;
    renderActivityTable();
}

function activityValueText(v, col) {
    if (v === null || v === undefined || v === '') return '(빈칸)';
    if (typeof v === 'boolean') return v ? '예' : '아니오';
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return formatKstDateTime(v);
    if (col === 'admin_level') return v === 'staff' ? '직원' : v === 'owner' ? '대표' : v;
    if (col === 'role') return v === 'admin' ? '관리자' : v === 'seller' ? '셀러' : v;
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
}

// 어떤 줄인지: 업체 · 받는분/매장 · 상품 · 날짜
function activityRowTitle(r) {
    const i = r.info || {};
    const parts = [
        i.seller_company || i.company,
        i.recipient || i.store_name || i.name || i.email || i.question,
        i.product || i.retail_product || i.wholesale_product,
        [i.color, i.size].filter(Boolean).join(' / '),
        i.settle_date || i.ship_date || i.day,
    ].filter(Boolean).map(String);
    if (r.table_name === 'orders' && i.order_no) parts.push(`#${i.order_no}${i.item_no ? '-' + i.item_no : ''}`);
    if (!parts.length && r.row_key) parts.push(`번호 ${r.row_key}`);
    return parts.join(' · ');
}

function activityChangeText(changes) {
    if (!changes) return '';
    return Object.entries(changes).map(([col, [before, after]]) =>
        `<span class="inline-block mr-2"><b>${escapeHtml(ACTIVITY_COL_LABEL[col] || col)}</b>: <span class="text-slate-400 line-through">${escapeHtml(activityValueText(before, col))}</span> → <span class="text-indigo-700 font-bold">${escapeHtml(activityValueText(after, col))}</span></span>`
    ).join('');
}

// 한 번에 같이 저장된 것(예: 주문 20건 한 번에 마감)은 한 줄로 묶어서 보여줍니다.
function groupActivity(rows) {
    const groups = [];
    const byKey = new Map();
    rows.forEach(r => {
        const key = `${r.tx}|${r.actor_id}|${r.table_name}|${r.action}`;
        let g = byKey.get(key);
        if (!g) { g = { key, first: r, rows: [] }; byKey.set(key, g); groups.push(g); }
        g.rows.push(r);
    });
    return groups;
}

function activityGroupSummary(g) {
    if (g.rows.length === 1) return '';
    // 모든 줄이 같은 칸을 같은 값으로 바꿨으면 한 번만 보여줌 (예: 상태 접수대기 → 접수완료)
    const cols = new Map();
    g.rows.forEach(r => Object.entries(r.changes || {}).forEach(([c, v]) => {
        const s = JSON.stringify(v);
        if (!cols.has(c)) cols.set(c, new Set());
        cols.get(c).add(s);
    }));
    return [...cols.entries()].map(([c, set]) => {
        if (set.size === 1) {
            const [before, after] = JSON.parse([...set][0]);
            return `<span class="inline-block mr-2"><b>${escapeHtml(ACTIVITY_COL_LABEL[c] || c)}</b>: <span class="text-slate-400 line-through">${escapeHtml(activityValueText(before, c))}</span> → <span class="text-indigo-700 font-bold">${escapeHtml(activityValueText(after, c))}</span></span>`;
        }
        return `<span class="inline-block mr-2"><b>${escapeHtml(ACTIVITY_COL_LABEL[c] || c)}</b> 바뀜</span>`;
    }).join('');
}

function renderActivityTable() {
    const tbody = document.getElementById('activity-list');
    if (!tbody) return;
    const keyword = (document.getElementById('activity-search').value || '').trim().toLowerCase();
    const rows = keyword
        ? activityRows.filter(r => (activityRowTitle(r) + ' ' + JSON.stringify(r.changes || {})).toLowerCase().includes(keyword))
        : activityRows;
    const groups = groupActivity(rows);
    document.getElementById('activity-count').innerText = `${groups.length}건 (변경 ${rows.length}줄)`
        + (activityRows.length >= ACTIVITY_MAX_ROWS ? ` · 최근 ${ACTIVITY_MAX_ROWS}줄까지만` : '');
    if (!groups.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-slate-400">이 기간에 남은 작업 기록이 없습니다.</td></tr>`;
        return;
    }
    const actionCls = { insert: 'bg-emerald-100 text-emerald-700', update: 'bg-amber-100 text-amber-700', delete: 'bg-rose-100 text-rose-700' };
    tbody.innerHTML = groups.map(g => {
        const r = g.first;
        const n = g.rows.length;
        const who = `<span class="font-bold text-slate-900">${escapeHtml(r.actor_name || '-')}</span> <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${r.actor_level === 'staff' ? 'bg-sky-100 text-sky-700' : 'bg-indigo-100 text-indigo-700'}">${r.actor_level === 'staff' ? '직원' : '대표'}</span>`;
        const what = n === 1
            ? `<div class="font-bold text-slate-800">${escapeHtml(activityRowTitle(r))}</div><div class="mt-0.5">${activityChangeText(r.changes)}</div>`
            : `<div class="font-bold text-slate-800">${n}건 한 번에 ${ACTIVITY_ACTION_LABEL[r.action] || r.action}</div>
               <div class="mt-0.5">${activityGroupSummary(g)}</div>
               <details class="mt-1"><summary class="cursor-pointer text-[11px] text-indigo-600 font-bold">하나씩 보기</summary>
                 <ul class="mt-1 space-y-0.5 text-[11px] text-slate-600 max-h-64 overflow-y-auto">
                   ${g.rows.slice(0, 300).map(x => `<li>· ${escapeHtml(activityRowTitle(x))} ${activityChangeText(x.changes)}</li>`).join('')}
                   ${n > 300 ? `<li class="text-slate-400">… 외 ${n - 300}건</li>` : ''}
                 </ul></details>`;
        return `<tr class="hover:bg-slate-50 align-top">
            <td class="p-3 whitespace-nowrap text-slate-500">${escapeHtml(formatKstDateTime(r.at))}</td>
            <td class="p-3 whitespace-nowrap">${who}</td>
            <td class="p-3 whitespace-nowrap">${escapeHtml(ACTIVITY_TABLE_LABEL[r.table_name] || r.table_name)}</td>
            <td class="p-3 whitespace-nowrap"><span class="px-2 py-1 rounded text-[10px] font-bold ${actionCls[r.action] || ''}">${ACTIVITY_ACTION_LABEL[r.action] || r.action}${n > 1 ? ` ${n}건` : ''}</span></td>
            <td class="p-3 min-w-[320px]">${what}</td>
        </tr>`;
    }).join('');
}
