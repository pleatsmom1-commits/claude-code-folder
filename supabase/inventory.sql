-- =====================================================================
-- 밤낮딜리버리 - 새 재고표 (재고관리 2단계)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
-- (products.sql 을 먼저 실행한 상태여야 합니다. 여러 번 실행해도 안전합니다.)
--
--  - inventory       : 상품(상품관리의 상품코드) 하나당 한 줄.
--                      qty_a = 상품화(라벨 완료), qty_b = 미상품화(라벨 전), qty_defect = 불량(출고 계산에서 뺌)
--  - inventory_moves : 수량이 바뀔 때마다 자동으로 남는 기록 (최종재고 업로드 / 입고 / 조정 / 라벨완료 / 출고)
--  - 수량은 관리자만 바꿀 수 있고, 아래 함수(inventory_move, inventory_import)로만 바뀝니다.
--    셀러는 자기 상호 재고와 기록을 보기만 합니다.
--  - 예전 재고표(stock_items)는 그대로 기록으로 남습니다.
-- =====================================================================

create table if not exists public.inventory (
    product_id   bigint primary key references public.products(id),
    company      text not null,                  -- 상품의 거래처명 (권한·검색용으로 복사)
    qty_a        integer not null default 0,     -- 상품화
    qty_b        integer not null default 0,     -- 미상품화
    qty_defect   integer not null default 0,     -- 불량
    location     text not null default '',       -- 재고위치
    memo         text not null default '',
    updated_at   timestamptz not null default now(),
    updated_by   uuid,
    constraint inventory_qty_check check (qty_a >= 0 and qty_b >= 0 and qty_defect >= 0)
);
create index if not exists inventory_company_idx on public.inventory (public.norm_company(company));

create table if not exists public.inventory_moves (
    id            bigint generated always as identity primary key,
    product_id    bigint not null,
    company       text not null default '',
    code          text not null default '',
    kind          text not null,                 -- 최종재고 / 입고 / 조정 / 라벨완료 / 출고
    d_a           integer not null default 0,    -- 바뀐 수량 (+/-)
    d_b           integer not null default 0,
    d_defect      integer not null default 0,
    a_after       integer not null default 0,    -- 바뀐 뒤 수량
    b_after       integer not null default 0,
    defect_after  integer not null default 0,
    reason        text not null default '',
    actor         uuid default auth.uid(),
    actor_name    text not null default '',
    at            timestamptz not null default now()
);
create index if not exists inventory_moves_product_idx on public.inventory_moves (product_id, at desc);
create index if not exists inventory_moves_company_idx on public.inventory_moves (public.norm_company(company), at desc);
create index if not exists inventory_moves_at_idx on public.inventory_moves (at desc);

alter table public.inventory enable row level security;
alter table public.inventory_moves enable row level security;

drop policy if exists inventory_select on public.inventory;
create policy inventory_select on public.inventory
    for select to authenticated
    using (public.is_admin() or public.norm_company(company) = public.my_stock_company());

drop policy if exists inventory_moves_select on public.inventory_moves;
create policy inventory_moves_select on public.inventory_moves
    for select to authenticated
    using (public.is_admin() or public.norm_company(company) = public.my_stock_company());

-- 표를 직접 고치는 권한은 주지 않습니다 (아래 함수로만 바뀜 → 기록이 빠짐없이 남음)
revoke insert, update, delete on public.inventory from authenticated, anon;
revoke insert, update, delete on public.inventory_moves from authenticated, anon;
grant select on public.inventory to authenticated;
grant select on public.inventory_moves to authenticated;

-- ---------------------------------------------------------------------
-- 수량 바꾸기 (관리자). 입고 / 조정 / 라벨완료(미상품화 → 상품화) / 출고
--   p_da, p_db, p_dd = 상품화 / 미상품화 / 불량 수량을 얼마나 더하거나 뺄지 (+/-)
--   재고가 모자라면(0 밑으로) 오류. 위치·메모는 null 이면 그대로.
-- ---------------------------------------------------------------------
create or replace function public.inventory_move(
    p_product_id bigint, p_kind text, p_da integer, p_db integer, p_dd integer,
    p_reason text default '', p_location text default null, p_memo text default null
) returns public.inventory
language plpgsql
security definer
set search_path = public
as $$
declare
    v_prod public.products;
    v_inv  public.inventory;
    v_name text;
begin
    if not public.is_admin() then
        raise exception '관리자만 재고 수량을 바꿀 수 있습니다.' using errcode = '42501';
    end if;
    if p_kind not in ('입고', '조정', '라벨완료', '출고') then
        raise exception '알 수 없는 작업: %', p_kind;
    end if;
    select * into v_prod from public.products where id = p_product_id;
    if not found or v_prod.deleted_at is not null then
        raise exception '상품을 찾을 수 없습니다. (삭제된 상품일 수 있습니다)';
    end if;

    insert into public.inventory (product_id, company) values (p_product_id, v_prod.company)
    on conflict (product_id) do nothing;
    select * into v_inv from public.inventory where product_id = p_product_id for update;

    v_inv.qty_a := v_inv.qty_a + coalesce(p_da, 0);
    v_inv.qty_b := v_inv.qty_b + coalesce(p_db, 0);
    v_inv.qty_defect := v_inv.qty_defect + coalesce(p_dd, 0);
    if v_inv.qty_a < 0 or v_inv.qty_b < 0 or v_inv.qty_defect < 0 then
        raise exception '재고가 모자랍니다. (%: 상품화 %, 미상품화 %, 불량 %)',
            v_prod.code, v_inv.qty_a - coalesce(p_da, 0), v_inv.qty_b - coalesce(p_db, 0), v_inv.qty_defect - coalesce(p_dd, 0)
            using errcode = '23514';
    end if;

    update public.inventory set
        company = v_prod.company,
        qty_a = v_inv.qty_a, qty_b = v_inv.qty_b, qty_defect = v_inv.qty_defect,
        location = coalesce(p_location, location), memo = coalesce(p_memo, memo),
        updated_at = now(), updated_by = auth.uid()
    where product_id = p_product_id
    returning * into v_inv;

    if coalesce(p_da, 0) <> 0 or coalesce(p_db, 0) <> 0 or coalesce(p_dd, 0) <> 0 then
        select coalesce(nullif(name, ''), company, '') into v_name from public.profiles where id = auth.uid();
        insert into public.inventory_moves (product_id, company, code, kind, d_a, d_b, d_defect, a_after, b_after, defect_after, reason, actor_name)
        values (p_product_id, v_prod.company, v_prod.code, p_kind, coalesce(p_da, 0), coalesce(p_db, 0), coalesce(p_dd, 0),
                v_inv.qty_a, v_inv.qty_b, v_inv.qty_defect, coalesce(p_reason, ''), coalesce(v_name, ''));
    end if;
    return v_inv;
