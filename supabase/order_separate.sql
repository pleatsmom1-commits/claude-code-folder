-- =====================================================================
-- 밤낮딜리버리 - 관리자 주문관리 '따로 처리됨' 표시 (2026-11-11)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요. (여러 번 실행해도 안전합니다)
-- (schema.sql 을 먼저 실행한 상태여야 합니다. is_admin() 함수를 씁니다.)
--  - 이 사이트 밖에서 이미 따로 처리·배송한 접수건에 '따로 처리됨' 표시를 붙입니다. (관리자만 보고 바꿈)
--  - 주문이 삭제되면 표시도 같이 지워집니다.
-- =====================================================================

create table if not exists public.admin_separate_orders (
    order_id   text primary key references public.orders(id) on delete cascade,
    marked_at  timestamptz not null default now()
);
alter table public.admin_separate_orders enable row level security;

drop policy if exists admin_separate_orders_admin on public.admin_separate_orders;
create policy admin_separate_orders_admin on public.admin_separate_orders
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

notify pgrst, 'reload schema';
