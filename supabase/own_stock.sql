-- =====================================================================
-- 밤낮딜리버리 - 셀러 "내 재고표" (풀필먼트·재고보관을 안 쓰는 택배 업체용, 2026-11-19)
--  셀러가 자기 사무실에 가지고 있는 재고를 직접 적어 두는 표입니다.
--  밤낮딜리버리 사무실 재고(inventory)와는 완전히 따로입니다. (서로 영향 없음)
--  상품은 기존 상품관리(products)에 등록한 상품을 그대로 씁니다.
--  Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
--  (products.sql 을 먼저 실행한 상태여야 합니다. 여러 번 실행해도 안전합니다.)
-- =====================================================================

-- 1. 상품별 내 재고 수량 (상품 1개당 1줄)
create table if not exists public.seller_own_stock (
    product_id  bigint primary key references public.products(id) on delete cascade,
    company     text not null,
    qty         integer not null default 0 check (qty >= 0),
    updated_at  timestamptz not null default now(),
    updated_by  uuid default auth.uid()
);
create index if not exists seller_own_stock_company_idx on public.seller_own_stock (public.norm_company(company));

-- 2. 바뀐 기록 (누가·언제·몇 개·왜)
create table if not exists public.seller_own_stock_moves (
    id          bigint generated always as identity primary key,
    product_id  bigint not null references public.products(id) on delete cascade,
    company     text not null,
    change      integer not null,
    qty_after   integer not null,
    reason      text not null default '',
    created_at  timestamptz not null default now(),
    user_id     uuid default auth.uid()
);
create index if not exists seller_own_stock_moves_idx on public.seller_own_stock_moves (public.norm_company(company), created_at desc);

-- 3. 보기: 셀러는 자기 상호 것만, 관리자는 모두 (직접 쓰기는 막고 아래 함수로만 바꿈)
alter table public.seller_own_stock enable row level security;
alter table public.seller_own_stock_moves enable row level security;

drop policy if exists seller_own_stock_select on public.seller_own_stock;
create policy seller_own_stock_select on public.seller_own_stock
    for select to authenticated
    using (public.is_admin() or public.norm_company(company) = public.my_stock_company());

drop policy if exists seller_own_stock_moves_select on public.seller_own_stock_moves;
create policy seller_own_stock_moves_select on public.seller_own_stock_moves
    for select to authenticated
    using (public.is_admin() or public.norm_company(company) = public.my_stock_company());

-- 4. 재고 바꾸기 (셀러 본인 상품만, 관리자·직원은 못 바꿈)
--  p_items: [{"product_id": 1, "qty": 5}]   → p_mode 'set' : 그 수량으로 맞춤
--           [{"product_id": 1, "change": -2}] → p_mode 'add' : 더하거나 뺌 (0 아래로는 안 내려감)
--  돌려주는 값: 바뀐 상품 수
create or replace function public.own_stock_apply(p_items jsonb, p_mode text default 'set', p_reason text default '')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    me      text := public.my_stock_company();
    it      jsonb;
    pid     bigint;
    pcomp   text;
    old_q   integer;
    new_q   integer;
    n       integer := 0;
begin
    -- 이 재고표는 셀러가 직접 관리합니다. 밤낮딜리버리 관리자·직원 계정은 보기만 되고 바꿀 수 없음 (대표님 결정 2026-11-19)
    if public.is_admin() then
        raise exception '내 재고표는 업체 대표님이 직접 관리합니다. 밤낮딜리버리 관리자는 수정할 수 없습니다.';
    end if;
    if me is null or me = '' then
        raise exception '승인된 셀러 계정만 내 재고표를 바꿀 수 있습니다.';
    end if;
    if p_mode not in ('set', 'add') then
        raise exception 'p_mode 는 set 또는 add 만 됩니다.';
    end if;
    for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
        pid := (it->>'product_id')::bigint;
        select company into pcomp from public.products
            where id = pid and deleted_at is null and public.norm_company(company) = me;
        if pcomp is null then continue; end if;      -- 남의 상품·삭제된 상품은 건너뜀
        select qty into old_q from public.seller_own_stock where product_id = pid for update;
        old_q := coalesce(old_q, 0);
        if p_mode = 'set' then
            new_q := greatest(coalesce((it->>'qty')::integer, 0), 0);
        else
            new_q := greatest(old_q + coalesce((it->>'change')::integer, 0), 0);
        end if;
        if new_q = old_q and exists (select 1 from public.seller_own_stock where product_id = pid) then continue; end if;
        insert into public.seller_own_stock (product_id, company, qty, updated_at, updated_by)
            values (pid, pcomp, new_q, now(), auth.uid())
            on conflict (product_id) do update set qty = excluded.qty, company = excluded.company,
                updated_at = now(), updated_by = auth.uid();
        if new_q <> old_q then
            insert into public.seller_own_stock_moves (product_id, company, change, qty_after, reason)
                values (pid, pcomp, new_q - old_q, new_q, left(coalesce(p_reason, ''), 200));
        end if;
        n := n + 1;
    end loop;
    return n;
end;
$$;

revoke all on function public.own_stock_apply(jsonb, text, text) from public, anon;
grant execute on function public.own_stock_apply(jsonb, text, text) to authenticated;
