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
-- 2. 접수 시간 규칙 (한국 시간 기준, 서버에서 강제)
--    15:00 ~ 익일 07:00 : 신규 접수 + 수정/삭제 가능
--    07:00 ~ 10:00      : 신규 접수만 가능
--    10:00 ~ 15:00      : 마감 (셀러는 아무것도 불가)
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
    select public.kst_hour() >= 15 or public.kst_hour() < 10;
$$;

create or replace function public.can_modify_orders()
returns boolean
language sql
stable
set search_path = public
as $$
    select public.kst_hour() >= 15 or public.kst_hour() < 7;
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

alter table public.orders add column if not exists seller_id uuid references auth.users(id) on delete set null;
alter table public.orders alter column seller_id set default auth.uid();
alter table public.orders alter column created_at set default now();
create index if not exists orders_seller_id_idx on public.orders (seller_id);
create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_status_idx on public.orders (status);
alter table public.orders enable row level security;

-- 셀러가 다른 업체 이름으로 등록하거나, 상태(접수완료)를 스스로 바꾸는 것을 막습니다.
create or replace function public.orders_enforce_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_company text;
begin
    if tg_op = 'UPDATE' then
        -- 주문의 주인과 접수번호/접수시간은 누구도 바꿀 수 없습니다.
        new.id := old.id;
        new.seller_id := old.seller_id;
        new.seller_company := old.seller_company;
        new.created_at := old.created_at;
        if not public.is_admin() then
            new.status := old.status;
        end if;
        return new;
    end if;

    -- INSERT
    if public.is_admin() then
        return new;
    end if;

    select company into v_company from public.profiles where id = auth.uid();
    if v_company is null then
        raise exception '셀러 정보가 없는 계정입니다.' using errcode = '42501';
    end if;

    new.seller_id := auth.uid();
    new.seller_company := v_company;
    new.status := '접수대기';
    new.created_at := now();
    return new;
end;
$$;

drop trigger if exists orders_enforce_owner on public.orders;
create trigger orders_enforce_owner
    before insert or update on public.orders
    for each row execute function public.orders_enforce_owner();

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

-- 등록: 셀러는 접수 가능 시간에만
create policy orders_insert on public.orders
    for insert to authenticated
    with check ((seller_id = auth.uid() and public.is_approved_seller() and public.can_add_orders()) or public.is_admin());

-- 수정: 셀러는 수정 가능 시간 + 접수대기 상태인 자기 주문만
create policy orders_update on public.orders
    for update to authenticated
    using ((seller_id = auth.uid() and public.is_approved_seller() and status = '접수대기' and public.can_modify_orders()) or public.is_admin())
    with check (seller_id = auth.uid() or public.is_admin());

-- 삭제: 수정과 같은 조건
create policy orders_delete on public.orders
    for delete to authenticated
    using ((seller_id = auth.uid() and public.is_approved_seller() and status = '접수대기' and public.can_modify_orders()) or public.is_admin());

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

-- 프로필: 본인 것만 조회, 관리자는 전체 조회/수정 (셀러는 role 을 바꿀 수 없음)
create policy profiles_select on public.profiles
    for select to authenticated
    using (id = auth.uid() or public.is_admin());

create policy profiles_admin_update on public.profiles
    for update to authenticated
    using (public.is_admin())
    with check (public.is_admin());

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
