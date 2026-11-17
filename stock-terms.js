// =====================================================================
// 재고 보관 서비스 이용약관 동의 창
//  - 셀러가 재고 화면([재고 확인] /stock, [재고 증감] /stock-history)을 처음 열 때 뜹니다.
//  - 동의하면 supabase/stock_terms.sql 의 stock_terms_agree() 로 업체·계정·날짜와 시간·약관 버전을 기록합니다.
//  - 약관을 바꾸면 STOCK_TERMS_VERSION 을 올립니다 (셀러에게 불리한 변경이면 다시 동의 창이 뜸).
//  - 아직 DB 설정(stock_terms.sql) 전이면 창을 띄우지 않고 그대로 재고 화면을 보여줍니다.
// 사용: const ok = await requireStockTerms(client, profile);  (관리자·보기 전용이면 바로 true)
// =====================================================================
(function () {
    const STOCK_TERMS_VERSION = '2026-11-17';

    // 한눈에 보는 요약 (창 맨 위)
    const SUMMARY = [
        ['재고 기준', '당일 사입 상품은 바로 출고하고, <b>남은 수량만 오후에 입고</b>해 재고로 잡습니다.'],
        ['출고 순서', '보관 재고 출고요청은 <b>다음 날 오전</b>에 출고합니다.'],
        ['입고 수량', '입고 당일 재고 화면에 공개되는 수량이 기준입니다.'],
        ['이의 제기', '재고가 확정된 날부터 <b>7영업일 안에</b> 카카오톡 채널로 알려주세요.'],
        ['허용 오차', '한 달 출고 수량의 <b>0.3%</b>까지는 정상 작업 범위로 봅니다.'],
        ['배상', '회사 책임으로 없어진 상품은 <b>원가(도매 사입가)</b> 기준으로 배상합니다.'],
        ['정기 실사', '<b>매월 1회</b> 직접 세고, 결과를 [재고 증감]에 "재고 정리"로 공개합니다.'],
    ];

    // 약관 전문 [조 제목, 본문(문단 또는 번호 목록)]
    const ARTICLES = [
        ['제1조 (목적)', '이 약관은 밤낮딜리버리(이하 "회사")가 회원(이하 "셀러")의 상품을 보관하고 입고·출고하는 재고 보관 서비스(이하 "서비스")의 이용 조건과, 재고 수량 차이가 생겼을 때의 처리 기준을 정합니다.'],
        ['제2조 (용어)', [
            '"재고 화면"은 셀러가 주문접수 사이트에서 보는 [재고 확인]과 [재고 증감] 화면을 말합니다.',
            '"확정 재고"는 회사가 그날 재고 정리를 마치고 확정한 수량을 말합니다. 회사가 따로 확정하지 않은 날은 매일 오후 7시에 자동으로 확정됩니다.',
            '"재고 정리"는 실사(직접 세어 봄), 불량 발견 등으로 회사가 재고 수량을 실제에 맞게 고친 것을 말합니다.',
            '"원가"는 셀러가 해당 상품을 사입한 도매 단가(부가세 별도)를 말합니다.',
            '"영업일"은 토요일, 일요일, 공휴일과 회사 휴무일을 뺀 날을 말합니다.',
        ]],
        ['제3조 (입고 검수와 확정)', [
            '회사는 입고된 상품의 수량과 옵션(컬러·사이즈)을 확인하고, 그 결과를 입고 당일 재고 화면에 공개합니다.',
            '재고의 기준 수량은 회사가 입고 때 확인한 수량으로 하며, 셀러가 보낸 수량(발주서·명세서)과 다르면 회사는 이를 셀러에게 알립니다.',
            '셀러가 제5조의 이의 기간 안에 이의를 제기하지 않으면 공개된 입고 수량을 확정 수량으로 봅니다.',
            '회사의 입고 검수는 수량과 겉으로 보이는 옵션을 확인하는 것이며, 상품 내부의 품질·기능까지 보증하지는 않습니다.',
        ]],
        ['제3조의2 (당일 사입 상품과 입출고 순서)', [
            '당일 사입되어 들어온 상품은 재고로 잡지 않고 바로 출고합니다.',
            '출고하고 남은 수량만 그날 오후에 입고하여 재고로 보관합니다.',
            '셀러가 보관 중인 재고에서 출고를 요청하면, 회사는 다음 날 오전에 사무실에 보관 중인 재고에서 출고 처리합니다.',
            '따라서 재고 화면에는 보통 오전에 출고, 오후에 입고가 표시되며, 당일 사입되어 바로 출고된 수량은 재고 내역에 나타나지 않습니다.',
        ]],
        ['제4조 (매일 재고 확정과 공개)', [
            '회사는 입고·출고·재고 정리로 재고가 바뀔 때마다 그 내역을 기록하고, 셀러는 재고 화면에서 날짜별·기간별로 확인할 수 있습니다.',
            '회사는 영업일마다 그날의 재고를 확정합니다.',
            '셀러는 재고 화면을 수시로 확인할 책임이 있으며, 확인하지 않았다는 이유만으로 제5조의 이의 기간이 늘어나지는 않습니다.',
        ]],
        ['제5조 (이의 제기)', [
            '셀러는 재고 화면에 공개된 입고·출고·재고 정리 내역에 대해, 그 날의 재고가 확정된 때부터 7영업일 안에 카카오톡 채널 또는 회사가 정한 방법으로 이의를 제기할 수 있습니다.',
            '회사는 이의를 받으면 해당 상품을 다시 세고, 3영업일 안에 결과를 알립니다. 회사 책임으로 확인되면 수량을 바로잡거나 제7조에 따라 배상합니다.',
            '이의 기간이 지나면 공개된 수량을 확정 수량으로 봅니다. 단, 회사의 고의 또는 중대한 과실이 확인되면 그러하지 않습니다.',
        ]],
        ['제6조 (허용 오차)', [
            '보관·피킹·포장 작업 중 생기는 미세한 수량 차이는 매달 1일부터 말일까지 한 달 단위로 계산합니다.',
            '한 달 동안 회사 책임으로 줄어든 수량이 그 달 셀러 출고 수량의 0.3% 이하이면, 정상 작업 범위로 보고 배상하지 않습니다.',
            '허용 오차를 넘는 수량에 대해서만 제7조에 따라 배상합니다.',
            '수량이 늘어난 차이(과재고)는 줄어든 차이와 같은 달 안에서 서로 빼서 계산할 수 있습니다.',
        ]],
        ['제7조 (배상 기준과 한도)', [
            '회사 책임으로 상품이 분실·파손되면 회사는 원가 기준으로 배상합니다. 판매가·예상 이익은 배상하지 않습니다.',
            '원가를 확인할 수 없으면 회사와 셀러가 협의하여 정하며, 사입 영수증 등으로 확인합니다.',
            '한 달 배상 총액은 그 달 셀러가 낸 보관·출고 수수료(대납금 및 부가세 제외)의 3배를 넘지 않습니다. 단, 회사의 고의 또는 중대한 과실이 있으면 이 한도를 적용하지 않습니다.',
            '배상금은 다음 달 정산서에서 빼는 방식으로 지급하는 것을 원칙으로 합니다.',
        ]],
        ['제8조 (회사가 책임지지 않는 경우)', [
            '셀러가 알려준 수량·상품명·옵션·라벨 정보가 틀려서 생긴 차이',
            '입고 전부터 있던 불량, 셀러 또는 도매처의 포장 불량으로 생긴 파손',
            '상품 자체의 성질(변색, 수축, 자연 마모 등)로 생긴 손상',
            '천재지변, 화재·침수 등 회사가 막을 수 없었던 사고',
            '택배사에 넘긴 뒤 배송 중 생긴 분실·파손 (택배사 보상 기준을 따름)',
            '제5조의 이의 기간이 지난 뒤에 제기된 차이',
        ], '다음의 경우 회사는 책임을 지지 않습니다. 단, 회사의 고의 또는 과실이 함께 있는 부분은 그러하지 않습니다.'],
        ['제9조 (정기 실사)', [
            '회사는 매월 1회 이상 보관 재고를 직접 세는 정기 실사를 하고, 그 결과를 재고 화면에 "재고 정리"로 공개합니다.',
            '셀러는 미리 요청하여 실사에 참관하거나, 추가 실사를 요청할 수 있습니다. 셀러 요청에 따른 추가 실사에는 별도 작업비가 들 수 있습니다.',
        ]],
        ['제10조 (셀러의 의무)', [
            '셀러는 입고 전 상품명·컬러·사이즈·수량을 상품관리 화면 또는 회사가 정한 방법으로 정확히 알려야 합니다.',
            '셀러는 법령상 보관·판매가 금지된 물품, 위험물, 상하는 물품을 맡길 수 없습니다.',
            '서비스를 끝낼 때 셀러는 남은 재고를 14일 안에 회수하거나 처리 방법을 알려야 합니다.',
        ]],
        ['제11조 (동의와 약관 변경)', [
            '셀러는 서비스를 처음 이용할 때 이 약관에 동의하며, 회사는 동의한 날짜와 시간을 기록합니다.',
            '회사가 약관을 바꾸려면 적용일 7일 전까지(셀러에게 불리한 변경은 30일 전까지) 재고 화면과 카카오톡 채널로 알리며, 셀러에게 불리한 변경은 다시 동의를 받습니다.',
            '이 약관에 없는 내용은 밤낮딜리버리 이용약관과 관련 법령을 따릅니다.',
        ]],
    ];

    const CSS = `
    #st-terms { position: fixed; inset: 0; z-index: 2147483000; background: rgba(15,23,42,.65); display: flex; align-items: center; justify-content: center; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
    #st-terms .box { background: #fff; border-radius: 16px; width: 100%; max-width: 640px; max-height: calc(100vh - 32px); display: flex; flex-direction: column; box-shadow: 0 20px 50px rgba(0,0,0,.3); overflow: hidden; }
    #st-terms .head { padding: 18px 20px 12px; border-bottom: 1px solid #e2e8f0; }
    #st-terms .head h2 { margin: 0; font-size: 18px; font-weight: 800; color: #0f172a; }
    #st-terms .head p { margin: 6px 0 0; font-size: 13px; color: #475569; line-height: 1.5; }
    #st-terms .body { padding: 14px 20px; overflow-y: auto; flex: 1; font-size: 13px; color: #334155; line-height: 1.65; }
    #st-terms .sum { background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 12px; padding: 12px 14px; margin-bottom: 14px; }
    #st-terms .sum b.t { display: block; color: #3730a3; font-size: 13px; margin-bottom: 6px; }
    #st-terms .sum ul { margin: 0; padding: 0; list-style: none; }
    #st-terms .sum li { display: flex; gap: 8px; padding: 3px 0; }
    #st-terms .sum li span.k { flex: 0 0 64px; font-weight: 700; color: #4338ca; }
    #st-terms .full { border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 14px; background: #f8fafc; }
    #st-terms .full h3 { margin: 12px 0 4px; font-size: 13px; font-weight: 800; color: #0f172a; }
    #st-terms .full h3:first-child { margin-top: 0; }
    #st-terms .full ol { margin: 0; padding-left: 20px; list-style: decimal; }
    #st-terms .full li { margin: 2px 0; }
    #st-terms .full p { margin: 0; }
    #st-terms .foot { padding: 12px 20px 16px; border-top: 1px solid #e2e8f0; background: #fff; }
    #st-terms label.chk { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; color: #0f172a; cursor: pointer; }
    #st-terms label.chk input { width: 18px; height: 18px; accent-color: #4f46e5; }
    #st-terms .btns { display: flex; gap: 8px; margin-top: 12px; }
    #st-terms .btns button { flex: 1; padding: 12px; border-radius: 10px; font-size: 14px; font-weight: 800; border: 0; cursor: pointer; }
    #st-terms .later { background: #f1f5f9; color: #475569; flex: 0 0 30% !important; }
    #st-terms .ok { background: #4f46e5; color: #fff; }
    #st-terms .ok:disabled { background: #cbd5e1; cursor: not-allowed; }
    #st-terms .err { color: #dc2626; font-size: 12px; margin-top: 8px; display: none; }
    @media (max-width: 480px) { #st-terms { padding: 0; align-items: stretch; } #st-terms .box { max-height: 100vh; border-radius: 0; } }`;

    function esc(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    function fullHtml() {
        return ARTICLES.map(([title, body, lead]) => `<h3>${esc(title)}</h3>` +
            (lead ? `<p>${esc(lead)}</p>` : '') +
            (Array.isArray(body) ? `<ol>${body.map(t => `<li>${esc(t)}</li>`).join('')}</ol>` : `<p>${esc(body)}</p>`)).join('');
    }

    // onAgree() 가 true 를 돌려주면 창을 닫고 'agreed', [나중에]는 'later'
    function showModal(company, onAgree) {
        return new Promise(resolve => {
            const style = document.createElement('style');
            style.textContent = CSS;
            document.head.appendChild(style);
            const wrap = document.createElement('div');
            wrap.id = 'st-terms';
            wrap.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-labelledby="st-terms-title">
                <div class="head">
                    <h2 id="st-terms-title">재고 보관 서비스 이용약관 동의</h2>
                    <p>${company ? `<b>${esc(company)}</b>님, ` : ''}재고 화면을 보시기 전에 재고 보관 약관을 한 번 확인해 주세요. 처음 한 번만 동의하시면 됩니다.</p>
                </div>
                <div class="body">
                    <div class="sum"><b class="t">꼭 알아두실 7가지</b><ul>${SUMMARY.map(([k, v]) => `<li><span class="k">${k}</span><span>${v}</span></li>`).join('')}</ul></div>
                    <div class="full">${fullHtml()}</div>
                </div>
                <div class="foot">
                    <label class="chk"><input type="checkbox" id="st-terms-check"> 위 재고 보관 약관을 읽었고 동의합니다.</label>
                    <div class="btns">
                        <button type="button" class="later" id="st-terms-later">나중에</button>
                        <button type="button" class="ok" id="st-terms-ok" disabled>동의하고 재고 보기</button>
                    </div>
                    <div class="err" id="st-terms-err"></div>
                </div>
            </div>`;
            document.body.appendChild(wrap);
            const check = wrap.querySelector('#st-terms-check');
            const ok = wrap.querySelector('#st-terms-ok');
            const err = wrap.querySelector('#st-terms-err');
            check.addEventListener('change', () => { ok.disabled = !check.checked; });
            wrap.querySelector('#st-terms-later').addEventListener('click', () => resolve('later'));
            ok.addEventListener('click', async () => {
                ok.disabled = true; ok.textContent = '저장하는 중...'; err.style.display = 'none';
                const msg = await onAgree();
                if (msg === true) { wrap.remove(); resolve('agreed'); return; }
                err.style.display = 'block';
                err.textContent = '동의를 저장하지 못했습니다. 잠시 뒤 다시 눌러주세요. (' + msg + ')';
                ok.disabled = !check.checked; ok.textContent = '동의하고 재고 보기';
            });
        });
    }

    // 동의했으면(또는 확인할 필요가 없으면) true. [나중에]를 누르면 주문접수 화면으로 돌아갑니다.
    async function requireStockTerms(client, profile, opts = {}) {
        if (!client || !profile || profile.role === 'admin' || opts.viewOnly) return true;
        const { data, error } = await client.rpc('stock_terms_status', { p_version: STOCK_TERMS_VERSION });
        if (error) return true;              // DB 설정(stock_terms.sql) 전: 창 없이 그대로
        if (data === true) return true;
        const r = await showModal(profile.company, async () => {
            const { error: aErr } = await client.rpc('stock_terms_agree', { p_version: STOCK_TERMS_VERSION, p_user_agent: navigator.userAgent || '' });
            return aErr ? (aErr.message || String(aErr)) : true;
        });
        if (r === 'later') { location.href = '/'; return false; }
        return true;
    }

    window.STOCK_TERMS_VERSION = STOCK_TERMS_VERSION;
    window.requireStockTerms = requireStockTerms;
})();
