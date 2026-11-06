-- =====================================================================
-- 밤낮딜리버리 - AI 상담 비용 기록 (2026-11-06)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요. (여러 번 실행해도 안전합니다)
-- (ai_chat_logs.sql 을 먼저 실행한 상태여야 합니다.)
--  - 질문 1건마다 AI 사용량(토큰)과 비용(달러)을 상담 기록에 함께 남깁니다.
--  - 관리자 'AI 사용료' 탭과 'AI 상담 > 상담 기록' 탭에 바로 보입니다.
-- =====================================================================

alter table public.ai_chat_logs add column if not exists model          text not null default '';
alter table public.ai_chat_logs add column if not exists input_tokens   integer not null default 0;
alter table public.ai_chat_logs add column if not exists output_tokens  integer not null default 0;
alter table public.ai_chat_logs add column if not exists cost_usd       numeric(10, 5) not null default 0;

-- 비용까지 함께 남기는 기록 함수 (예전 5칸짜리 함수도 그대로 둡니다)
create or replace function public.log_ai_chat(
    p_chat_id text, p_question text, p_answer text, p_needs_human boolean, p_source text,
    p_model text, p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if length(trim(coalesce(p_question, ''))) = 0 then return; end if;
    -- 개인정보 보관 기간: 1년이 지난 기록은 지웁니다.
    delete from public.ai_chat_logs where created_at < now() - interval '1 year';
    insert into public.ai_chat_logs (chat_id, question, answer, needs_human, source, model, input_tokens, output_tokens, cost_usd)
    values (left(p_chat_id, 40), left(trim(p_question), 1000), left(p_answer, 4000),
            coalesce(p_needs_human, false), left(split_part(coalesce(p_source, ''), '?', 1), 300),
            left(coalesce(p_model, ''), 60), greatest(coalesce(p_input_tokens, 0), 0), greatest(coalesce(p_output_tokens, 0), 0),
            least(greatest(coalesce(p_cost_usd, 0), 0), 10));
end;
$$;

revoke all on function public.log_ai_chat(text, text, text, boolean, text, text, integer, integer, numeric) from public;
grant execute on function public.log_ai_chat(text, text, text, boolean, text, text, integer, integer, numeric) to anon, authenticated;

notify pgrst, 'reload schema';
