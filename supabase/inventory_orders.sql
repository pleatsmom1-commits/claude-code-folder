-- =====================================================================
-- 밤낮딜리버리 - 주문 연동 (재고관리 4단계)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
-- (inventory.sql 을 먼저 실행한 상태여야 합니다. 여러 번 실행해도 안전합니다.)
--
--  - product_aliases   : 주문서에 적힌 상품명 → 상품관리 상품. 관리자가 한 번 짝지어 주면 다음부터 자동으로 찾습니다.
--  - order_stock_picks : 재고에서 출고확정한 주문 줄. 같은 주문을 두 번 빼지 않게 막고, 되돌릴 수 있게 남깁니다.
--  - inventory_pick    : [출고확정] → 체크한 주문만큼 상품화 재고에서 뺌 (기록: 출고)
--  - inventory_unpick  : 출고확정 되돌리기 → 다시 상품화 재고로
-- =====================================================================

create table if not exists public.product_aliases (
    id          bigint generated always as identity primary key,
    company     text not null,
    alias       text not null,                -- 주문서 상품명 그대로
    product_id  bigint not null references public.products(id),
    created_at  timestamptz not null default now(),
    created_by  uuid default auth.uid()
);
create unique index if not exists product_aliases_uidx on public.product_aliases (public.norm_company(company), public.norm_company(alias));

create table if not exists public.order_stock_picks (
    order_id    text primary key,              -- orders.id
    product_id  bigint not null,
    company     text not null default '',
    qty         integer not null check (qty > 0),
    picked_at   timestamptz not null default now(),
    picked_by   uuid default auth.uid()
);
create index if not exists order_stock_picks_at_idx on public.order_stock_picks (picked_at desc);

alter table public.product_aliases enable row level security;
alter table public.order_stock_picks enable row level security;

drop policy if exists product_aliases_admin on public.product_aliases;
create policy product_aliases_admin on public.product_aliases
    for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists order_stock_picks_select on public.order_stock_picks;
create policy order_stock_picks_select on public.order_stock_picks
    for select to authenticated
    using (public.is_admin() or public.norm_company(company) = public.my_stock_company());

grant select, insert, update, delete on public.product_aliases to authenticated;
revoke insert, update, delete on public.order_stock_picks from authenticated, anon;
grant select on public.order_stock_picks to authenticated;

-- [출고확정] p_items = [{"order_id":"ORD-1","product_id":3,"qty":1,"note":"12-1 홍길동"}, ...]
--   이미 출고확정한 주문은 건너뜁니다. 재고가 모자라면 전체를 취소합니다(아무것도 안 빠짐).
create or replace function public.inventory_pick(p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_item  jsonb;
    v_prod  public.products;
    v_qty   integer;
    v_count integer := 0;
begin
    if not public.is_admin() then
        raise exception '관리자만 출고확정할 수 있습니다.' using errcode = '42501';
    end if;
    for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
        if exists (select 1 from public.order_stock_picks where order_id = v_item->>'order_id') then continue; end if;
        v_qty := (v_item->>'qty')::int;
        if v_qty is null or v_qty <= 0 then continue; end if;
        select * into v_prod from public.products where id = (v_item->>'product_id')::bigint;
        perform public.inventory_move(v_prod.id, '출고', -v_qty, 0, 0, '주문 ' || coalesce(v_item->>'note', v_item->>'order_id'));
        insert into public.order_stock_picks (order_id, product_id, company, qty)
        values (v_item->>'order_id', v_prod.id, v_prod.company, v_qty);
        v_count := v_count + 1;
    end loop;
    return v_count;
end $$;

-- 출고확정 되돌리기
create or replace function public.inventory_unpick(p_order_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_pick public.order_stock_picks;
begin
    if not public.is_admin() then
        raise exception '관리자만 되돌릴 수 있습니다.' using errcode = '42501';
    end if;
    delete from public.order_stock_picks where order_id = p_order_id returning * into v_pick;
    if not found then return false; end if;
    perform public.inventory_move(v_pick.product_id, '출고', v_pick.qty, 0, 0, '출고확정 되돌림 (주문 ' || p_order_id || ')');
    return true;
end $$;

revoke all on function public.inventory_pick(jsonb) from public, anon;
revoke all on function public.inventory_unpick(text) from public, anon;
grant execute on function public.inventory_pick(jsonb) to authenticated;
grant execute on function public.inventory_unpick(text) to authenticated;

notify pgrst, 'reload schema';
