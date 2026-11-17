// =====================================================================
// "궁금한 점 물어보기" AI 상담창 (오른쪽 아래 버튼)
//  - 질문을 /api/ask (worker/ask.js) 로 보내고 답을 보여 줍니다.
//  - 홈페이지(www.bamnatdelivery.com)에도 아래 한 줄로 붙일 수 있습니다. 질문은 이 파일을 올린 사이트로 보냅니다.
//      <script src="https://bamnat-delivery.bamnat.workers.dev/chat.js" defer></script>
//    · data-bottom="90"      : 오른쪽 아래 버튼 높이(px). 홈페이지의 카카오톡 버튼과 겹치지 않게 올릴 때
//    · data-floating="off"   : 오른쪽 아래 버튼을 숨김 / "pc" : PC(넓은 화면)에서만 보임
//    · data-label="..."      : 오른쪽 아래 버튼 글자
//    · data-color="#6C5CE7"  : 오른쪽 아래 버튼 색
//    · class="bn-chat-open"  : 홈페이지의 아무 버튼에나 붙이면, 누를 때 상담창이 열림 (예: "신규업체 상담전용" 버튼)
//  - AI 가 모르는 질문이면 연락처 남기기 칸을 띄워 /api/inquiry (worker/inquiry.js) 로 보냅니다.
//    대표님이 관리자 화면 > AI 상담에서 답하면 손님 휴대폰으로 문자가 갑니다.
//  - 상담창 안의 노란 "관리자와 상담하기" 버튼을 누르면 카카오톡 채널(밤낮딜리버리) 채팅방이 열립니다.
//    AI 가 답할 수 없는 질문(사고·파손·분실·정산 다툼 등)에는 이 버튼을 크게 한 번 더 보여 줍니다.
//  - 질문과 AI 답변은 관리자 화면 > AI 상담 > 상담 기록에 남습니다 (연락처·IP 는 저장 안 함, 1년 후 삭제).
//    손님 화면의 대화는 창을 새로 고치면 사라집니다.
//  - 사진 질문 (2026-11-17): [📷 사진] (휴대폰 캡쳐·앨범), [🖥️ 화면 캡쳐] (PC 브라우저, 보여줄 창을 고르면 한 장 찍음), 붙여넣기(Ctrl+V).
//    [🖥️ 화면 캡쳐]는 캡쳐 도구처럼 찍힌 화면 위에서 끌어 구간을 고르고, 보내기 전에 자르기·모자이크(개인정보)를 할 수 있고, 긴 쪽 1568px 이하 JPG 로 줄여 질문 1번에 1장만 보냅니다.
//    사진은 AI 답변에만 쓰고 어디에도 저장하지 않습니다 (상담 기록에는 "[사진 1장]"만 남음).
// =====================================================================
(function () {
    if (window.BamnatChat) return; // 홈페이지에 두 번 붙여도 버튼·창은 하나만
    const KAKAO = 'https://pf.kakao.com/_yWhKb/chat'; // 카카오톡 채널 bamnatdelivery 채팅방
    const me = document.currentScript;
    const BASE = me ? me.src : location.href;
    const API = new URL('/api/ask', BASE).href;
    const INQUIRY_API = new URL('/api/inquiry', BASE).href;
    const BOTTOM = Math.max(0, Number(me && me.dataset.bottom) || 18);
    const FLOATING = !(me && me.dataset.floating === 'off');
    const PC_ONLY = !!(me && me.dataset.floating === 'pc');
    const LABEL = (me && me.dataset.label) || '💬 궁금한 점 물어보기';
    const COLOR = /^#[0-9a-f]{3,8}$/i.test((me && me.dataset.color) || '') ? me.dataset.color : '#1e3a8a';
    // 카카오톡 채널 답변 시간 안내 (한국 시간). 오전 8시~오후 4시: 1시간 안 / 오후 4시~밤 11시: 밤 10~11시 / 밤 11시~아침 8시: 아침 8시 이후
    function kakaoHint() {
        const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
        if (h >= 8 && h < 16) return '⏰ 지금은 평균 1시간 안에 답변드려요 (오전 8시~오후 4시)';
        if (h >= 16 && h < 23) return '🌙 지금 남기시면 보통 밤 10~11시 사이에 답변드려요 (오전 8시~오후 4시에는 평균 1시간 안에 답변)';
        return '🌙 지금 남기시면 아침 8시 이후 차례로 답변드려요 (오전 8시~오후 4시에는 평균 1시간 안에 답변)';
    }
    const history = [];
    // 상담창 한 번(새로 고치기 전까지)의 대화 묶음 표시. 사람을 알아볼 수 없는 무작위 글자입니다.
    const CHAT_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

    const css = document.createElement('style');
    css.textContent = `
#bn-chat-btn{position:fixed;right:18px;bottom:${BOTTOM}px;z-index:2147483000;border:0;border-radius:999px;padding:12px 18px;background:${COLOR};color:#fff;font:700 14px/1 sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.25);cursor:pointer}
${PC_ONLY ? '@media(max-width:767px){#bn-chat-btn{display:none}}' : ''}
#bn-chat{position:fixed;right:12px;bottom:${BOTTOM + 58}px;z-index:2147483001;width:min(380px,calc(100vw - 24px));height:min(600px,calc(100vh - ${BOTTOM + 92}px));display:none;flex-direction:column;background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.3);overflow:hidden;font:14px/1.55 sans-serif;color:#111}
#bn-chat.open{display:flex}
#bn-chat header{background:#1e3a8a;color:#fff;padding:12px 14px;display:flex;justify-content:space-between;align-items:center}
#bn-chat header b{font-size:15px}
#bn-chat header button{background:none;border:0;color:#fff;font-size:20px;cursor:pointer}
#bn-chat .bn-log{flex:1;overflow-y:auto;padding:12px;background:#f3f4f6}
#bn-chat .bn-msg{max-width:85%;margin:6px 0;padding:9px 12px;border-radius:12px;white-space:pre-wrap;word-break:break-word}
#bn-chat .bn-user{margin-left:auto;background:#1e3a8a;color:#fff;border-bottom-right-radius:4px}
#bn-chat .bn-ai{background:#fff;border:1px solid #e5e7eb;border-bottom-left-radius:4px}
#bn-chat .bn-quick{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
#bn-chat .bn-quick button{border:1px solid #c7d2fe;background:#eef2ff;color:#1e3a8a;border-radius:999px;padding:5px 10px;font-size:12px;cursor:pointer}
#bn-chat .bn-note{font-size:11px;color:#6b7280;padding:6px 12px;border-top:1px solid #e5e7eb}
#bn-chat .bn-note a{color:#1e3a8a}
#bn-chat form{display:flex;gap:6px;padding:10px;border-top:1px solid #e5e7eb}
#bn-chat textarea{flex:1;resize:none;border:1px solid #d1d5db;border-radius:10px;padding:8px;font:14px sans-serif;height:42px}
#bn-chat form button{border:0;border-radius:10px;background:#1e3a8a;color:#fff;padding:0 14px;font-weight:700;cursor:pointer}
#bn-chat form button:disabled{opacity:.5}
#bn-chat .bn-ask-human{display:block;width:100%;margin-top:4px;border:1px dashed #94a3b8;background:#fff;color:#334155;border-radius:10px;padding:7px;font-size:12px;cursor:pointer}
#bn-chat .bn-lead{background:#fff;border:1px solid #c7d2fe;border-radius:12px;padding:10px;margin:8px 0;display:grid;gap:6px}
#bn-chat .bn-lead b{font-size:13px;color:#1e3a8a}
#bn-chat .bn-lead input,#bn-chat .bn-lead textarea{border:1px solid #d1d5db;border-radius:8px;padding:7px;font:13px sans-serif;width:100%;box-sizing:border-box}
#bn-chat .bn-lead textarea{height:60px;resize:vertical}
#bn-chat .bn-lead label{font-size:11px;color:#475569;display:flex;gap:6px;align-items:flex-start}
#bn-chat .bn-lead .bn-send{border:0;border-radius:8px;background:#1e3a8a;color:#fff;padding:9px;font-weight:700;cursor:pointer}
#bn-chat .bn-lead .bn-err{color:#e11d48;font-size:12px}
#bn-chat .bn-kakao{display:flex;align-items:center;justify-content:center;gap:6px;background:#FEE500;color:#191919;border-radius:10px;padding:9px;font:700 14px/1.2 sans-serif;text-decoration:none}
#bn-chat .bn-kakao:hover{filter:brightness(.96)}
#bn-chat .bn-kakao small{font-weight:400;font-size:11px;color:#3c3c3c}
#bn-chat .bn-human-bar{padding:8px 10px 0;border-top:1px solid #e5e7eb;background:#fff}
#bn-chat .bn-human-card{background:#fff;border:1px solid #fde68a;border-radius:12px;padding:10px;margin:8px 0;display:grid;gap:6px}
#bn-chat .bn-human-card span{font-size:12px;color:#475569}
#bn-chat .bn-hint{display:block;font-size:11px;color:#6b7280;text-align:center;margin-top:3px}
#bn-chat .bn-tools{display:flex;align-items:center;gap:6px;padding:8px 10px 0;flex-wrap:wrap}
#bn-chat .bn-tools button{border:1px solid #cbd5e1;background:#fff;color:#1e293b;border-radius:999px;padding:5px 10px;font:700 12px/1.2 sans-serif;cursor:pointer}
#bn-chat .bn-tools button:hover{background:#f1f5f9}
#bn-chat .bn-tools small{font-size:11px;color:#64748b}
#bn-chat .bn-attach{display:none;align-items:center;gap:8px;margin:6px 10px 0;padding:6px;border:1px solid #c7d2fe;background:#eef2ff;border-radius:10px;font-size:12px;color:#1e3a8a}
#bn-chat .bn-attach.on{display:flex}
#bn-chat .bn-attach img{width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid #c7d2fe}
#bn-chat .bn-attach button{margin-left:auto;border:0;background:none;color:#475569;font-size:12px;cursor:pointer;text-decoration:underline}
#bn-chat .bn-msg img{display:block;max-width:100%;max-height:180px;border-radius:8px;margin-bottom:6px}
#bn-shot{position:fixed;inset:0;z-index:2147483002;background:rgba(15,23,42,.75);display:none;align-items:center;justify-content:center;padding:12px;font:14px/1.5 sans-serif}
#bn-shot.open{display:flex}
#bn-shot .bn-shot-box{background:#fff;border-radius:16px;max-width:min(960px,100%);width:100%;max-height:100%;display:flex;flex-direction:column;overflow:hidden}
#bn-shot .bn-shot-head{padding:10px 14px;border-bottom:1px solid #e5e7eb}
#bn-shot .bn-shot-head b{font-size:15px;color:#1e3a8a}
#bn-shot .bn-shot-head p{margin:2px 0 0;font-size:12px;color:#475569}
#bn-shot .bn-shot-area{flex:1;min-height:0;overflow:auto;background:#e2e8f0;display:flex;align-items:center;justify-content:center;padding:8px}
#bn-shot canvas{max-width:100%;max-height:calc(100vh - 220px);touch-action:none;cursor:crosshair;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.15)}
#bn-shot .bn-shot-bar{display:flex;flex-wrap:wrap;gap:6px;padding:10px 14px;border-top:1px solid #e5e7eb;align-items:center}
#bn-shot .bn-shot-bar button{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:7px 11px;font:700 13px/1.2 sans-serif;cursor:pointer;color:#1e293b}
#bn-shot .bn-shot-bar button.on{background:#1e3a8a;border-color:#1e3a8a;color:#fff}
#bn-shot .bn-shot-bar .bn-shot-ok{margin-left:auto;background:#1e3a8a;border-color:#1e3a8a;color:#fff}
#bn-shot .bn-shot-bar .bn-shot-cancel{color:#64748b}
#bn-shot.snip{padding:0;background:#000}
#bn-shot.snip .bn-shot-box{max-width:none;width:100%;height:100%;border-radius:0;background:#000}
#bn-shot.snip .bn-shot-head{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:2;background:#1e3a8a;color:#fff;border-radius:999px;padding:8px 18px;border:0;box-shadow:0 4px 14px rgba(0,0,0,.4);white-space:nowrap}
#bn-shot.snip .bn-shot-head b{color:#fff;font-size:14px}
#bn-shot.snip .bn-shot-head p,#bn-shot.snip .bn-shot-bar [data-mode],#bn-shot.snip .bn-shot-undo,#bn-shot.snip .bn-shot-ok{display:none}
#bn-shot.snip .bn-shot-area{padding:0;background:#000}
#bn-shot.snip canvas{max-height:100vh;box-shadow:none}
#bn-shot.snip .bn-shot-bar{position:absolute;top:10px;right:12px;z-index:2;border:0;padding:0}`;
    document.head.appendChild(css);

    const btn = document.createElement('button');
    btn.id = 'bn-chat-btn';
    btn.type = 'button';
    btn.textContent = LABEL;

    const box = document.createElement('div');
    box.id = 'bn-chat';
    box.innerHTML = `
<header><b>밤낮딜리버리 궁금한 점 물어보기</b><button type="button" aria-label="닫기">×</button></header>
<div class="bn-log"></div>
<div class="bn-note">AI 안내는 참고용이며, 정확한 견적·일정은 상담으로 확정됩니다. 상담 품질을 위해 질문·답변이 저장되며 1년 후 삭제됩니다. 개인정보(주민번호·카드번호 등)는 적지 마세요.
 <a href="#" class="bn-lead-link">관리자에게 문의하기</a> · 전화 010-5425-9060</div>
<div class="bn-human-bar"><a class="bn-kakao" href="${KAKAO}" target="_blank" rel="noopener">💬 관리자와 상담하기 <small>(카카오톡 채널)</small></a><span class="bn-hint"></span></div>
<div class="bn-tools"><button type="button" class="bn-photo">📷 사진</button><button type="button" class="bn-screen">🖥️ 화면 캡쳐</button><small class="bn-tool-hint"></small></div>
<div class="bn-attach"><img alt=""><span>사진 1장을 같이 보내요</span><button type="button" class="bn-attach-edit">고치기</button><button type="button" class="bn-attach-del">빼기</button></div>
<input type="file" accept="image/*" class="bn-file" hidden>
<form><textarea maxlength="500" placeholder="예) 풀필먼트 요금이 얼마예요?"></textarea><button type="submit">보내기</button></form>`;

    const log = box.querySelector('.bn-log');
    const form = box.querySelector('form');
    const input = box.querySelector('textarea');
    const send = form.querySelector('button');

    function add(text, who, img) {
        const el = document.createElement('div');
        el.className = 'bn-msg ' + (who === 'user' ? 'bn-user' : 'bn-ai');
        if (img) { const i = document.createElement('img'); i.src = img; i.alt = '보낸 사진'; el.appendChild(i); }
        el.appendChild(document.createTextNode(text));
        log.appendChild(el);
        log.scrollTop = log.scrollHeight;
        return el;
    }

    add('안녕하세요, 밤낮딜리버리입니다 🙂\n요금, 접수 마감시간, 당일택배, 풀필먼트 등 이용 방법을 물어보세요.', 'ai');
    const quick = document.createElement('div');
    quick.className = 'bn-quick';
    ['픽업비와 택배비가 얼마예요?', '주문 마감이 몇 시예요?', '풀필먼트는 어떻게 이용해요?', '한집만 사입이 뭐예요?'].forEach(q => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = q;
        b.onclick = () => ask(q);
        quick.appendChild(b);
    });
    const human = document.createElement('button');
    human.type = 'button';
    human.className = 'bn-ask-human';
    human.textContent = '✍️ 관리자에게 문의하기';
    human.onclick = () => showLeadForm('');
    quick.appendChild(human);
    log.appendChild(quick);

    // AI 가 답할 수 없을 때: 카카오톡 채널로 바로 관리자와 상담하도록 크게 안내
    function showHumanCard() {
        const card = document.createElement('div');
        card.className = 'bn-human-card';
        card.innerHTML = `<span>바로 관리자와 이야기하고 싶으시면 카카오톡 채널로 상담해 주세요.</span>
<a class="bn-kakao" href="${KAKAO}" target="_blank" rel="noopener">💬 관리자와 상담하기 <small>(카카오톡 채널)</small></a>
<span class="bn-hint">${kakaoHint()}</span>
<span>카톡이 어려우시면 아래에 연락처를 남겨 주세요. 확인 후 문자로 답변드려요.</span>`;
        log.appendChild(card);
    }

    let leadBox = null;
    function showLeadForm(question) {
        if (leadBox) leadBox.remove();
        leadBox = document.createElement('div');
        leadBox.className = 'bn-lead';
        leadBox.innerHTML = `
<b>관리자에게 문의하기</b>
<span style="font-size:12px;color:#475569">확인 후 남겨 주신 휴대폰으로 답변을 보내 드려요.</span>
<input name="company" maxlength="100" placeholder="상호 (예: 밤낮샵)">
<input name="name" maxlength="50" placeholder="담당자 이름">
<input name="phone" maxlength="20" inputmode="tel" placeholder="휴대폰 번호 (필수)">
<textarea name="question" maxlength="1000" placeholder="문의 내용 (필수)"></textarea>
<label><input type="checkbox" name="consent" style="width:auto;margin-top:2px">
<span>[필수] 개인정보 수집·이용 동의: 문의 답변을 위해 상호·이름·휴대폰번호와 상담 내용을 수집하며, 문의일로부터 1년 보관 후 삭제합니다. 동의하지 않으면 문의를 남길 수 없으며, 카카오톡·전화로 문의하실 수 있습니다.</span></label>
<span class="bn-err"></span>
<button type="button" class="bn-send">문의 남기기</button>`;
        leadBox.querySelector('[name=question]').value = question || '';
        const err = leadBox.querySelector('.bn-err');
        const sendBtn = leadBox.querySelector('.bn-send');
        sendBtn.onclick = async () => {
            const v = n => leadBox.querySelector(`[name=${n}]`).value.trim();
            const phone = v('phone').replace(/[^0-9]/g, '');
            if (!/^01[0-9]{8,9}$/.test(phone)) { err.textContent = '휴대폰 번호를 확인해 주세요.'; return; }
            if (!v('question')) { err.textContent = '문의 내용을 적어 주세요.'; return; }
            if (!leadBox.querySelector('[name=consent]').checked) { err.textContent = '개인정보 수집·이용에 동의해 주세요.'; return; }
            err.textContent = '';
            sendBtn.disabled = true;
            sendBtn.textContent = '보내는 중…';
            let msg;
            try {
                const res = await fetch(INQUIRY_API, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ company: v('company'), name: v('name'), phone, question: v('question'),
                        consent: true, chatLog: history, source: location.href }),
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok) {
                    leadBox.remove();
                    leadBox = null;
                    add('문의가 접수됐어요. 관리자가 확인 후 남겨 주신 번호로 답변을 보내 드릴게요. 감사합니다 🙏', 'ai');
                    return;
                }
                msg = data.error;
            } catch { /* 아래 안내 */ }
            err.textContent = msg || '연결이 원활하지 않아요. 아래 "관리자와 상담하기"(카카오톡 채널) 또는 010-5425-9060으로 문의해 주세요.';
            sendBtn.disabled = false;
            sendBtn.textContent = '문의 남기기';
        };
        log.appendChild(leadBox);
        log.scrollTop = log.scrollHeight;
    }

    async function ask(q) {
        q = q.trim();
        const img = shot.ready;
        if ((!q && !img) || send.disabled) return;
        if (!q) q = '이 화면을 보고 알려 주세요.';
        quick.remove();
        add(q, 'user', img);
        history.push({ role: 'user', content: q });
        input.value = '';
        setAttach(null);
        send.disabled = true;
        const wait = add(img ? '사진을 보고 답변을 준비하고 있어요…' : '답변을 준비하고 있어요…', 'ai');
        let answer, needsHuman = false;
        try {
            const res = await fetch(API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: history, chatId: CHAT_ID, source: location.href,
                    image: img ? { media_type: 'image/jpeg', data: img.split(',')[1] } : undefined }),
            });
            const data = await res.json().catch(() => ({}));
            answer = data.answer || data.error;
            needsHuman = !!data.needsHuman;
            if (data.answer) history.push({ role: 'assistant', content: data.answer });
            else history.pop();
        } catch {
            history.pop();
        }
        wait.textContent = answer || '연결이 원활하지 않아요. 아래 "관리자와 상담하기"(카카오톡 채널) 또는 010-5425-9060으로 문의해 주세요.';
        if (needsHuman) { showHumanCard(); showLeadForm(q); }
        send.disabled = false;
        input.focus();
    }

    // ---------------------------------------------------------------
    // 사진 질문: 고르기·화면 캡쳐·붙여넣기 → 자르기·가리기 → 줄여서 1장 첨부
    // ---------------------------------------------------------------
    const MAX_SIDE = 1568;
    const shot = { ready: null, src: null };
    const attach = box.querySelector('.bn-attach');
    const fileIn = box.querySelector('.bn-file');
    const screenBtn = box.querySelector('.bn-screen');
    const isPhone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent || ''));
    const canScreen = !isPhone && !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
    if (!canScreen) screenBtn.style.display = 'none';
    box.querySelector('.bn-tool-hint').textContent = canScreen
        ? '궁금한 화면을 찍어 물어보세요 (Ctrl+V 붙여넣기도 돼요)'
        : '휴대폰은 전원+음량 버튼으로 캡쳐한 뒤 [📷 사진]에서 골라 주세요';

    function setAttach(dataUrl) {
        shot.ready = dataUrl;
        attach.classList.toggle('on', !!dataUrl);
        attach.querySelector('img').src = dataUrl || '';
        if (!dataUrl) shot.src = null;
    }
    attach.querySelector('.bn-attach-del').onclick = () => setAttach(null);
    attach.querySelector('.bn-attach-edit').onclick = () => { if (shot.src) openEditor(shot.src); };

    const loadImage = src => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
    function fitCanvas(srcCanvasOrImg, w, h) {
        const k = Math.min(1, MAX_SIDE / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(srcCanvasOrImg, 0, 0, c.width, c.height);
        return c;
    }
    async function fromBlob(blob) {
        if (!blob || !/^image\//.test(blob.type)) { alert('사진(이미지) 파일만 올릴 수 있어요.'); return; }
        const url = URL.createObjectURL(blob);
        try { const img = await loadImage(url); openEditor(fitCanvas(img, img.naturalWidth, img.naturalHeight).toDataURL('image/png')); }
        catch { alert('사진을 열지 못했어요. 다른 사진으로 해 주세요.'); }
        finally { URL.revokeObjectURL(url); }
    }
    box.querySelector('.bn-photo').onclick = () => fileIn.click();
    fileIn.onchange = () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) fromBlob(f); };
    input.addEventListener('paste', e => {
        const item = [...((e.clipboardData && e.clipboardData.items) || [])].find(i => i.type.startsWith('image/'));
        if (item) { e.preventDefault(); fromBlob(item.getAsFile()); }
    });
    // [🖥️ 화면 캡쳐] = 캡쳐 도구처럼: 보여줄 창을 고르면 그 화면이 멈춘 채 크게 뜨고, 마우스로 끌어 캡쳐할 구간을 고름 (2026-11-17 대표님 요청)
    screenBtn.onclick = async () => {
        let stream;
        try { stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }); }
        catch { return; } // 손님이 [취소]를 누른 경우
        const wasOpen = box.classList.contains('open');
        box.style.visibility = 'hidden'; btn.style.visibility = 'hidden'; // 이 탭을 찍을 때 상담창이 같이 찍히지 않게
        try {
            const v = document.createElement('video');
            v.muted = true; v.playsInline = true; v.srcObject = stream;
            await v.play();
            await new Promise(r => setTimeout(r, 400)); // 상담창이 사라진 화면이 그려질 때까지 잠깐
            const c = document.createElement('canvas'); // 고를 때 글자가 뭉개지지 않게 원래 크기로 (보낼 때 줄임)
            c.width = v.videoWidth; c.height = v.videoHeight;
            c.getContext('2d').drawImage(v, 0, 0);
            await openEditor(c.toDataURL('image/png'), true);
        } catch { alert('화면을 찍지 못했어요. [📷 사진]으로 올려 주세요.'); }
        finally {
            stream.getTracks().forEach(t => t.stop());
            box.style.visibility = ''; btn.style.visibility = '';
            if (wasOpen) box.classList.add('open');
        }
    };

    // 자르기·가리기 편집 창
    const ed = document.createElement('div');
    ed.id = 'bn-shot';
    ed.innerHTML = `<div class="bn-shot-box">
<div class="bn-shot-head"><b class="bn-shot-title">📷 보낼 사진 확인</b><p>궁금한 부분만 남기고, 손님 이름·전화번호·주소 같은 개인정보는 [▦ 모자이크]로 문질러 가려 주세요. 사진은 답변에만 쓰고 저장하지 않아요.</p></div>
<div class="bn-shot-area"><canvas></canvas></div>
<div class="bn-shot-bar">
<button type="button" data-mode="crop">✂️ 자르기</button><button type="button" data-mode="cover" class="on">▦ 모자이크</button>
<button type="button" class="bn-shot-undo">↩ 되돌리기</button>
<button type="button" class="bn-shot-cancel">취소</button><button type="button" class="bn-shot-ok">이 사진 보내기</button>
</div></div>`;
    const cv = ed.querySelector('canvas'), cx = cv.getContext('2d');
    let edMode = 'cover', edBase = null, edSteps = [], drag = null;
    ed.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
        edMode = b.dataset.mode;
        ed.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('on', x === b));
    });
    function setMode(m) {
        edMode = m;
        ed.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('on', x.dataset.mode === m));
    }
    // snip=true: 캡쳐 도구 모드 (화면 전체가 멈춘 채 뜨고, 끌어서 구간 고르기 → 고르면 보통 확인창으로)
    async function openEditor(src, snip) {
        shot.src = src;
        edBase = await loadImage(src);
        edSteps = [];
        setMode(snip ? 'crop' : 'cover');
        ed.classList.toggle('snip', !!snip);
        ed.querySelector('.bn-shot-title').textContent = snip ? '✂️ 캡쳐할 부분을 마우스로 끌어서 고르세요' : '📷 보낼 사진 확인';
        draw();
        ed.classList.add('open');
    }
    function endSnip() {
        if (!ed.classList.contains('snip')) return;
        ed.classList.remove('snip');
        ed.querySelector('.bn-shot-title').textContent = '📷 보낼 사진 확인';
        setMode('cover');
    }
    // 단계: {t:'crop', x,y,w,h} 는 그 영역만 남기기, {t:'cover', ...} 는 모자이크 (좌표는 원본 사진 기준)
    //  모자이크 칸은 글자를 다시 알아볼 수 없게 크게(영역 짧은 쪽의 1/4, 최소 10px) 만듦
    function view() {
        let r = { x: 0, y: 0, w: edBase.naturalWidth, h: edBase.naturalHeight };
        edSteps.forEach(s => { if (s.t === 'crop') r = s; });
        return r;
    }
    function draw(sel) {
        const r = view();
        cv.width = r.w; cv.height = r.h;
        cx.drawImage(edBase, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        edSteps.forEach(s => { if (s.t === 'cover') mosaic(s.x - r.x, s.y - r.y, s.w, s.h); });
        // 캡쳐 도구 모드: 고르는 곳 밖은 어둡게
        if (ed.classList.contains('snip')) {
            cx.fillStyle = 'rgba(0,0,0,.4)';
            cx.fillRect(0, 0, r.w, r.h);
            if (sel) cx.drawImage(edBase, sel.x, sel.y, sel.w, sel.h, sel.x - r.x, sel.y - r.y, sel.w, sel.h);
        }
        if (sel) {
            cx.save();
            cx.lineWidth = Math.max(2, r.w / 300);
            cx.setLineDash([8, 6]);
            cx.strokeStyle = edMode === 'crop' ? '#2563eb' : '#e11d48';
            if (edMode === 'cover') { cx.fillStyle = 'rgba(30,58,138,.25)'; cx.fillRect(sel.x - r.x, sel.y - r.y, sel.w, sel.h); }
            cx.strokeRect(sel.x - r.x, sel.y - r.y, sel.w, sel.h);
            cx.restore();
        }
    }
    function mosaic(x, y, w, h) {
        x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
        w = Math.min(cv.width - x, Math.round(w)); h = Math.min(cv.height - y, Math.round(h));
        if (w < 1 || h < 1) return;
        const b = Math.max(10, Math.round(Math.min(w, h) / 4));
        const d = cx.getImageData(x, y, w, h), p = d.data;
        for (let by = 0; by < h; by += b) for (let bx = 0; bx < w; bx += b) {
            let rr = 0, gg = 0, bb = 0, n = 0;
            for (let yy = by; yy < Math.min(by + b, h); yy++) for (let xx = bx; xx < Math.min(bx + b, w); xx++) {
                const i = (yy * w + xx) * 4; rr += p[i]; gg += p[i + 1]; bb += p[i + 2]; n++;
            }
            rr /= n; gg /= n; bb /= n;
            for (let yy = by; yy < Math.min(by + b, h); yy++) for (let xx = bx; xx < Math.min(bx + b, w); xx++) {
                const i = (yy * w + xx) * 4; p[i] = rr; p[i + 1] = gg; p[i + 2] = bb;
            }
        }
        cx.putImageData(d, x, y);
    }
    function pt(e) {
        const b = cv.getBoundingClientRect(), r = view();
        return { x: r.x + (e.clientX - b.left) * r.w / b.width, y: r.y + (e.clientY - b.top) * r.h / b.height };
    }
    const rect = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
    cv.addEventListener('pointerdown', e => { drag = { a: pt(e) }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => { if (drag) { drag.sel = rect(drag.a, pt(e)); draw(drag.sel); } });
    cv.addEventListener('pointerup', () => {
        const s = drag && drag.sel;
        drag = null;
        if (s && s.w > 8 && s.h > 8) {
            edSteps.push({ t: edMode, x: Math.round(s.x), y: Math.round(s.y), w: Math.round(s.w), h: Math.round(s.h) });
            if (edMode === 'crop') endSnip();
        }
        draw();
    });
    ed.querySelector('.bn-shot-undo').onclick = () => { edSteps.pop(); draw(); };
    ed.querySelector('.bn-shot-cancel').onclick = () => ed.classList.remove('open', 'snip');
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && ed.classList.contains('open')) ed.classList.remove('open', 'snip'); });
    ed.querySelector('.bn-shot-ok').onclick = () => {
        draw();
        setAttach(fitCanvas(cv, cv.width, cv.height).toDataURL('image/jpeg', 0.85));
        ed.classList.remove('open');
        input.focus();
    };
    window.BamnatChatShot = { openEditor }; // 점검용

    const barHint = box.querySelector('.bn-human-bar .bn-hint');
    const open = () => { barHint.textContent = kakaoHint(); box.classList.add('open'); input.focus(); };
    btn.onclick = () => { if (box.classList.contains('open')) box.classList.remove('open'); else open(); };
    // 홈페이지의 "신규업체 상담전용" 같은 버튼: class="bn-chat-open" 을 붙이면 누를 때 열림
    document.addEventListener('click', e => {
        const t = e.target.closest && e.target.closest('.bn-chat-open');
        if (t) { e.preventDefault(); open(); }
    });
    box.querySelector('.bn-lead-link').onclick = e => { e.preventDefault(); showLeadForm(input.value.trim()); };
    window.BamnatChat = { open };
    box.querySelector('header button').onclick = () => box.classList.remove('open');
    form.onsubmit = e => { e.preventDefault(); ask(input.value); };
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(input.value); }
    });

    const mount = () => { if (FLOATING) document.body.appendChild(btn); document.body.appendChild(box); document.body.appendChild(ed); };
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
