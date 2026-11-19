-- =====================================================================
-- 밤낮딜리버리 - 상호통일 (한 거래처가 상호를 여러 개 쓸 때 메인 상호 하나로 묶기)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
-- (schema.sql, stock.sql, products.sql, inventory.sql 다음에 실행. 여러 번 실행해도 안전합니다.)
--
--  예) 상품은 '에스비컴퍼니'로 등록했는데 사이트 가입 상호는 '미닛걸'
--      → 다른 상호 '에스비컴퍼니' / 메인 상호 '미닛걸' 로 한 줄 등록
--
--  적용되는 곳 (재고·상품 관련만):
--    상품관리 · 새 재고표 · 재고출고 · 재고 증감 내역 · 재고 확정 기록 · 예전 재고표 ·
--    셀러 재고 확인 · 쇼핑몰 주문서 올리기의 상품 찾기(사입할 상품 목록)
--  적용 안 되는 곳: 주문관리 · 정산서 · 이용 현황 · 출고 리포트 · 회원 정보(가입 상호는 그대로)
--
--  - company_aliases : 다른 상호 → 메인 상호 (관리자만 보고 바꿈)
--  - 줄을 추가하면 지금 있는 상품·재고·기록의 상호가 바로 메인 상호로 바뀌고,
--    앞으로 다른 상호로 등록해도 자동으로 메인 상호로 저장됩니다.
--  - 줄을 지워도 이미 바뀐 상호는 되돌아가지 않습니다 (앞으로 자동 변경만 멈춤).
-- =====================================================================

create or replace function public.norm_company(v text)
returns text
language sql
immutable
as $$
    select lower(regexp_replace(coalesce(v, ''), '\s', '', 'g'));
$$;

create table if not exists public.company_aliases (
    id          bigint generated always as identity primary key,
    alias       text not null,                  -- 다른 상호 (들어오는 이름)
    main        text not null,                  -- 메인 상호 (통일할 이름)
    memo        text not null default '',
    created_at  timestamptz not null default now(),
    created_by  uuid default auth.uid()
);
create unique index if not exists company_aliases_alias_uidx on public.company_aliases (public.norm_company(alias));

alter table public.company_aliases enable row level security;
drop policy if exists company_aliases_admin on public.company_aliases;
create policy company_aliases_admin on public.company_aliases
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- 상호 → 메인 상호 (등록 안 된 상호는 그대로)
create or replace function public.main_company(v text)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
        (select a.main from public.company_aliases a where public.norm_company(a.alias) = public.norm_company(v) limit 1),
        v);
$$;

-- 셀러가 볼 수 있는 재고 상호: 가입 상호가 '다른 상호'로 등록돼 있으면 메인 상호로
create or replace function public.my_stock_company()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select public.norm_company(public.main_company(company)) from public.profiles
    where id = auth.uid() and status = 'approved';
$$;

-- 앞으로 다른 상호로 등록·수정해도 메인 상호로 저장 (products_guard 다음에 실행됨: 이름 순서)
create or replace function public.products_unify_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    new.company := public.main_company(new.company);
    return new;
end $$;

drop trigger if exists products_unify on public.products;
create trigger products_unify before insert or update of company on public.products
    for each row execute function public.products_unify_company();

