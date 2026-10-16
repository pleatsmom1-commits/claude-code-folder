-- =====================================================================
-- 밤낮딜리버리 - 정산서 발송 기능용 테이블
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
-- (schema.sql 을 먼저 실행한 상태여야 합니다. 여러 번 실행해도 안전합니다.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 정산 거래처 연락처 (회원가입 여부와 상관없이 관리자가 등록)
--    company 는 정산청구서 엑셀의 상호와 같은 표기로 저장합니다.
-- ---------------------------------------------------------------------
create table if not exists public.settle_contacts (
    company     text primary key,
    phone       text,               -- 숫자만 (예: 01012345678). 없으면 비워둠
    memo        text,
    updated_at  timestamptz not null default now()
);
alter table public.settle_contacts enable row level security;

drop policy if exists settle_contacts_admin on public.settle_contacts;
create policy settle_contacts_admin on public.settle_contacts
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 2. 업체별 정산서 (정산청구서 엑셀의 정산서DB 시트에서 만들어짐)
--    token : 거래처에게 보내는 링크에 붙는 추측 불가능한 고유값
--    data  : 정산서 화면에 보여줄 값 (단가 등 내부 정보는 저장하지 않음)
-- ---------------------------------------------------------------------
create table if not exists public.settlements (
    id           bigint generated always as identity primary key,
    token        text not null unique,
    company      text not null,
    settle_date  date not null,
    seq          integer,            -- 정산서DB 시트에서의 순서
    total        numeric,            -- 총 청구금액
    result       text,               -- 청구 / 영수 / 이월
    data         jsonb not null,
    sent_at      timestamptz,        -- 알림톡 발송 시각
    send_status  text,               -- 발송 결과 (발송 기능 연결 후 사용)
    send_error   text,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (company, settle_date)
);
create index if not exists settlements_date_idx on public.settlements (settle_date, seq);
alter table public.settlements enable row level security;

drop policy if exists settlements_admin on public.settlements;
create policy settlements_admin on public.settlements
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 3. 거래처가 링크로 자기 정산서 1건만 볼 수 있게 하는 함수
--    (로그인 없이 호출 가능. 정확한 token 을 알아야만 결과가 나옵니다)
-- ---------------------------------------------------------------------
create or replace function public.get_settlement(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'company', s.company,
        'settle_date', s.settle_date,
        'data', s.data
    )
    from public.settlements s
    where length(coalesce(p_token, '')) >= 24
      and s.token = p_token;
$$;
revoke all on function public.get_settlement(text) from public;
grant execute on function public.get_settlement(text) to anon, authenticated;

notify pgrst, 'reload schema';
