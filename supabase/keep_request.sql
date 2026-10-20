-- =====================================================================
-- 밤낮딜리버리 - 사무실 보관요청 단독 접수 (2026-10-20)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
-- (schema.sql 을 먼저 실행한 상태여야 합니다. 여러 번 실행해도 안전합니다.)
--  - 접수구분(order_type)에 'keep'(사무실 보관요청) 추가
--  - 보관요청 선택값에 '이미접수'(3. 이미 접수했습니다) 허용
-- =====================================================================
alter table public.orders drop constraint if exists orders_order_type_check;
alter table public.orders add constraint orders_order_type_check
    check (order_type in ('fulfillment', 'store_post', 'store_sameday', 'keep'));

alter table public.orders add column if not exists keep_request text;
alter table public.orders add column if not exists keep_memo text;
alter table public.orders drop constraint if exists orders_keep_request_check;
alter table public.orders add constraint orders_keep_request_check
    check (keep_request is null or keep_request in ('있음', '없음', '이미접수'));

notify pgrst, 'reload schema';
