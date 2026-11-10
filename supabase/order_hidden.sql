-- =====================================================================
-- 밤낮딜리버리 - 관리자 주문관리에서 테스트 접수건 등을 '숨기기' (2026-11-10)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요. (여러 번 실행해도 안전합니다)
-- (schema.sql 을 먼저 실행한 상태여야 합니다. is_admin() 함수를 씁니다.)
--  - 주문은 지우지 않고 '숨김 목록'에만 올립니다. 관리자 주문관리 목록에서만 안 보이고,
--    [숨긴 접수건도 보기]를 체크하면 다시 보입니다. 셀러 화면·정산 등 다른 곳은 그대로입니다.
--  - 주문이 삭제되면 숨김 기록도 같이 지워집니다.
-- =====================================================================

create table if not exists public.admin_hidden_orders (
    order_id   text primary key references public.orders(id) on delete cascade,
    hidden_at  timestamptz not null default now()
);
alter table public.admin_hidden_orders enable row level security;

drop policy if exists admin_hidden_orders_admin on public.admin_hidden_orders;
create policy admin_hidden_orders_admin on public.admin_hidden_orders
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

notify pgrst, 'reload schema';
