-- =====================================================================
-- 밤낮딜리버리 - AI 상담 "답변하지 못한 질문" (2026-11-22)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요. (여러 번 실행해도 안전합니다)
-- (inquiries.sql, ai_chat_logs.sql 을 먼저 실행한 상태여야 합니다.)
--  - 관리자 > AI 상담 > [답변하지 못한 질문] 탭에서 쓰는 칸 4개를 상담 기록(ai_chat_logs)에 더합니다.
--      resolved_at  : 대표님이 답을 쓰거나 "답 필요 없음"으로 정리한 시간 (비어 있으면 아직 답 안 함)
--      resolved_how : 'faq' = 답을 써서 AI 답변 모음집에 등록함 / 'skip' = 답 필요 없음(숨김)
--      faq_id       : 등록한 답변 모음집(ai_faq) 번호
--      unknown_question : 손님 질문 중 AI 가 답하지 못한 부분만 뽑은 한 문장 (2026-11-22 추가)
--  - 'ai_ok' = 다시 살펴보니 AI 가 사실은 답했던 질문 (목록에서 빠짐)
--  - 이미 답변 모음집에 똑같은 질문이 있는 지난 기록은 "답함"으로 표시합니다.
--  - 손님이 볼 수 있는 내용은 바뀌지 않습니다. (상담 기록은 관리자만 봅니다)
-- =====================================================================

alter table public.ai_chat_logs add column if not exists resolved_at  timestamptz;
alter table public.ai_chat_logs add column if not exists resolved_how text;
alter table public.ai_chat_logs add column if not exists faq_id       bigint;
alter table public.ai_chat_logs add column if not exists unknown_question text;

-- 상담 서버(worker/ask.js)가 '모르는 부분'까지 함께 남길 때 쓰는 함수 (예전 함수들도 그대로 둡니다)
create or replace function public.log_ai_chat(
    p_chat_id text, p_question text, p_answer text, p_needs_human boolean, p_source text,
    p_model text, p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric,
    p_unknown_question text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if length(trim(coalesce(p_question, ''))) = 0 then return; end if;
    -- 개인정보 보관 기간: 1년이 지난 기록은 지웁니다.
    delete from public.ai_chat_logs where created_at < now() - interval '1 year';
    insert into public.ai_chat_logs (chat_id, question, answer, needs_human, source, model, input_tokens, output_tokens, cost_usd, unknown_question)
    values (left(p_chat_id, 40), left(trim(p_question), 1000), left(p_answer, 4000),
            coalesce(p_needs_human, false), left(split_part(coalesce(p_source, ''), '?', 1), 300),
            left(coalesce(p_model, ''), 60), greatest(coalesce(p_input_tokens, 0), 0), greatest(coalesce(p_output_tokens, 0), 0),
            least(greatest(coalesce(p_cost_usd, 0), 0), 10),
            nullif(left(trim(coalesce(p_unknown_question, '')), 300), ''));
end;
$$;

revoke all on function public.log_ai_chat(text, text, text, boolean, text, text, integer, integer, numeric, text) from public;
grant execute on function public.log_ai_chat(text, text, text, boolean, text, text, integer, integer, numeric, text) to anon, authenticated;

create index if not exists ai_chat_logs_unanswered_idx
    on public.ai_chat_logs (created_at desc)
    where needs_human and resolved_at is null;

-- 띄어쓰기·물음표 등을 빼고 같은 질문인지 비교 (예: "토요일 픽업 되나요?" = "토요일픽업 되나요")
create or replace function public.ai_question_key(p text)
returns text
language sql
immutable
as $$
    select regexp_replace(lower(replace(coalesce(p, ''), '[사진 1장]', '')), '[^가-힣a-z0-9]', '', 'g');
$$;

-- 이미 답변 모음집에 같은 질문이 있으면 "답함"으로 표시 (몇 번 실행해도 같은 결과)
update public.ai_chat_logs l
   set resolved_at = now(), resolved_how = 'faq', faq_id = f.id
  from public.ai_faq f
 where l.needs_human
   and l.resolved_at is null
   and f.active
   and public.ai_question_key(coalesce(nullif(l.unknown_question, ''), l.question)) <> ''
   and public.ai_question_key(coalesce(nullif(l.unknown_question, ''), l.question)) = public.ai_question_key(f.question);

notify pgrst, 'reload schema';