-- ---------------------------------------------------------------------
-- 지금 있는 자료를 메인 상호로 옮기기 (관리자만). 줄을 추가할 때 화면이 자동으로 부릅니다.
--   같은 상품(도매처·도매상품·컬러·사이즈)이 두 상호에 모두 있으면 그 상품은 옮기지 않고 알려줍니다.
-- ---------------------------------------------------------------------
create or replace function public.company_unify_apply(p_alias text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    a       record;
    p       record;
    v_prod  int := 0;
    v_inv   int := 0;
    v_moves int := 0;
    v_other int := 0;
    v_n     int;
    v_dups  jsonb := '[]'::jsonb;
begin
    if not public.is_admin() and auth.uid() is not null then
        raise exception '관리자만 할 수 있습니다.' using errcode = '42501';
    end if;
    for a in select alias, main from public.company_aliases
             where p_alias is null or public.norm_company(alias) = public.norm_company(p_alias) loop
        if public.norm_company(a.alias) = public.norm_company(a.main) then continue; end if;

        -- 상품: 한 줄씩 (겹치는 상품은 건너뜀)
        for p in select id, code from public.products where public.norm_company(company) = public.norm_company(a.alias) loop
            begin
                update public.products set company = a.main where id = p.id;
                v_prod := v_prod + 1;
            exception when unique_violation then
                v_dups := v_dups || jsonb_build_object('code', p.code, 'alias', a.alias, 'main', a.main);
            end;
        end loop;

        -- 재고·기록은 상품을 따라감 (옮기지 못한 상품의 재고는 그대로)
        update public.inventory i set company = pr.company
          from public.products pr
         where pr.id = i.product_id and public.norm_company(i.company) = public.norm_company(a.alias)
           and public.norm_company(pr.company) <> public.norm_company(a.alias);
        get diagnostics v_n = row_count; v_inv := v_inv + v_n;

        update public.inventory_moves m set company = pr.company
          from public.products pr
         where pr.id = m.product_id and public.norm_company(m.company) = public.norm_company(a.alias)
           and public.norm_company(pr.company) <> public.norm_company(a.alias);
        get diagnostics v_n = row_count; v_moves := v_moves + v_n;

        if to_regclass('public.inventory_snapshots') is not null then
            update public.inventory_snapshots s set company = pr.company
              from public.products pr
             where pr.id = s.product_id and public.norm_company(s.company) = public.norm_company(a.alias)
               and public.norm_company(pr.company) <> public.norm_company(a.alias);
            get diagnostics v_n = row_count; v_other := v_other + v_n;
        end if;
        if to_regclass('public.order_stock_picks') is not null then
            update public.order_stock_picks s set company = pr.company
              from public.products pr
             where pr.id = s.product_id and public.norm_company(s.company) = public.norm_company(a.alias)
               and public.norm_company(pr.company) <> public.norm_company(a.alias);
            get diagnostics v_n = row_count; v_other := v_other + v_n;
        end if;
        -- 쇼핑몰상품명 연결(재고출고에서 기억한 것): 메인 상호에 같은 이름이 이미 있으면 그대로 둠
        if to_regclass('public.product_aliases') is not null then
            update public.product_aliases x set company = a.main
             where public.norm_company(x.company) = public.norm_company(a.alias)
               and not exists (select 1 from public.product_aliases y
                                where public.norm_company(y.company) = public.norm_company(a.main)
                                  and public.norm_company(y.alias) = public.norm_company(x.alias));
            get diagnostics v_n = row_count; v_other := v_other + v_n;
        end if;
        -- 예전 재고표
        if to_regclass('public.stock_items') is not null then
            update public.stock_items set company = a.main where public.norm_company(company) = public.norm_company(a.alias);
            get diagnostics v_n = row_count; v_other := v_other + v_n;
        end if;
        -- 쇼핑몰 주문서 양식 기억 (셀러 상호 기준)
        if to_regclass('public.order_file_formats') is not null then
            update public.order_file_formats f set company = public.norm_company(a.main)
             where f.company = public.norm_company(a.alias)
               and not exists (select 1 from public.order_file_formats g
                                where g.company = public.norm_company(a.main) and g.signature = f.signature);
            get diagnostics v_n = row_count; v_other := v_other + v_n;
        end if;
    end loop;
    return jsonb_build_object('products', v_prod, 'inventory', v_inv, 'moves', v_moves, 'other', v_other, 'dups', v_dups);
end $$;

-- 화면용: 상호마다 상품·재고가 몇 개씩 있는지 (메인 상호 고를 때 참고)
create or replace function public.company_unify_counts()
returns table (company text, products bigint, stock bigint)
language sql
stable
security definer
set search_path = public
as $$
    select min(p.company), count(*), coalesce(sum(i.qty_a + i.qty_b + i.qty_defect), 0)::bigint
      from public.products p left join public.inventory i on i.product_id = p.id
     where p.deleted_at is null and public.is_admin()
     group by public.norm_company(p.company);
$$;

grant execute on function public.main_company(text) to authenticated;
grant execute on function public.company_unify_apply(text) to authenticated;
grant execute on function public.company_unify_counts() to authenticated;
