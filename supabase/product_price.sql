-- =====================================================================
-- 밤낮딜리버리 - 상품관리 판매가·도매가 칸 (출고 리포트 매출 계산용)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
-- (products.sql 을 먼저 실행한 상태여야 합니다. 여러 번 실행해도 안전합니다.)
--
--  - sale_price      : 판매가 (쇼핑몰에서 파는 값, 원). 비워도 됩니다.
--  - wholesale_price : 도매가 (사입하는 값, 원). 비워도 됩니다.
--  - 권한은 기존 상품관리와 같습니다 (셀러는 자기 상품만 보고 고침). 바뀐 내용은 상품 [기록]에 자동으로 남습니다.
-- =====================================================================
alter table public.products add column if not exists sale_price integer;
alter table public.products add column if not exists wholesale_price integer;

alter table public.products drop constraint if exists products_sale_price_check;
alter table public.products add constraint products_sale_price_check check (sale_price is null or sale_price >= 0);
alter table public.products drop constraint if exists products_wholesale_price_check;
alter table public.products add constraint products_wholesale_price_check check (wholesale_price is null or wholesale_price >= 0);

notify pgrst, 'reload schema';
