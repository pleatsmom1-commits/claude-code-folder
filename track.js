// =====================================================================
// 방문 통계 (관리자 > 방문 통계 탭에서 봄). worker/track.js 로 보냅니다. 표: supabase/site_visits.sql
//  - 기록하는 것: 화면 열기(조회수), 누른 버튼 이름, 실제로 보고 있던 시간, 휴대폰/PC, 어디서 왔는지(주소 앞부분만)
//  - 기록하지 않는 것: 이름·아이디·연락처·IP·입력한 글자. 표 안(주문·상품 목록)의 클릭과 관리자 클릭도 적지 않습니다.
//  - 방문 묶음 번호는 창을 닫으면 사라지는 무작위 글자(sessionStorage)라 사람을 알아볼 수 없습니다.
//  - 하루 방문자 번호: 같은 브라우저를 하루(한국 시간) 동안 1명으로 세는 무작위 글자. 날짜가 바뀌면 새 번호로 바뀌어
//    어제와 오늘이 같은 사람인지도 알 수 없습니다 (localStorage, 날짜와 번호만 저장).
//  - 홈페이지에 붙일 때:  <script src="https://bamnat-delivery.bamnat.workers.dev/track.js" defer></script>
//  - 화면에 data-track="이름" 을 붙이면 그 이름으로 기록, data-no-track 을 붙이면 그 안의 클릭은 기록 안 함.
// =====================================================================
(function () {
    if (window.bamnatTrack) return;
    window.bamnatTrack = { setRole: function () {} };
    var script = document.currentScript;
    if (!script || !/^https?:/.test(location.protocol)) return;
    try { if (window.top !== window.self) return; } catch (e) { return; }   // 관리자 화면 속 작은 창(embed)은 따로 세지 않음
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !window.BAMNAT_TRACK_LOCAL) return;
    var ENDPOINT = new URL('/api/track', script.src).href;

    function store(key, value) {
        try {
            if (value === undefined) return sessionStorage.getItem(key);
            sessionStorage.setItem(key, value);
        } catch (e) {}
        return value;
    }
    function randomId() {
        var id = '', abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
        for (var i = 0; i < 12; i++) id += abc[Math.floor(Math.random() * abc.length)];
        return id;
    }
    var session = store('bamnat.visit');
    if (!session) session = store('bamnat.visit', randomId());
    // 하루 방문자 번호 (한국 시간 날짜가 바뀌면 새로 만듦)
    var today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10), visitor = null;
    try {
        var saved = JSON.parse(localStorage.getItem('bamnat.visitor') || 'null');
        visitor = saved && saved.day === today && saved.id ? saved.id : randomId();
        localStorage.setItem('bamnat.visitor', JSON.stringify({ day: today, id: visitor }));
    } catch (e) { visitor = null; }
    var role = store('bamnat.visitRole') || script.getAttribute('data-role') || null;
    var device = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || window.innerWidth < 768 ? 'mobile' : 'pc';
    var referrer = null;
    try {
        if (document.referrer) {
            var rh = new URL(document.referrer).hostname;
            if (rh && rh !== location.hostname) referrer = rh;
        }
    } catch (e) {}

    var queue = [], timer = null;
    function base(kind) {
        return { kind: kind, path: location.pathname, session: session, visitor: visitor, role: role, device: device };
    }
    function send(useBeacon) {
        clearTimeout(timer); timer = null;
        if (!queue.length) return;
        var body = JSON.stringify({ events: queue.splice(0, 50) });
        try {
            if (useBeacon && navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' }))) return;
            fetch(ENDPOINT, { method: 'POST', body: body, keepalive: true, mode: 'no-cors', headers: { 'Content-Type': 'text/plain' } }).catch(function () {});
        } catch (e) {}
    }
    function add(ev) {
        queue.push(ev);
        if (queue.length >= 20) send(false);
        else if (!timer) timer = setTimeout(function () { send(false); }, 5000);
    }

    // 1) 조회수
    var view = base('view');
    view.title = (document.title || '').slice(0, 100);
    view.referrer = referrer;
    add(view);

    // 2) 머문 시간: 화면이 보이고, 1분 안에 움직임(누르기·스크롤·키보드)이 있었던 시간만 셉니다.
    var active = 0, lastMove = Date.now();
    ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove', 'wheel'].forEach(function (t) {
        addEventListener(t, function () { lastMove = Date.now(); }, { passive: true, capture: true });
    });
    setInterval(function () {
        if (document.visibilityState === 'visible' && Date.now() - lastMove < 60000) active += 5;
        if (active >= 300) flushTime(false);   // 오래 켜 둔 창도 5분마다 나눠서 보냄
    }, 5000);
    function flushTime(useBeacon) {
        if (active > 0) {
            var t = base('time');
            t.sec = active;
            active = 0;
            queue.push(t);
        }
        send(useBeacon);
    }
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') flushTime(true);
        else lastMove = Date.now();
    });
    addEventListener('pagehide', function () { flushTime(true); });

    // 3) 많이 누르는 기능: 버튼·링크 이름 (숫자는 지움)
    document.addEventListener('click', function (e) {
        if (role === 'admin') return;
        var el = e.target && e.target.closest && e.target.closest('button, a, summary, [role="button"], [onclick], [data-track]');
        if (!el || el.closest('table, [data-no-track]')) return;
        var label = el.getAttribute('data-track') || el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '';
        label = label.split('\n').map(function (s) { return s.trim(); }).filter(Boolean)[0] || '';
        label = label.replace(/[0-9]/g, '').replace(/\s+/g, ' ').replace(/[\s\-.,:()/]+$/, '').trim().slice(0, 30);
        if (!label) return;
        var c = base('click');
        c.label = label;
        add(c);
    }, true);

    // 주문접수 사이트가 로그인하면 알려 줌: guest(로그인 전) / seller / admin
    window.bamnatTrack.setRole = function (r) {
        role = r === 'admin' || r === 'seller' ? r : 'guest';
        store('bamnat.visitRole', role);
    };
})();
