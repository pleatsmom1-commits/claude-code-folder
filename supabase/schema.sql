-- =====================================================================
-- 밤낮딜리버리 풀필먼트 - Supabase 보안 스키마
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
-- 여러 번 실행해도 안전하도록 작성되어 있습니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 셀러/관리자 프로필 (로그인 계정은 Supabase Auth가 암호화해서 관리)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
    id          uuid primary key references auth.users(id) on delete cascade,
    company     text not null,
    name        text,
    phone       text,
    role        text not null default 'seller' check (role in ('seller', 'admin')),
    created_at  timestamptz not null default now()
);
alter table public.profiles add column if not exists name       text;
alter table public.profiles add column if not exists phone      text;
alter table public.profiles add column if not exists role       text not null default 'seller';
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles enable row level security;

-- 셀러 관리용 칸: 이메일(목록 표시용), 승인 상태
--   pending   : 가입 후 관리자 승인 대기 (주문 불가)
--   approved  : 승인됨 (주문 가능)
--   suspended : 이용 정지 (주문 불가)
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists status text;
-- 이 칸이 생기기 전에 가입한 계정은 기존처럼 쓸 수 있도록 '승인'으로 채웁니다.
update public.profiles set status = 'approved' where status is null;
alter table public.profiles alter column status set default 'pending';
alter table public.profiles alter column status set not null;
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'profiles_status_check') then
        alter table public.profiles add constraint profiles_status_check
            check (status in ('pending', 'approved', 'suspended'));
    end if;
end;
$$;
update public.profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

-- 이 스키마를 실행하기 전에 가입한 계정은 프로필이 없어 로그인 후
-- "계정 정보를 불러오지 못했습니다" 오류가 납니다. 빠진 프로필을 채워 넣습니다.
-- (승인대기 상태로 만들어지므로, 셀러는 관리자 화면에서 승인하면 됩니다)
insert into public.profiles (id, email, company, name, phone, status)
select
    u.id,
    u.email,
    coalesce(nullif(trim(u.raw_user_meta_data->>'company'), ''), '미등록'),
    nullif(trim(u.raw_user_meta_data->>'name'), ''),
    nullif(trim(u.raw_user_meta_data->>'phone'), ''),
    'pending'
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- 회원가입 시 프로필 자동 생성 (role 은 항상 seller, 상태는 승인 대기로 시작)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, email, company, name, phone)
    values (
        new.id,
        new.email,
        coalesce(nullif(trim(new.raw_user_meta_data->>'company'), ''), '미등록'),
        nullif(trim(new.raw_user_meta_data->>'name'), ''),
        nullif(trim(new.raw_user_meta_data->>'phone'), '')
    );
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- 현재 로그인한 사용자가 관리자인지 확인
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- 현재 로그인한 사용자가 승인된 셀러인지 확인 (승인 대기/정지 계정은 주문 불가)
create or replace function public.is_approved_seller()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (select 1 from public.profiles where id = auth.uid() and status = 'approved');
$$;

-- ---------------------------------------------------------------------
-- 2. 접수 시간: 24시간 접수 가능
--    (07:30~14:00 접수건에 대한 카카오톡 안내는 화면에서 알림창으로 처리합니다)
--    예전 버전에서 쓰던 시간 함수는 호환을 위해 남겨두되 항상 허용합니다.
-- ---------------------------------------------------------------------
create or replace function public.kst_hour()
returns int
language sql
stable
set search_path = public
as $$
    select extract(hour from (now() at time zone 'Asia/Seoul'))::int;
$$;

create or replace function public.can_add_orders()
returns boolean
language sql
stable
set search_path = public
as $$
    select true;
$$;

create or replace function public.can_modify_orders()
returns boolean
language sql
stable
set search_path = public
as $$
    select true;
$$;

