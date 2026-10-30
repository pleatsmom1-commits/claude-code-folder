// =====================================================================
// "궁금한 점 물어보기" AI 상담창 (오른쪽 아래 버튼)
//  - 질문을 /api/ask (worker/ask.js) 로 보내고 답을 보여 줍니다.
//  - 홈페이지(www.bamnatdelivery.com)에도 아래 한 줄로 붙일 수 있습니다. 질문은 이 파일을 올린 사이트로 보냅니다.
//      <script src="https://bamnat-delivery.bamnat.workers.dev/chat.js" defer></script>
//    · data-bottom="90"      : 오른쪽 아래 버튼 높이(px). 홈페이지의 카카오톡 버튼과 겹치지 않게 올릴 때
//    · data-floating="off"   : 오른쪽 아래 버튼을 숨김
//    · class="bn-chat-open"  : 홈페이지의 아무 버튼에나 붙이면, 누를 때 상담창이 열림 (예: "신규업체 상담전용" 버튼)
//  - AI 가 모르는 질문이면 연락처 남기기 칸을 띄워 /api/inquiry (worker/inquiry.js) 로 보냅니다.
//    대표님이 관리자 화면 > AI 상담에서 답하면 손님 휴대폰으로 문자가 갑니다.
//  - 대화 내용은 이 브라우저 화면에만 있고, 창을 새로 고치면 사라집니다. 연락처를 남길 때만 그 대화가 함께 저장됩니다.
// =====================================================================
(function () {
    const KAKAO = 'http://pf.kakao.com/_yWhKb/chat';
    const me = document.currentScript;
    const BASE = me ? me.src : location.href;
    const API = new URL('/api/ask', BASE).href;
    const INQUIRY_API = new URL('/api/inquiry', BASE).href;
    const BOTTOM = Math.max(0, Number(me && me.dataset.bottom) || 18);
    const FLOATING = !(me && me.dataset.floating === 'off');
    const history = [];

    const css = document.createElement('style');
    css.textContent = `
#bn-chat-btn{position:fixed;right:18px;bottom:${BOTTOM}px;z-index:2147483000;border:0;border-radius:999px;padding:12px 18px;background:#1e3a8a;color:#fff;font:700 14px/1 sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.25);cursor:pointer}
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
#bn-chat .bn-lead .bn-err{color:#e11d48;font-size:12px}`;
    document.head.appendChild(css);

    const btn = document.createElement('button');
    btn.id = 'bn-chat-btn';
    btn.type = 'button';
    btn.textContent = '💬 궁금한 점 물어보기';

    const box = document.createElement('div');
    box.id = 'bn-chat';
    box.innerHTML = `
<header><b>밤낮딜리버리 AI 안내</b><button type="button" aria-label="닫기">×</button></header>
<div class="bn-log"></div>
<div class="bn-note">AI 안내는 참고용이며, 정확한 견적·일정은 상담으로 확정됩니다. 개인정보(주민번호·카드번호 등)는 적지 마세요.
 <a href="#" class="bn-lead-link">대표님께 문의 남기기</a> · <a href="${KAKAO}" target="_blank" rel="noopener">카카오톡 상담</a> · 010-5425-9060</div>
<form><textarea maxlength="500" placeholder="예) 풀필먼트 요금이 얼마예요?"></textarea><button type="submit">보내기</button></form>`;

    const log = box.querySelector('.bn-log');
    const form = box.querySelector('form');
    const input = box.querySelector('textarea');
    const send = form.querySelector('button');

    function add(text, who) {
        const el = document.createElement('div');
        el.className = 'bn-msg ' + (who === 'user' ? 'bn-user' : 'bn-ai');
        el.textContent = text;
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
    human.textContent = '✍️ 대표님께 직접 문의 남기기';
    human.onclick = () => showLeadForm('');
    quick.appendChild(human);
    log.appendChild(quick);

    let leadBox = null;
    function showLeadForm(question) {
        if (leadBox) leadBox.remove();
        leadBox = document.createElement('div');
        leadBox.className = 'bn-lead';
        leadBox.innerHTML = `
<b>대표님께 문의 남기기</b>
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
                    add('문의가 접수됐어요. 대표님이 확인 후 남겨 주신 번호로 답변을 보내 드릴게요. 감사합니다 🙏', 'ai');
                    return;
                }
                msg = data.error;
            } catch { /* 아래 안내 */ }
            err.textContent = msg || '연결이 원활하지 않아요. 카카오톡 bamnatdelivery 또는 010-5425-9060으로 문의해 주세요.';
            sendBtn.disabled = false;
            sendBtn.textContent = '문의 남기기';
        };
        log.appendChild(leadBox);
        log.scrollTop = log.scrollHeight;
    }

    async function ask(q) {
        q = q.trim();
        if (!q || send.disabled) return;
        quick.remove();
        add(q, 'user');
        history.push({ role: 'user', content: q });
        input.value = '';
        send.disabled = true;
        const wait = add('답변을 준비하고 있어요…', 'ai');
        let answer, needsHuman = false;
        try {
            const res = await fetch(API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: history }),
            });
            const data = await res.json().catch(() => ({}));
            answer = data.answer || data.error;
            needsHuman = !!data.needsHuman;
            if (data.answer) history.push({ role: 'assistant', content: data.answer });
            else history.pop();
        } catch {
            history.pop();
        }
        wait.textContent = answer || '연결이 원활하지 않아요. 카카오톡 bamnatdelivery 또는 010-5425-9060으로 문의해 주세요.';
        if (needsHuman) showLeadForm(q);
        send.disabled = false;
        input.focus();
    }

    const open = () => { box.classList.add('open'); input.focus(); };
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

    const mount = () => { if (FLOATING) document.body.appendChild(btn); document.body.appendChild(box); };
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
