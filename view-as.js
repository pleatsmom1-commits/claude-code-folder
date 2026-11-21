// =====================================================================
// 관리자 [화면 보기] 공통 도우미 (stock, stock-history, usage, products 화면에서 씀)
//  - 주문접수 화면(index.html)의 [화면 보기] 창에서 버튼을 누르면
//    /stock?company=상호&view=1&uid=셀러ID 처럼 열립니다.
//  - 관리자 계정일 때만 각 화면이 VIEW_AS.start() 를 불러 "그 업체가 보는 화면"으로 그립니다.
//    (셀러 계정이면 이 주소여도 아무 효과 없음 — DB 가 자기 것만 돌려줌)
//  - 보기 전용: DB 에 쓰는 요청(저장·등록·수정·삭제·사진 올리기)을 모두 막습니다.
//  - "← 주문접수 화면" 링크는 관리자 화면이 아니라 그 업체 화면 보기(/?view_as=셀러ID)로 돌아갑니다.
// =====================================================================
(function () {
    const params = new URLSearchParams(location.search);
    const company = params.has('view') ? (params.get('company') || '') : '';
    const uid = params.get('uid') || '';
    const VA = {
        company,                 // 보려는 업체 상호 ('' 이면 화면 보기 아님)
        uid,
        active: false,           // 관리자 확인 뒤 start() 하면 true
        message: '관리자 보기 전용 화면이라 저장·등록·수정·삭제는 되지 않습니다.',
    };
    const realFetch = window.fetch.bind(window);
    VA.fetch = function (input, init) {
        const method = String((init && init.method) || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase();
        const url = typeof input === 'string' ? input : (input && input.url) || String(input);
        if (VA.active && !['GET', 'HEAD', 'OPTIONS'].includes(method) && !/\/auth\/v1\//.test(url)) {
            return Promise.resolve(new Response(JSON.stringify({ code: 'VIEW_ONLY', message: VA.message }),
                { status: 403, headers: { 'Content-Type': 'application/json' } }));
        }
        return realFetch(input, init);
    };
    VA.createClient = function (url, key) {
        return company
            ? window.supabase.createClient(url, key, { global: { fetch: VA.fetch } })
            : window.supabase.createClient(url, key);
    };
    VA.backUrl = function () { return uid ? `/?view_as=${encodeURIComponent(uid)}` : '/'; };
    VA.start = function (pageName) {
        VA.active = true;
        const bar = document.createElement('div');
        bar.id = 'view-as-bar';
        bar.style.cssText = 'position:sticky;top:0;z-index:9998;background:#6d28d9;color:#fff;text-align:center;padding:8px 12px;font:700 13px/1.5 sans-serif;';
        const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        bar.innerHTML = `👀 관리자 보기 전용 · <u>${esc(company)}</u> 업체가 보는 ${esc(pageName || '')} 화면입니다 `
            + '<span style="font-weight:500;font-size:12px;opacity:.9">(저장·등록·삭제는 되지 않아요)</span>';
        const test = document.getElementById('test-site-banner');
        if (test) test.after(bar); else document.body.prepend(bar);
        document.title = `[업체 화면 보기] ${company} ${pageName || ''}`;
        // 주문접수 화면('/')으로 가는 링크는 모두 그 업체 화면 보기로 (나중에 생기는 링크도)
        const relabel = () => document.querySelectorAll('a').forEach(a => {
            if (a.getAttribute('href') === '/' && !a.dataset.viewAs) {
                a.dataset.viewAs = '1';
                a.href = VA.backUrl();
                if (/주문접수 화면|택배접수 화면으로/.test(a.textContent)) a.textContent = a.textContent.replace(/주문접수 화면|택배접수 화면으로/, '업체 화면으로 돌아가기');
            }
        });
        relabel();
        new MutationObserver(relabel).observe(document.body, { childList: true, subtree: true });
    };
    window.VIEW_AS = VA;
})();