-- ---------------------------------------------------------------------
-- 3. 주문 테이블 (기존 테이블이 있으면 필요한 컬럼만 추가)
-- ---------------------------------------------------------------------
create table if not exists public.orders (
    id                  text primary key,
    seller_company      text not null,
    sender_name         text,
    cs_phone            text,
    recipient           text not null,
    phone               text not null,
    zipcode             text,
    address             text not null,
    detail_address      text,
    product             text not null,
    wholesale_company   text,
    wholesale_product   text,
    memo                text,
    bamnat_memo         text,
    qty                 integer default 1,
    status              text default '접수대기',
    created_at          timestamptz default now()
);

-- 예전 버전으로 만들어진 orders 테이블에는 일부 칸이 없을 수 있습니다.
-- (예: "Could not find the 'bamnat_memo' column" 오류) 앱이 쓰는 칸을 모두 확인해서 없으면 추가합니다.
alter table public.orders add column if not exists seller_company    text;
alter table public.orders add column if not exists sender_name       text;
alter table public.orders add column if not exists cs_phone          text;
alter table public.orders add column if not exists recipient         text;
alter table public.orders add column if not exists phone             text;
alter table public.orders add column if not exists zipcode           text;
alter table public.orders add column if not exists address           text;
alter table public.orders add column if not exists detail_address    text;
alter table public.orders add column if not exists product           text;
alter table public.orders add column if not exists wholesale_company text;
alter table public.orders add column if not exists wholesale_product text;
alter table public.orders add column if not exists memo              text;
alter table public.orders add column if not exists bamnat_memo       text;
alter table public.orders add column if not exists qty               integer default 1;
alter table public.orders add column if not exists status            text default '접수대기';
alter table public.orders add column if not exists created_at        timestamptz default now();
alter table public.orders add column if not exists seller_id uuid references auth.users(id) on delete set null;
alter table public.orders alter column seller_id set default auth.uid();
alter table public.orders alter column created_at set default now();
create index if not exists orders_seller_id_idx on public.orders (seller_id);
create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_status_idx on public.orders (status);

-- 주문 번호 / 출고 관리
--   order_no    : 주문 번호 (합배송 '(합)' 상품은 같은 받는분이면 같은 번호로 묶임)
--   item_no     : 주문 안의 상품 번호 (예: 15-1, 15-2)
--   ship_status : 상품별 출고 상태 ('미출고' / '출고완료')
create sequence if not exists public.orders_order_no_seq;
alter table public.orders add column if not exists order_no bigint;
alter table public.orders add column if not exists item_no integer;
alter table public.orders add column if not exists ship_status text;
alter table public.orders add column if not exists shipped_at timestamptz;
alter table public.orders add column if not exists courier text;       -- 택배사
alter table public.orders add column if not exists tracking_no text;   -- 송장(운송장)번호
alter table public.orders add column if not exists seller_order_no integer;  -- 셀러별 접수 순번 (셀러마다 1번부터)
update public.orders set ship_status = '미출고' where ship_status is null;
alter table public.orders alter column ship_status set default '미출고';
alter table public.orders alter column ship_status set not null;
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'orders_ship_status_check') then
        alter table public.orders add constraint orders_ship_status_check
            check (ship_status in ('미출고', '출고완료'));
    end if;
end;
$$;
create index if not exists orders_order_no_idx on public.orders (order_no desc, item_no);
alter table public.orders enable row level security;

-- 합배송 묶음 비교용: 공백 제거 / 숫자만
create or replace function public.norm_text(v text)
returns text
language sql
immutable
as $$
    select regexp_replace(coalesce(v, ''), '\s', '', 'g');
$$;

create or replace function public.norm_phone(v text)
returns text
language sql
immutable
as $$
    select regexp_replace(coalesce(v, ''), '\D', '', 'g');
$$;

-- 새 주문(상품)에 붙일 번호를 정합니다.
-- 상품명에 '(합)'이 있으면, 같은 셀러 + 같은 받는분(이름/연락처/주소) + 같은 상태의
-- '(합)' 주문이 이미 있을 때 그 번호에 이어 붙입니다 (15-1, 15-2 ...).
-- 그 외에는 새 번호를 받습니다.
create or replace function public.orders_pick_number(
    p_id text, p_seller uuid, p_recipient text, p_phone text,
    p_address text, p_detail text, p_product text, p_status text,
    out o_order_no bigint, out o_item_no integer)
