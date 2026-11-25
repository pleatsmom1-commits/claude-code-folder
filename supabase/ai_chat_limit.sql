-- =====================================================================
-- 밤낮딜리버리 - AI 상담 하루 한도 (2026-11-25)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요. (여러 번 실행해도 안전합니다)
-- (ai_chat_logs.sql, ai_chat_cost.sql, ai_unanswered.sql 을 먼저 실행한 상태여야 합니다.)
--  - 한 사람(접속 주소 기준) 하루 20번, 상담 AI 사용료 하루 합계 1만 원(약 7.14달러)까지만 AI 가 답합니다.
--  - 한도를 넘으면 상담창이 "관리자와 상담하기"(카카오톡)로 안내합니다. 하루는 한국 시간 밤 12시에 새로 시작합니다.
--  - visitor 칸: 접속 주소를 날짜와 섞어 알아볼 수 없게 바꾼 글자(매일 바뀜). 누구인지 알 수 없고, 하루 횟수 세기에만 씁니다.
--  - 이 SQL 을 실행하기 전에는 한도 없이 예전처럼 작동합니다.
-- =====================================================================
alter table public.ai_chat_logs add column if not exists visitor text;
create index if not exists ai_chat_logs_visitor_idx on public.ai_chat_logs (visitor, created_at desc);

-- 오늘(한국 시간) 더 물어봐도 되는지: 'ok' / 'mine'(이 사람 하루 횟수 초과) / 'total'(오늘 사용료 한도 초과)
create or replace function public.ai_chat_allowed(p_visitor text, p_max_mine integer, p_max_usd numeric)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
    mine integer;
    spent numeric;
begin
    select count(*) filter (where visitor = p_visitor), coalesce(sum(cost_usd), 0)
      into mine, spent
      from public.ai_chat_logs
     where created_at >= day_start;
    if spent >= greatest(coalesce(p_max_usd, 7.14), 0.5) then return 'total'; end if;
    if coalesce(p_visitor, '') <> '' and mine >= greatest(coalesce(p_max_mine, 20), 1) then return 'mine'; end if;
    return 'ok';
end;
$$;
revoke all on function public.ai_chat_allowed(text, integer, numeric) from public;
grant execute on function public.ai_chat_allowed(text, integer, numeric) to anon, authenticated;

-- 상담 기록 남기기 + visitor 칸 (예전 함수들도 그대로 둡니다)
create or replace function public.log_ai_chat(
    p_chat_id text, p_question text, p_answer text, p_needs_human boolean, p_source text,
    p_model text, p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric,
    p_unknown_question text, p_visitor text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if length(trim(coalesce(p_question, ''))) = 0 then return; end if;
    -- 개인정보 보관 기간: 1년이 지난 기록은 지웁니다.
    delete from public.ai_chat_logs where created_at < now() - interval '1 year';
    insert into public.ai_chat_logs (chat_id, question, answer, needs_human, source, model, input_tokens, output_tokens, cost_usd, unknown_question, visitor)
    values (left(p_chat_id, 40), left(trim(p_question), 1000), left(p_answer, 4000),
            coalesce(p_needs_human, false), left(split_part(coalesce(p_source, ''), '?', 1), 300),
            left(coalesce(p_model, ''), 60), greatest(coalesce(p_input_tokens, 0), 0), greatest(coalesce(p_output_tokens, 0), 0),
            least(greatest(coalesce(p_cost_usd, 0), 0), 10),
            nullif(left(trim(coalesce(p_unknown_question, '')), 300), ''),
            nullif(left(coalesce(p_visitor, ''), 64), ''));
end;
$$;
revoke all on function public.log_ai_chat(text, text, text, boolean, text, text, integer, integer, numeric, text, text) from public;
grant execute on function public.log_ai_chat(text, text, text, boolean, text, text, integer, integer, numeric, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