end $$;

-- ---------------------------------------------------------------------
-- 최종재고 엑셀 올리기 (관리자). 거래처 하나씩 부릅니다.
--   p_items = [{"product_id":1,"a":3,"b":0,"defect":0,"location":"G-1","memo":""}, ...]
--   파일에 있는 상품은 그 수량으로 맞추고(차이만큼 기록), 이 거래처의 다른 재고는 0 으로 맞춥니다.
--   수량이 모두 0 인 줄은 재고 줄을 만들지 않습니다.
-- ---------------------------------------------------------------------
create or replace function public.inventory_import(p_company text, p_items jsonb, p_reason text default '최종재고 엑셀')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_item  jsonb;
    v_prod  public.products;
    v_old   public.inventory;
    v_a int; v_b int; v_d int;
    v_name  text;
    v_count integer := 0;
    v_ids   bigint[] := '{}';
begin
    if not public.is_admin() then
        raise exception '관리자만 최종재고를 올릴 수 있습니다.' using errcode = '42501';
    end if;
    select coalesce(nullif(name, ''), company, '') into v_name from public.profiles where id = auth.uid();

    for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
        select * into v_prod from public.products where id = (v_item->>'product_id')::bigint;
        if not found or v_prod.deleted_at is not null then
            raise exception '상품을 찾을 수 없습니다: %', v_item->>'product_id';
        end if;
        if public.norm_company(v_prod.company) <> public.norm_company(p_company) then
            raise exception '% 상품은 % 거래처 상품이 아닙니다.', v_prod.code, p_company;
        end if;
        v_a := greatest(coalesce((v_item->>'a')::int, 0), 0);
        v_b := greatest(coalesce((v_item->>'b')::int, 0), 0);
        v_d := greatest(coalesce((v_item->>'defect')::int, 0), 0);
        v_ids := v_ids || v_prod.id;

        select * into v_old from public.inventory where product_id = v_prod.id for update;
        if not found then
            if v_a = 0 and v_b = 0 and v_d = 0 then continue; end if;
            insert into public.inventory (product_id, company, qty_a, qty_b, qty_defect, location, memo, updated_by)
            values (v_prod.id, v_prod.company, v_a, v_b, v_d, coalesce(v_item->>'location', ''), coalesce(v_item->>'memo', ''), auth.uid());
            v_old.qty_a := 0; v_old.qty_b := 0; v_old.qty_defect := 0;
        else
            update public.inventory set company = v_prod.company, qty_a = v_a, qty_b = v_b, qty_defect = v_d,
                location = coalesce(v_item->>'location', ''), memo = coalesce(v_item->>'memo', ''),
                updated_at = now(), updated_by = auth.uid()
            where product_id = v_prod.id;
        end if;
        insert into public.inventory_moves (product_id, company, code, kind, d_a, d_b, d_defect, a_after, b_after, defect_after, reason, actor_name)
        values (v_prod.id, v_prod.company, v_prod.code, '최종재고', v_a - v_old.qty_a, v_b - v_old.qty_b, v_d - v_old.qty_defect,
                v_a, v_b, v_d, coalesce(p_reason, ''), coalesce(v_name, ''));
        v_count := v_count + 1;
    end loop;

    -- 파일에 없는 이 거래처 재고 → 0
    for v_old in select * from public.inventory
                 where public.norm_company(company) = public.norm_company(p_company)
                   and not (product_id = any(v_ids))
                   and (qty_a <> 0 or qty_b <> 0 or qty_defect <> 0)
                 for update loop
        update public.inventory set qty_a = 0, qty_b = 0, qty_defect = 0, updated_at = now(), updated_by = auth.uid()
        where product_id = v_old.product_id;
        insert into public.inventory_moves (product_id, company, code, kind, d_a, d_b, d_defect, a_after, b_after, defect_after, reason, actor_name)
        select v_old.product_id, v_old.company, p.code, '최종재고', -v_old.qty_a, -v_old.qty_b, -v_old.qty_defect, 0, 0, 0,
               coalesce(p_reason, '') || ' (파일에 없음)', coalesce(v_name, '')
        from public.products p where p.id = v_old.product_id;
    end loop;
    return v_count;
end $$;

revoke all on function public.inventory_move(bigint, text, integer, integer, integer, text, text, text) from public, anon;
revoke all on function public.inventory_import(text, jsonb, text) from public, anon;
grant execute on function public.inventory_move(bigint, text, integer, integer, integer, text, text, text) to authenticated;
grant execute on function public.inventory_import(text, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
