-- =====================================================================
-- 밤낮딜리버리 - 사입팀 픽업요청 기능용 테이블
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
-- (schema.sql 을 먼저 실행한 상태여야 합니다. 여러 번 실행해도 안전합니다.)
-- =====================================================================

create table if not exists public.pickup_requests (
    id              uuid primary key default gen_random_uuid(),
    seller_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
    seller_company  text,                       -- 접수 당시 셀러 상호 (관리자 화면 표시용)
    store_name      text not null,              -- 매장상호
    store_location  text not null,              -- 매장위치
    prepay          boolean not null,           -- true: 대납하고 픽업 / false: 대납없이 픽업
    prepay_misong   boolean not null,           -- true: 재고 없으면 대납미송 잡음 / false: 잡지 않음
    agreed          boolean not null default false, -- 대납금 선입금 안내 동의
    memo            text,
    status          text not null default '접수' check (status in ('접수', '확인', '완료', '취소')),
    created_at      timestamptz not null default now(),
    -- 대납하거나 대납미송을 잡는 경우에는 선입금 안내에 동의해야만 접수됩니다.
    constraint pickup_requests_agree_chk check (agreed or not (prepay or prepay_misong))
);
create index if not exists pickup_requests_created_idx on public.pickup_requests (created_at desc);
create index if not exists pickup_requests_seller_idx on public.pickup_requests (seller_id, created_at desc);
alter table public.pickup_requests enable row level security;

drop policy if exists pickup_requests_select on public.pickup_requests;
drop policy if exists pickup_requests_insert on public.pickup_requests;
drop policy if exists pickup_requests_admin_update on public.pickup_requests;
drop policy if exists pickup_requests_admin_delete on public.pickup_requests;

-- 셀러는 자기 요청만, 관리자는 전체를 봅니다.
create policy pickup_requests_select on public.pickup_requests
    for select to authenticated
    using (seller_id = auth.uid() or public.is_admin());

-- 승인된 셀러만 접수할 수 있습니다. 접수 상태는 항상 '접수'로 시작합니다.
create policy pickup_requests_insert on public.pickup_requests
    for insert to authenticated
    with check (seller_id = auth.uid() and public.is_approved_seller() and status = '접수');

-- 상태 변경(확인/완료/취소)과 삭제는 관리자만
create policy pickup_requests_admin_update on public.pickup_requests
    for update to authenticated
    using (public.is_admin())
    with check (public.is_admin());

create policy pickup_requests_admin_delete on public.pickup_requests
    for delete to authenticated
    using (public.is_admin());

notify pgrst, 'reload schema';
