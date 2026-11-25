-- =====================================================================
-- 예전 보관 목록(stock_items) 비우기 — 2026-11-22 대표님 요청
--   "예전 보관자료는 다 없애도 돼. 최신 재고표 업로드부터가 시작"
--   재고는 새 재고표(inventory)만 씁니다. 화면에서도 예전 목록은 없앴습니다.
--   혹시 몰라 지우기 전에 통째로 백업 표(stock_items_backup_20261122)에 복사해 둡니다.
--   여러 번 실행해도 안전합니다. (백업은 처음 한 번만 만들어지고, 두 번째부터는 지울 것이 없음)
-- =====================================================================

-- 1) 백업 (처음 실행할 때만 만들어짐)
create table if not exists public.stock_items_backup_20261122 as
    select * from public.stock_items;

-- 백업 표는 관리자도 화면에서 안 쓰므로 사이트(셀러·관리자 로그인)에서는 못 읽게 막습니다.
alter table public.stock_items_backup_20261122 enable row level security;
revoke all on public.stock_items_backup_20261122 from anon, authenticated;

-- 2) 예전 보관 목록 비우기 (표 자체는 남겨 둠 → 다른 기능이 찾다가 오류 나지 않게)
delete from public.stock_items;

-- 3) 결과 확인: 백업 줄 수 / 남은 줄 수(0이면 끝)
select (select count(*) from public.stock_items_backup_20261122) as 백업한_줄수,
       (select count(*) from public.stock_items) as 남은_줄수;
