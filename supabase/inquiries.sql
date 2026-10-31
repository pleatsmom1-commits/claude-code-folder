-- =====================================================================
-- 밤낮딜리버리 - 신규업체 AI 상담: 답변 대기 문의 + 대표님 답변 모음집 (2026-10-30)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요. (여러 번 실행해도 안전합니다)
-- (schema.sql 을 먼저 실행한 상태여야 합니다.)
--  - inquiries : AI 가 답하지 못해 손님이 연락처를 남긴 문의. 관리자만 보고 답합니다.
--  - ai_faq    : 대표님 답변 모음집. AI 가 답할 때 함께 참고합니다 (공개 안내용 내용만 넣습니다).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 답변 대기 문의
-- ---------------------------------------------------------------------
create table if not exists public.inquiries (
    id           bigint generated always as identity primary key,
    created_at   timestamptz not null default now(),
    company      text,
    name         text,
    phone        text not null,          -- 숫자만 (예: 01012345678)
    question     text not null,
    chat_log     jsonb,                  -- AI 와 나눈 대화 (최근 몇 개)
    source       text,                   -- 문의한 화면 주소 (홈페이지 / 주문접수 사이트)
    status       text not null default 'waiting',   -- waiting: 답변 대기, answered: 답변 보냄, closed: 보내지 않고 완료
    answer       text,
    answered_at  timestamptz,
    send_result  text
);
create index if not exists inquiries_status_idx on public.inquiries (status, created_at desc);
alter table public.inquiries enable row level security;

drop policy if exists inquiries_admin on public.inquiries;
create policy inquiries_admin on public.inquiries
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- 손님(로그인 안 한 사람)은 표를 직접 볼 수 없고, 이 함수로 문의 1건 남기기만 할 수 있습니다.
create or replace function public.submit_inquiry(
    p_company text, p_name text, p_phone text, p_question text, p_chat_log jsonb, p_source text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
    v_id bigint;
begin
    if v_phone !~ '^01[0-9]{8,9}$' then raise exception '휴대폰 번호를 확인해 주세요.'; end if;
    if length(trim(coalesce(p_question, ''))) = 0 then raise exception '문의 내용을 적어 주세요.'; end if;
    -- 같은 번호로 1시간에 5건까지만 (장난 방지)
    if (select count(*) from public.inquiries where phone = v_phone and created_at > now() - interval '1 hour') >= 5 then
        raise exception '잠시 후 다시 남겨 주세요.';
    end if;
    -- 개인정보 보관 기간: 문의 후 1년이 지난 기록은 지웁니다.
    delete from public.inquiries where created_at < now() - interval '1 year';

    insert into public.inquiries (company, name, phone, question, chat_log, source)
    values (left(trim(p_company), 100), left(trim(p_name), 50), v_phone, left(trim(p_question), 1000),
            case when p_chat_log is null or length(p_chat_log::text) > 20000 then null else p_chat_log end,
            left(p_source, 300))
    returning id into v_id;
    return v_id;
end;
$$;

revoke all on function public.submit_inquiry(text, text, text, text, jsonb, text) from public;
grant execute on function public.submit_inquiry(text, text, text, text, jsonb, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. 대표님 답변 모음집 (AI 가 참고)
-- ---------------------------------------------------------------------
create table if not exists public.ai_faq (
    id          bigint generated always as identity primary key,
    question    text not null,
    answer      text not null,
    active      boolean not null default true,   -- 끄면 AI 가 참고하지 않음
    inquiry_id  bigint,                           -- 문의 답변에서 만들어졌으면 그 문의 번호
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
alter table public.ai_faq enable row level security;

drop policy if exists ai_faq_admin on public.ai_faq;
create policy ai_faq_admin on public.ai_faq
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- AI 답변 서버(worker/ask.js)가 켜진 답변만 읽을 수 있게 합니다 (손님 개인정보는 들어 있지 않음).
grant select on public.ai_faq to anon;
drop policy if exists ai_faq_read_active on public.ai_faq;
create policy ai_faq_read_active on public.ai_faq
    for select to anon
    using (active);

notify pgrst, 'reload schema';
