-- =====================================================================
-- 셀러에게 재고 숨기기 (관리자 > 재고관리 탭의 [셀러에게 재고 보이기] 설정)
--   - 재고는 지우지 않고, 셀러 화면(재고 확인 /stock, 재고표 /inventory)에만 안 보이게 합니다.
--   - 관리자 화면에는 항상 그대로 보입니다.
--   - 두 가지 방법:
--       1) 전체 셀러 숨기기 (한 번에)  → company_key = '*' 줄
--       2) 업체별 숨기기/보이기        → company_key = 상호(띄어쓰기 없앤 소문자)
--     업체별 설정은 "전체 설정과 다르게 하는 예외"입니다.
--     (전체 숨김일 때 A 업체만 보이기, 전체 보임일 때 B 업체만 숨기기)
--   - stock.sql, inventory.sql, inventory_confirm.sql, inventory_orders.sql 다음에 실행하세요.
--     (위 파일들을 나중에 다시 실행했다면 이 파일도 다시 한 번 실행해주세요)
--   - 여러 번 실행해도 안전합니다. 처음 실행하면 아무도 숨겨지지 않은 상태로 시작합니다.
-- =====================================================================

create table if not exists public.stock_visibility (
    company_key text primary key,                 -- '*' = 전체 설정, 그 밖에는 norm_company(상호)
    company     text not null default '',         -- 화면에 보여줄 상호
    hidden      boolean not null default false,   -- true = 셀러에게 숨김
    updated_at  timestamptz not null default now(),
    updated_by  uuid
);

alter table public.stock_visibility enable row level security;

drop policy if exists stock_visibility_admin on public.stock_visibility;
create policy stock_visibility_admin on public.stock_visibility
    for select to authenticated
    using (public.is_admin());

-- 바꾸기는 아래 함수로만 (관리자 확인 포함)
revoke insert, update, delete on public.stock_visibility from authenticated, anon;
grant select on public.stock_visibility to authenticated;

-- 이 상호의 재고가 셀러에게 숨겨져 있는지: 업체별 설정 → 없으면 전체 설정 → 없으면 보임
create or replace function public.stock_hidden_for(p_company text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
        (select hidden from public.stock_visibility where company_key = public.norm_company(p_company) and company_key <> '*'),
        (select hidden from public.stock_visibility where company_key = '*'),
        false);
$$;

-- 재고를 볼 수 있는 셀러의 상호 (숨겨진 셀러는 null → 재고가 하나도 안 보임)
create or replace function public.my_visible_stock_company()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select c from (select public.my_stock_company() as c) x
    where c is not null and not public.stock_hidden_for(c);
$$;

-- 셀러 화면용: 내 재고를 볼 수 있는지 (true / false)
create or replace function public.my_stock_visible()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.my_visible_stock_company() is not null;
$$;

-- 관리자: 전체 셀러 숨기기/보이기. 업체별로 따로 정한 설정은 지우고 모두 같게 맞춥니다.
create or replace function public.stock_set_hide_all(p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        raise exception '관리자만 바꿀 수 있습니다.' using errcode = '42501';
    end if;
    delete from public.stock_visibility where company_key <> '*';
    insert into public.stock_visibility (company_key, company, hidden, updated_at, updated_by)
    values ('*', '전체', coalesce(p_hidden, false), now(), auth.uid())
    on conflict (company_key) do update
        set hidden = excluded.hidden, updated_at = now(), updated_by = auth.uid();
end $$;

-- 관리자: 한 업체만 숨기기/보이기. 전체 설정과 같아지면 예외 줄을 지웁니다.
create or replace function public.stock_set_company_hidden(p_company text, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_key text := public.norm_company(p_company);
    v_all boolean;
begin
    if not public.is_admin() then
        raise exception '관리자만 바꿀 수 있습니다.' using errcode = '42501';
    end if;
    if coalesce(v_key, '') = '' or v_key = '*' then
        raise exception '업체명이 비어 있습니다.';
    end if;
    select hidden into v_all from public.stock_visibility where company_key = '*';
    if coalesce(v_all, false) = coalesce(p_hidden, false) then
        delete from public.stock_visibility where company_key = v_key;
    else
        insert into public.stock_visibility (company_key, company, hidden, updated_at, updated_by)
        values (v_key, trim(p_company), coalesce(p_hidden, false), now(), auth.uid())
        on conflict (company_key) do update
            set company = excluded.company, hidden = excluded.hidden, updated_at = now(), updated_by = auth.uid();
    end if;
end $$;

revoke all on function public.stock_hidden_for(text) from public, anon;
revoke all on function public.my_visible_stock_company() from public, anon;
revoke all on function public.my_stock_visible() from public, anon;
revoke all on function public.stock_set_hide_all(boolean) from public, anon;
revoke all on function public.stock_set_company_hidden(text, boolean) from public, anon;
grant execute on function public.stock_hidden_for(text) to authenticated;
grant execute on function public.my_visible_stock_company() to authenticated;
grant execute on function public.my_stock_visible() to authenticated;
grant execute on function public.stock_set_hide_all(boolean) to authenticated;
grant execute on function public.stock_set_company_hidden(text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 셀러가 재고를 읽는 규칙을 "보이기로 한 셀러만"으로 바꿉니다. (관리자는 그대로 전부)
-- ---------------------------------------------------------------------
-- 예전 재고관리 (재고 확인 /stock)
drop policy if exists stock_items_seller_select on public.stock_items;
create policy stock_items_seller_select on public.stock_items
    for select to authenticated
    using (public.norm_company(company) = public.my_visible_stock_company());

-- 새 재고표 (/inventory) 수량 · 변경기록
drop policy if exists inventory_select on public.inventory;
create policy inventory_select on public.inventory
    for select to authenticated
    using (public.is_admin() or public.norm_company(company) = public.my_visible_stock_company());

drop policy if exists inventory_moves_select on public.inventory_moves;
create policy inventory_moves_select on public.inventory_moves
    for select to authenticated
    using (public.is_admin() or public.norm_company(company) = public.my_visible_stock_company());

-- 매일 확정 재고 기록
drop policy if exists inventory_snapshots_select on public.inventory_snapshots;
create policy inventory_snapshots_select on public.inventory_snapshots
    for select to authenticated
    using (public.is_admin() or public.norm_company(company) = public.my_visible_stock_company());

-- 재고 출고 기록
drop policy if exists order_stock_picks_select on public.order_stock_picks;
create policy order_stock_picks_select on public.order_stock_picks
    for select to authenticated
    using (public.is_admin() or public.norm_company(company) = public.my_visible_stock_company());

notify pgrst, 'reload schema';
