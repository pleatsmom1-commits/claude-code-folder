-- =====================================================================
-- 밤낮딜리버리 - 상품관리 (재고관리 1단계)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
-- (schema.sql, stock.sql 을 먼저 실행한 상태여야 합니다. 여러 번 실행해도 안전합니다.)
--
--  - products     : 상품 한 줄 = 도매상품 + 컬러 + 사이즈 하나. 상품코드(P000001)가 자동으로 붙습니다.
--                   mall_names = 플랫폼별 쇼핑몰상품명 목록 [{"platform":"스마트스토어","name":"..."}, ...]
--  - product_logs : 등록·수정·삭제요청·삭제 기록 (자동으로 남고, 지울 수 없음)
--  - 권한: 관리자는 전부. 승인된 셀러는 자기 상호(회원가입 상호와 거래처명이 같음) 상품을 보고·등록·수정할 수 있고,
--          삭제는 [삭제 요청]만 가능 → 관리자가 승인하면 삭제됩니다.
--  - 사진: Storage 의 product-photos 버킷 (상품당 1장, 화면에서 줄여서 올림)
-- =====================================================================

create sequence if not exists public.product_code_seq;

create table if not exists public.products (
    id                     bigint generated always as identity primary key,
    code                   text not null unique default ('P' || lpad(nextval('public.product_code_seq')::text, 6, '0')),
    company                text not null,               -- 거래처명 (재고표·회원가입 상호)
    wholesale_company      text not null default '',    -- 도매업체명
    wholesale_product      text not null default '',    -- 도매상품명
    color                  text not null default '',
    size                   text not null default '',
    mall_names             jsonb not null default '[]'::jsonb,  -- 플랫폼별 쇼핑몰상품명
    photo_url              text not null default '',
    memo                   text not null default '',
    delete_requested_at    timestamptz,                 -- 셀러의 삭제 요청
    delete_request_reason  text not null default '',
    delete_requested_by    uuid,
    deleted_at             timestamptz,                 -- 관리자가 삭제 (기록은 남김)
    created_at             timestamptz not null default now(),
    created_by             uuid default auth.uid(),
    updated_at             timestamptz not null default now(),
    updated_by             uuid default auth.uid()
);
create index if not exists products_company_idx on public.products (public.norm_company(company));
-- 같은 거래처 안에서 같은 도매처·도매상품·컬러·사이즈는 한 번만 (삭제된 상품 제외)
create unique index if not exists products_item_uidx on public.products (
    public.norm_company(company), public.norm_company(wholesale_company), public.norm_company(wholesale_product),
    public.norm_company(color), public.norm_company(size)
) where deleted_at is null;

create table if not exists public.product_logs (
    id          bigint generated always as identity primary key,
    product_id  bigint not null,
    code        text not null default '',
    company     text not null default '',
    action      text not null,           -- 등록 / 수정 / 삭제요청 / 삭제요청취소 / 삭제
    before      jsonb,
    after       jsonb,
    actor       uuid default auth.uid(),
    actor_name  text not null default '',
    at          timestamptz not null default now()
);
create index if not exists product_logs_product_idx on public.product_logs (product_id, at desc);
create index if not exists product_logs_company_idx on public.product_logs (public.norm_company(company), at desc);

-- ---------------------------------------------------------------------
-- 셀러가 바꿀 수 없는 칸 지키기 + 수정 시각 + 기록 남기기
-- ---------------------------------------------------------------------
create or replace function public.products_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'INSERT' then
        if not public.is_admin() then
            -- 셀러는 자기 상호로만 등록, 삭제 관련 칸은 비워 둠
            new.company := (select company from public.profiles where id = auth.uid());
            new.deleted_at := null;
            new.delete_requested_at := null;
            new.delete_request_reason := '';
            new.delete_requested_by := null;
        end if;
        new.created_by := auth.uid();
        new.updated_by := auth.uid();
        return new;
    end if;

    -- UPDATE
    if not public.is_admin() then
        if old.deleted_at is not null then
            raise exception '삭제된 상품은 수정할 수 없습니다.' using errcode = '42501';
        end if;
        new.company := old.company;
        new.code := old.code;
        new.deleted_at := old.deleted_at;
        if new.delete_requested_at is distinct from old.delete_requested_at then
            new.delete_requested_by := case when new.delete_requested_at is null then null else auth.uid() end;
        end if;
    end if;
    new.code := old.code;  -- 상품코드는 누구도 바꿀 수 없음
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := auth.uid();
    return new;
