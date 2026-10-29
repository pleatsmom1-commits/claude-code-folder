// =====================================================================
// "궁금한 점 물어보기" AI 상담창 (오른쪽 아래 버튼)
//  - 질문을 /api/ask (worker/ask.js) 로 보내고 답을 보여 줍니다.
//  - 홈페이지(www.bamnatdelivery.com)에도 아래 한 줄로 붙일 수 있습니다. 질문은 이 파일을 올린 사이트로 보냅니다.
//      <script src="https://bamnat-delivery.bamnat.workers.dev/chat.js" defer></script>
//  - 대화 내용은 이 브라우저 화면에만 있고, 창을 새로 고치면 사라집니다 (DB 에 저장하지 않음).
// =====================================================================
(function () {
    const KAKAO = 'http://pf.kakao.com/_yWhKb/chat';
    const API = new URL('/api/ask', document.currentScript ? document.currentScript.src : location.href).href;
    const history = [];

    const css = document.createElement('style');
    css.textContent = `
#bn-chat-btn{position:fixed;right:18px;bottom:18px;z-index:9000;border:0;border-radius:999px;padding:12px 18px;background:#1e3a8a;color:#fff;font:700 14px/1 sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.25);cursor:pointer}
#bn-chat{position:fixed;right:18px;bottom:76px;z-index:9001;width:min(380px,calc(100vw - 24px));height:min(560px,calc(100vh - 110px));display:none;flex-direction:column;background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.3);overflow:hidden;font:14px/1.55 sans-serif;color:#111}
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
#bn-chat form button:disabled{opacity:.5}`;
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
 <a href="${KAKAO}" target="_blank" rel="noopener">카카오톡 상담</a> · 010-5425-9060</div>
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
    log.appendChild(quick);

    async function ask(q) {
        q = q.trim();
        if (!q || send.disabled) return;
        quick.remove();
        add(q, 'user');
        history.push({ role: 'user', content: q });
        input.value = '';
        send.disabled = true;
        const wait = add('답변을 준비하고 있어요…', 'ai');
        let answer;
        try {
            const res = await fetch(API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: history }),
            });
            const data = await res.json().catch(() => ({}));
            answer = data.answer || data.error;
            if (data.answer) history.push({ role: 'assistant', content: data.answer });
            else history.pop();
        } catch {
            history.pop();
        }
        wait.textContent = answer || '연결이 원활하지 않아요. 카카오톡 bamnatdelivery 또는 010-5425-9060으로 문의해 주세요.';
        send.disabled = false;
        input.focus();
    }

    btn.onclick = () => { box.classList.toggle('open'); if (box.classList.contains('open')) input.focus(); };
    box.querySelector('header button').onclick = () => box.classList.remove('open');
    form.onsubmit = e => { e.preventDefault(); ask(input.value); };
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(input.value); }
    });

    const mount = () => { document.body.appendChild(btn); document.body.appendChild(box); };
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