language plpgsql
security definer
set search_path = public
as $$
begin
    if coalesce(p_product, '') like '%(합)%' then
        select o.order_no into o_order_no
        from public.orders o
        where o.order_no is not null
          and o.id <> coalesce(p_id, '')
          and o.seller_id is not distinct from p_seller
          and coalesce(o.status, '접수대기') = coalesce(p_status, '접수대기')
          and o.product like '%(합)%'
          and public.norm_text(o.recipient) = public.norm_text(p_recipient)
          and public.norm_phone(o.phone) = public.norm_phone(p_phone)
          and public.norm_text(o.address || coalesce(o.detail_address, ''))
              = public.norm_text(p_address || coalesce(p_detail, ''))
        order by o.created_at desc
        limit 1;
    end if;

    if o_order_no is null then
        o_order_no := nextval('public.orders_order_no_seq');
        o_item_no := 1;
    else
        select coalesce(max(item_no), 0) + 1 into o_item_no
        from public.orders where order_no = o_order_no;
    end if;
end;
$$;

-- 셀러별 접수 순번: 셀러마다 1번부터 접수 순서대로. 합배송으로 같은 주문(order_no)에 묶이면 같은 순번.
create or replace function public.orders_pick_seller_no(p_seller uuid, p_order_no bigint, p_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_no integer;
begin
    -- 같은 셀러가 동시에 등록해도 번호가 겹치지 않도록 셀러 단위로 잠급니다.
    perform pg_advisory_xact_lock(hashtext('seller_order_no:' || coalesce(p_seller::text, '')));
    select seller_order_no into v_no
    from public.orders
    where order_no = p_order_no and seller_order_no is not null and id <> coalesce(p_id, '')
    limit 1;
    if v_no is null then
        select coalesce(max(seller_order_no), 0) + 1 into v_no
        from public.orders
        where seller_id is not distinct from p_seller;
    end if;
    return v_no;
end;
$$;

-- 셀러가 다른 업체 이름으로 등록하거나, 상태(접수완료)/출고상태/주문번호를 스스로 바꾸는 것을 막습니다.
-- 관리자, 그리고 SQL Editor 에서 직접 실행하는 경우(auth.uid() 없음)는 제한하지 않습니다.
create or replace function public.orders_enforce_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_company text;
    v_privileged boolean := public.is_admin() or auth.uid() is null;
begin
    if tg_op = 'UPDATE' then
        -- 주문의 주인과 접수번호/접수시간은 누구도 바꿀 수 없습니다.
        new.id := old.id;
        new.seller_id := old.seller_id;
        new.seller_company := old.seller_company;
        new.created_at := old.created_at;
        -- 주문 번호는 한 번 정해지면 바뀌지 않습니다. (예전 주문에 번호를 채울 때만 허용)
        if old.order_no is not null or not v_privileged then
            new.order_no := old.order_no;
            new.item_no := old.item_no;
        end if;
        if old.seller_order_no is not null or not v_privileged then
            new.seller_order_no := old.seller_order_no;
        end if;
        if not v_privileged then
            new.status := old.status;
            new.ship_status := old.ship_status;
            new.shipped_at := old.shipped_at;
            new.courier := old.courier;
            new.tracking_no := old.tracking_no;
        elsif new.ship_status is distinct from old.ship_status then
            -- 출고완료는 송장번호가 있어야만 가능합니다.
            if new.ship_status = '출고완료' and coalesce(trim(new.tracking_no), '') = '' then
                raise exception '송장번호를 먼저 입력해야 출고완료로 바꿀 수 있습니다.' using errcode = 'P0001';
            end if;
            new.shipped_at := case when new.ship_status = '출고완료' then now() else null end;
            -- 출고된 주문은 자동으로 접수완료 (셀러 수정/삭제 잠금)
            if new.ship_status = '출고완료' and coalesce(new.status, '접수대기') = '접수대기' then
                new.status := '접수완료';
            end if;
        end if;
        return new;
    end if;

    -- INSERT
    if not v_privileged then
        select company into v_company from public.profiles where id = auth.uid();
        if v_company is null then
            raise exception '셀러 정보가 없는 계정입니다.' using errcode = '42501';
        end if;

        new.seller_id := auth.uid();
        new.seller_company := v_company;
        new.status := '접수대기';
        new.created_at := now();
        new.ship_status := '미출고';
        new.shipped_at := null;
        new.courier := null;
        new.tracking_no := null;
        new.order_no := null;
        new.item_no := null;
        new.seller_order_no := null;
    end if;

    if new.order_no is null then
        select o_order_no, o_item_no into new.order_no, new.item_no
        from public.orders_pick_number(new.id, new.seller_id, new.recipient, new.phone,
                                       new.address, new.detail_address, new.product,
                                       coalesce(new.status, '접수대기'));
    end if;
    if new.seller_order_no is null then
        new.seller_order_no := public.orders_pick_seller_no(new.seller_id, new.order_no, new.id);
    end if;
    return new;
end;
$$;

drop trigger if exists orders_enforce_owner on public.orders;
create trigger orders_enforce_owner
    before insert or update on public.orders
    for each row execute function public.orders_enforce_owner();

-- 번호가 없는 기존 주문에 접수 순서대로 주문 번호를 채워 넣습니다.
do $$
declare
    r record;
    v_no bigint;
    v_item integer;
begin
    for r in select * from public.orders where order_no is null order by created_at, id loop
        select o_order_no, o_item_no into v_no, v_item
        from public.orders_pick_number(r.id, r.seller_id, r.recipient, r.phone,
                                       r.address, r.detail_address, r.product, r.status);
        update public.orders set order_no = v_no, item_no = v_item where id = r.id;
    end loop;

    -- 셀러별 접수 순번이 없는 주문에 접수 순서대로 채워 넣기
    for r in select id, seller_id, order_no from public.orders where seller_order_no is null order by created_at, id loop
        update public.orders
        set seller_order_no = public.orders_pick_seller_no(r.seller_id, r.order_no, r.id)
        where id = r.id;
    end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. 접근 권한 정책 (RLS)
-- ---------------------------------------------------------------------
-- 예전의 "누구나 모든 것 허용" 정책 제거
drop policy if exists "Allow all access to orders" on public.orders;
do $$
begin
    if to_regclass('public.sellers') is not null then
        execute 'drop policy if exists "Allow all access to sellers" on public.sellers';
    end if;
end;
$$;

drop policy if exists orders_select on public.orders;
drop policy if exists orders_insert on public.orders;
drop policy if exists orders_update on public.orders;
drop policy if exists orders_delete on public.orders;

-- 조회: 셀러는 자기 주문만, 관리자는 전체
create policy orders_select on public.orders
    for select to authenticated
    using (seller_id = auth.uid() or public.is_admin());

-- 등록: 승인된 셀러는 24시간 가능
create policy orders_insert on public.orders
    for insert to authenticated
    with check ((seller_id = auth.uid() and public.is_approved_seller()) or public.is_admin());

-- 수정: 셀러는 관리자 마감 전(접수대기) + 출고 전(미출고)인 자기 주문만
create policy orders_update on public.orders
    for update to authenticated
    using ((seller_id = auth.uid() and public.is_approved_seller() and status = '접수대기' and ship_status = '미출고') or public.is_admin())
    with check (seller_id = auth.uid() or public.is_admin());

-- 삭제: 수정과 같은 조건
create policy orders_delete on public.orders
    for delete to authenticated
    using ((seller_id = auth.uid() and public.is_approved_seller() and status = '접수대기' and ship_status = '미출고') or public.is_admin());

-- 관리자 화면에서 셀러 정보를 고칠 때 id/이메일/가입일은 바뀌지 않게 하고,
-- 관리자 계정은 항상 승인 상태로 유지합니다. (권한(role) 변경은 SQL 로만 합니다)
create or replace function public.profiles_protect()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.id := old.id;
    new.email := old.email;
    new.created_at := old.created_at;
    if current_user in ('authenticated', 'anon') then
        new.role := old.role;
        -- 셀러 본인(내정보)은 대표자명/연락처만 바꿀 수 있습니다. 상호명·상태는 관리자만.
        if not public.is_admin() then
            new.company := old.company;
            new.status := old.status;
        end if;
    end if;
    if new.role = 'admin' then
        new.status := 'approved';
    end if;
    return new;
end;
$$;

drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect
    before update on public.profiles
    for each row execute function public.profiles_protect();

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_admin_update on public.profiles;
drop policy if exists profiles_self_update on public.profiles;

-- 프로필: 본인 것만 조회, 관리자는 전체 조회/수정 (셀러는 role 을 바꿀 수 없음)
create policy profiles_select on public.profiles
    for select to authenticated
    using (id = auth.uid() or public.is_admin());

create policy profiles_admin_update on public.profiles
    for update to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- 내정보: 셀러 본인이 대표자명/연락처 수정 (상호명·상태·권한은 위 트리거가 막음)
create policy profiles_self_update on public.profiles
    for update to authenticated
    using (id = auth.uid())
    with check (id = auth.uid());

-- ---------------------------------------------------------------------
-- 4-2. 택배사 목록 (관리자가 추가/삭제, 모두 조회 가능)
-- ---------------------------------------------------------------------
create table if not exists public.couriers (
    id          uuid primary key default gen_random_uuid(),
    name        text not null unique,
    sort_order  integer not null default 0,
    created_at  timestamptz not null default now()
);
alter table public.couriers enable row level security;
insert into public.couriers (name, sort_order) values
    ('우체국택배', 1),
    ('딜리래빗(당일택배)', 2)
on conflict (name) do nothing;

drop policy if exists couriers_select on public.couriers;
drop policy if exists couriers_admin_write on public.couriers;
create policy couriers_select on public.couriers
    for select to authenticated
    using (true);
create policy couriers_admin_write on public.couriers
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 4-1. 자주 쓰는 주소록 (셀러별)
-- ---------------------------------------------------------------------
create table if not exists public.address_book (
    id              uuid primary key default gen_random_uuid(),
    seller_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
    label           text,
    recipient       text,
    phone           text,
    zipcode         text,
    address         text not null,
    detail_address  text,
    created_at      timestamptz not null default now()
);
create index if not exists address_book_seller_idx on public.address_book (seller_id, created_at desc);
alter table public.address_book enable row level security;

drop policy if exists address_book_own on public.address_book;
create policy address_book_own on public.address_book
    for all to authenticated
    using (seller_id = auth.uid())
    with check (seller_id = auth.uid());

-- ---------------------------------------------------------------------
-- 5. 예전 sellers 테이블 (비밀번호가 평문으로 저장되어 있었음)
--    위에서 공개 정책을 제거했으므로 이제 앱에서는 읽을 수 없습니다.
--    기존 셀러가 새 방식으로 모두 재가입한 뒤 아래 줄의 주석(--)을 지우고 실행해 삭제하세요.
-- ---------------------------------------------------------------------
-- drop table if exists public.sellers;

-- ---------------------------------------------------------------------
-- 6. 관리자 지정 (관리자 이메일로 먼저 회원가입한 뒤 이메일을 바꿔서 실행)
-- ---------------------------------------------------------------------
-- update public.profiles set role = 'admin', status = 'approved'
-- where id = (select id from auth.users where email = '관리자이메일@example.com');

-- ---------------------------------------------------------------------
-- 7. 앱(API)이 새 칸을 바로 인식하도록 스키마 캐시 새로고침
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
