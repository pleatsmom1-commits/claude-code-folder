-- =====================================================================
-- 재고 정리(수량 조정) 때 셀러에게 보여줄 사유 (2026-11-17)
--   - inventory_moves 에 seller_reason 칸을 더합니다. (관리자 메모 reason 은 그대로, 셀러에겐 안 보임)
--   - 관리자 재고표 [저장] 때 목록에서 고른 사유가 이 칸에 들어갑니다.
--   - 사유 목록: 실사 수량 차이 / 불량 발견 / 반품 입고 / 오출고 회수 / 기타
--   여러 번 실행해도 안전합니다.
-- =====================================================================

alter table public.inventory_moves add column if not exists seller_reason text not null default '';

-- 수량 조정 + 셀러용 사유 (관리자). 안에서 inventory_move 를 그대로 부르고, 방금 남은 기록에 사유를 적습니다.
create or replace function public.inventory_adjust(
    p_product_id bigint, p_da integer, p_db integer, p_dd integer,
    p_reason text default '', p_seller_reason text default '', p_location text default null
) returns public.inventory
language plpgsql
security definer
set search_path = public
as $$
declare
    v_inv public.inventory;
    v_last bigint;
begin
    if coalesce(p_seller_reason, '') not in ('', '실사 수량 차이', '불량 발견', '반품 입고', '오출고 회수', '기타') then
        raise exception '셀러에게 보일 사유를 목록에서 골라주세요: %', p_seller_reason;
    end if;
    select coalesce(max(id), 0) into v_last from public.inventory_moves where product_id = p_product_id;
    v_inv := public.inventory_move(p_product_id, '조정', p_da, p_db, p_dd, p_reason, p_location, null);
    update public.inventory_moves set seller_reason = coalesce(p_seller_reason, '')
    where product_id = p_product_id and id > v_last and kind = '조정';
    return v_inv;
end $$;

revoke all on function public.inventory_adjust(bigint, integer, integer, integer, text, text, text) from public, anon;
grant execute on function public.inventory_adjust(bigint, integer, integer, integer, text, text, text) to authenticated;

notify pgrst, 'reload schema';
