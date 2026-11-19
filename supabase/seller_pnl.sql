-- =====================================================================
-- 밤낮딜리버리 - 셀러 손익 계산표 (출고 리포트 /report 의 [손익 계산표])
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
-- (schema.sql, stock.sql 을 먼저 실행한 상태여야 합니다. 여러 번 실행해도 안전합니다.)
--
--  - 매출(판매가×출고)·상품 매입(도매가×출고)·밤낮딜리버리 비용(정산서)은 화면이 자동으로 계산합니다. 여기엔 저장하지 않습니다.
--  - 이 표에는 셀러가 직접 적는 것만 달마다 1줄 저장합니다:
--      fee_rate    : 쇼핑몰 수수료율(%)
--      extra_sales : 기타 매출(원) — 예: 고객에게 받은 배송비
--      items       : 셀러가 적는 비용 목록 [{"label":"광고비","amount":300000}, ...]
--  - 권한: 승인된 셀러는 자기 상호 것만 보고 적습니다. 관리자는 전부 봅니다.
-- =====================================================================

create or replace function public.norm_company(v text)
returns text
language sql
immutable
as $$
    select lower(regexp_replace(coalesce(v, ''), '\s', '', 'g'));
$$;

create table if not exists public.seller_pnl (
    id           bigint generated always as identity primary key,
    company      text not null,
    month        date not null,
    fee_rate     numeric(5,2),
    extra_sales  bigint not null default 0,
    items        jsonb not null default '[]'::jsonb,
    updated_at   timestamptz not null default now(),
    updated_by   uuid default auth.uid()
);
alter table public.seller_pnl drop constraint if exists seller_pnl_month_check;
alter table public.seller_pnl add constraint seller_pnl_month_check check (extract(day from month) = 1);
alter table public.seller_pnl drop constraint if exists seller_pnl_fee_check;
alter table public.seller_pnl add constraint seller_pnl_fee_check check (fee_rate is null or (fee_rate >= 0 and fee_rate <= 100));
alter table public.seller_pnl drop constraint if exists seller_pnl_items_check;
alter table public.seller_pnl add constraint seller_pnl_items_check check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 50);
alter table public.seller_pnl drop constraint if exists seller_pnl_company_month_key;
alter table public.seller_pnl add constraint seller_pnl_company_month_key unique (company, month);

-- 셀러는 항상 자기 가입 상호로만 저장 + 수정 시각
create or replace function public.seller_pnl_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        new.company := (select company from public.profiles where id = auth.uid());
        if new.company is null then
            raise exception '셀러 정보가 없는 계정입니다.' using errcode = '42501';
        end if;
    end if;
    new.updated_at := now();
    new.updated_by := auth.uid();
    return new;
end $$;
drop trigger if exists seller_pnl_guard on public.seller_pnl;
create trigger seller_pnl_guard before insert or update on public.seller_pnl
    for each row execute function public.seller_pnl_guard();

alter table public.seller_pnl enable row level security;
drop policy if exists seller_pnl_select on public.seller_pnl;
drop policy if exists seller_pnl_insert on public.seller_pnl;
drop policy if exists seller_pnl_update on public.seller_pnl;
create policy seller_pnl_select on public.seller_pnl
    for select to authenticated
    using (public.is_admin() or (public.is_approved_seller()
        and public.norm_company(company) = (select public.norm_company(p.company) from public.profiles p where p.id = auth.uid())));
create policy seller_pnl_insert on public.seller_pnl
    for insert to authenticated
    with check (public.is_admin() or public.is_approved_seller());
create policy seller_pnl_update on public.seller_pnl
    for update to authenticated
    using (public.is_admin() or (public.is_approved_seller()
        and public.norm_company(company) = (select public.norm_company(p.company) from public.profiles p where p.id = auth.uid())))
    with check (public.is_admin() or public.is_approved_seller());
grant select, insert, update on public.seller_pnl to authenticated;

notify pgrst, 'reload schema';
