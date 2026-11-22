-- =====================================================================
-- 밤낮딜리버리 - 지금까지 AI 가 답하지 못한 질문 정리해서 보기 (2026-11-22)
-- 읽기만 합니다. 아무것도 바꾸지 않으니 몇 번 실행해도 안전합니다.
-- ai_unanswered.sql 을 먼저 실행한 뒤 실행하세요.
-- 같은 질문(띄어쓰기·물음표만 다른 것)은 한 줄로 묶고, 많이 물어본 질문부터 보여 줍니다.
-- =====================================================================

select
    min(question)                                    as 질문,
    count(*)                                         as 물어본_횟수,
    to_char(min(created_at) at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as 처음,
    to_char(max(created_at) at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as 마지막,
    string_agg(distinct case when source ilike '%bamnatdelivery.com%' or source ilike '%cafe24%' or source ilike '%dothome%'
                             then '홈페이지' else '주문접수 사이트' end, ', ') as 물어본_곳,
    left(max(answer), 120)                           as "AI가_했던_답"
from public.ai_chat_logs
where needs_human
  and resolved_at is null
group by public.ai_question_key(question)
order by count(*) desc, max(created_at) desc;