end $$;

drop trigger if exists products_guard on public.products;
create trigger products_guard before insert or update on public.products
    for each row execute function public.products_guard();

create or replace function public.products_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_action text;
    v_name   text;
    v_old    jsonb;
    v_new    jsonb;
begin
    select coalesce(nullif(name, ''), company, '') into v_name from public.profiles where id = auth.uid();
    if tg_op = 'INSERT' then
        insert into public.product_logs (product_id, code, company, action, before, after, actor_name)
        values (new.id, new.code, new.company, '등록', null, to_jsonb(new) - 'updated_at' - 'updated_by', coalesce(v_name, ''));
        return new;
    end if;
    v_old := to_jsonb(old) - 'updated_at' - 'updated_by';
    v_new := to_jsonb(new) - 'updated_at' - 'updated_by';
    if v_old = v_new then return new; end if;
    v_action := case
        when new.deleted_at is not null and old.deleted_at is null then '삭제'
        when new.delete_requested_at is not null and old.delete_requested_at is null then '삭제요청'
        when new.delete_requested_at is null and old.delete_requested_at is not null then '삭제요청취소'
        else '수정' end;
    insert into public.product_logs (product_id, code, company, action, before, after, actor_name)
    values (new.id, new.code, new.company, v_action, v_old, v_new, coalesce(v_name, ''));
    return new;
end $$;

drop trigger if exists products_log on public.products;
create trigger products_log after insert or update on public.products
    for each row execute function public.products_log();

-- ---------------------------------------------------------------------
-- 권한 (RLS). 행 삭제(delete)는 아무도 못 하고, 관리자가 deleted_at 을 채우는 방식으로 삭제합니다.
-- ---------------------------------------------------------------------
alter table public.products enable row level security;
alter table public.product_logs enable row level security;

drop policy if exists products_admin on public.products;
create policy products_admin on public.products
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

drop policy if exists products_seller_select on public.products;
create policy products_seller_select on public.products
    for select to authenticated
    using (public.norm_company(company) = public.my_stock_company());

drop policy if exists products_seller_insert on public.products;
create policy products_seller_insert on public.products
    for insert to authenticated
    with check (public.my_stock_company() is not null);

drop policy if exists products_seller_update on public.products;
create policy products_seller_update on public.products
    for update to authenticated
    using (public.norm_company(company) = public.my_stock_company() and deleted_at is null)
    with check (public.norm_company(company) = public.my_stock_company());

drop policy if exists product_logs_select on public.product_logs;
create policy product_logs_select on public.product_logs
    for select to authenticated
    using (public.is_admin() or public.norm_company(company) = public.my_stock_company());

grant select, insert, update on public.products to authenticated;
grant select on public.product_logs to authenticated;
grant usage on sequence public.product_code_seq to authenticated;

-- ---------------------------------------------------------------------
-- 사진 저장소 (상품당 1장). 누구나 사진 주소로 볼 수 있고, 로그인한 승인 계정만 올릴 수 있습니다.
-- 파일 이름은 화면에서 매번 새로 만들어 다른 사진을 덮어쓰지 않습니다. 지우기는 관리자만.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('product-photos', 'product-photos', true)
on conflict (id) do nothing;

drop policy if exists product_photos_insert on storage.objects;
create policy product_photos_insert on storage.objects
    for insert to authenticated
    with check (bucket_id = 'product-photos' and (public.is_admin() or public.my_stock_company() is not null));

drop policy if exists product_photos_admin_delete on storage.objects;
create policy product_photos_admin_delete on storage.objects
    for delete to authenticated
    using (bucket_id = 'product-photos' and public.is_admin());

notify pgrst, 'reload schema';
