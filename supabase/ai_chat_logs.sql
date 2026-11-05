-- =====================================================================
-- 밤낮딜리버리 - AI 상담 대화 기록 (2026-11-05)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요. (여러 번 실행해도 안전합니다)
-- (schema.sql, inquiries.sql 을 먼저 실행한 상태여야 합니다.)
--  - ai_chat_logs : 손님이 AI 상담창에 한 질문과 AI 답변. 관리자만 볼 수 있습니다.
--  - 손님 IP·연락처는 저장하지 않습니다. 1년이 지난 기록은 자동으로 지웁니다.
-- =====================================================================

create table if not exists public.ai_chat_logs (
    id            bigint generated always as identity primary key,
    created_at    timestamptz not null default now(),
    chat_id       text,                    -- 상담창 한 번 연 대화 묶음 (무작위 글자, 사람을 알 수 없음)
    question      text not null,
    answer        text,
    needs_human   boolean not null default false,   -- AI 가 답을 몰라 대표님께 넘긴 질문
    source        text                     -- 질문한 화면 주소 (홈페이지 / 주문접수 사이트)
);
create index if not exists ai_chat_logs_created_idx on public.ai_chat_logs (created_at desc);
alter table public.ai_chat_logs enable row level security;

drop policy if exists ai_chat_logs_admin on public.ai_chat_logs;
create policy ai_chat_logs_admin on public.ai_chat_logs
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- 상담 서버(worker/ask.js)가 질문·답변 1건을 남길 때 쓰는 함수. 표를 직접 읽을 수는 없습니다.
create or replace function public.log_ai_chat(
    p_chat_id text, p_question text, p_answer text, p_needs_human boolean, p_source text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if length(trim(coalesce(p_question, ''))) = 0 then return; end if;
    -- 개인정보 보관 기간: 1년이 지난 기록은 지웁니다.
    delete from public.ai_chat_logs where created_at < now() - interval '1 year';
    insert into public.ai_chat_logs (chat_id, question, answer, needs_human, source)
    values (left(p_chat_id, 40), left(trim(p_question), 1000), left(p_answer, 4000),
            coalesce(p_needs_human, false), left(split_part(coalesce(p_source, ''), '?', 1), 300));
end;
$$;

revoke all on function public.log_ai_chat(text, text, text, boolean, text) from public;
grant execute on function public.log_ai_chat(text, text, text, boolean, text) to anon, authenticated;

notify pgrst, 'reload schema';
