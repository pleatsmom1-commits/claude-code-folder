-- =====================================================================
-- 밤낮딜리버리 - 직원용 관리자 아이디 + 관리자 작업 기록 (2026-11-16)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요. (여러 번 실행해도 안전합니다)
-- (schema.sql 을 먼저 실행한 상태여야 합니다. is_admin() 함수를 씁니다.)
--
--  1) 직원 아이디
--     - profiles.admin_level : 'owner' = 대표(지금 쓰는 관리자 아이디), 'staff' = 직원, 빈칸 = 셀러
--     - 지금 있는 관리자 아이디는 모두 '대표'가 됩니다.
--     - 직원 추가·끄기·다시 켜기는 대표만 할 수 있습니다 (staff_set 함수).
--       직원은 관리자 화면의 다른 기능은 대표와 똑같이 씁니다.
--     - 직원을 끄면 그 아이디는 바로 관리자 기능이 막힙니다. (기록은 그대로 남음)
--
--  2) 작업 기록 (admin_activity 표)
--     - 관리자(대표·직원) 아이디로 주문·픽업·재고·상품·정산·셀러정보 등을 추가/수정/삭제하면
--       DB 가 자동으로 "누가 · 언제 · 어느 표 · 무엇을(바뀌기 전 → 후)" 을 한 줄씩 적습니다.
--     - 셀러가 직접 한 일은 적지 않습니다. (관리자 작업만)
--     - 기록은 대표만 볼 수 있고, 아무도 고치거나 지울 수 없습니다. 400일이 지난 기록은 자동 정리됩니다.
--     - 기록하다 문제가 생겨도 원래 작업(주문 저장 등)은 막지 않습니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 대표 / 직원 구분 칸
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists admin_level text;
update public.profiles set admin_level = 'owner' where role = 'admin' and admin_level is null;
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'profiles_admin_level_check') then
        alter table public.profiles add constraint profiles_admin_level_check
            check (admin_level is null or admin_level in ('owner', 'staff'));
    end if;
end;
$$;

-- 지금 로그인한 사람이 대표(관리자 중 직원이 아닌 사람)인지
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'admin' and coalesce(admin_level, 'owner') = 'owner'
    );
$$;

-- 화면에서 고칠 때 바뀌면 안 되는 칸 지키기 (schema.sql 의 같은 함수에 admin_level 한 줄 추가)
-- 직원이 스스로 '대표'로 바꾸거나 권한(role)을 바꿀 수 없습니다. (권한 변경은 staff_set 함수로만)
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
        new.admin_level := old.admin_level;
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

-- 직원 추가(켜기) / 끄기 : 대표만
--   p_email : 직원 아이디(이메일). 화면의 [직원 아이디 만들기]가 먼저 가입시켜 둡니다.
--   p_name  : 작업 기록에 보일 이름
--   p_on    : true = 직원으로 켜기, false = 끄기
create or replace function public.staff_set(p_email text, p_name text, p_on boolean)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
    v_p  public.profiles;
begin
    if not public.is_owner() then
        raise exception '대표 아이디만 직원을 관리할 수 있습니다.';
    end if;
    select id into v_id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
    if v_id is null then
        raise exception '가입된 아이디를 찾지 못했습니다: %', p_email;
    end if;
    if v_id = auth.uid() then
        raise exception '지금 로그인한 대표 아이디는 바꿀 수 없습니다.';
    end if;
    select * into v_p from public.profiles where id = v_id;
    if v_p.id is null then
        raise exception '이 아이디의 정보가 없습니다. 잠시 후 다시 시도해 주세요.';
    end if;
    if v_p.role = 'admin' and coalesce(v_p.admin_level, 'owner') = 'owner' then
        raise exception '대표 아이디는 직원으로 바꿀 수 없습니다.';
    end if;
    -- 거래처(셀러)가 쓰던 아이디를 실수로 직원으로 바꾸지 않게 막습니다.
    if v_p.admin_level is null and (
        exists (select 1 from public.orders where seller_id = v_id)
        or exists (select 1 from public.pickup_requests where seller_id = v_id)
    ) then
        raise exception '이미 주문·픽업요청을 넣은 거래처 아이디입니다. 직원용 새 이메일로 만들어 주세요.';
    end if;

    if p_on then
        -- 대표가 만든 직원 아이디는 이메일 인증을 따로 안 해도 되게 합니다.
        begin
            update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = v_id;
        exception when others then null;
        end;
        update public.profiles
           set role = 'admin', admin_level = 'staff', status = 'approved',
               name = coalesce(nullif(trim(p_name), ''), name)
         where id = v_id;
    else
        update public.profiles
           set role = 'seller', admin_level = 'staff', status = 'suspended',
               name = coalesce(nullif(trim(p_name), ''), name)
         where id = v_id;
    end if;
    return json_build_object('id', v_id, 'on', p_on);
end;
$$;
revoke all on function public.staff_set(text, text, boolean) from public;
grant execute on function public.staff_set(text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 2. 작업 기록 표
-- ---------------------------------------------------------------------
create table if not exists public.admin_activity (
    id           bigint generated always as identity primary key,
    at           timestamptz not null default now(),
    tx           bigint not null default txid_current(),   -- 한 번에 같이 저장된 작업 묶음 (예: 주문 20건 한 번에 마감)
    actor_id     uuid,
    actor_name   text not null default '',                 -- 작업한 사람 이름 (그때의 이름)
    actor_level  text not null default '',                 -- owner(대표) / staff(직원)
    table_name   text not null,                            -- 어느 표 (orders = 주문 등)
    action       text not null,                            -- insert(추가) / update(수정) / delete(삭제)
    row_key      text,                                     -- 그 줄의 번호(id)
    info         jsonb,                                    -- 어떤 줄인지 알아볼 정보 (업체·받는분·상품 등)
    changes      jsonb                                     -- 수정: {칸: [전, 후]}
);
create index if not exists admin_activity_at_idx on public.admin_activity (at desc);
create index if not exists admin_activity_actor_idx on public.admin_activity (actor_id, at desc);
alter table public.admin_activity enable row level security;

drop policy if exists admin_activity_owner_read on public.admin_activity;
create policy admin_activity_owner_read on public.admin_activity
    for select to authenticated
    using (public.is_owner());
-- 추가/수정/삭제 규칙은 일부러 만들지 않습니다 (아래 자동 기록만 쓸 수 있음).

-- 긴 글은 잘라서 저장 (기록 표가 너무 커지지 않게)
create or replace function public.activity_short(v jsonb)
returns jsonb
language sql
immutable
as $$
    select case
        when v is null or jsonb_typeof(v) = 'null' then 'null'::jsonb
        when jsonb_typeof(v) = 'string' then
            case when length(v #>> '{}') > 150 then to_jsonb(left(v #>> '{}', 150) || '…') else v end
        when jsonb_typeof(v) in ('object', 'array') then
            case when length(v::text) > 150 then to_jsonb(left(v::text, 150) || '…') else v end
        else v
    end;
$$;

-- 어떤 줄인지 알아볼 정보만 골라 담기
create or replace function public.activity_info(r jsonb)
returns jsonb
language sql
immutable
as $$
    select coalesce(jsonb_object_agg(k, public.activity_short(r -> k)), '{}'::jsonb)
    from unnest(array[
        'seller_company', 'company', 'recipient', 'product', 'order_no', 'item_no', 'status', 'ship_status',
        'store_name', 'store_location', 'wholesale_company', 'wholesale_product', 'retail_product',
        'color', 'size', 'quantity', 'code', 'settle_date', 'ship_date', 'day', 'name', 'email',
        'order_id', 'product_id', 'qty', 'qty_a', 'qty_b', 'qty_defect', 'question', 'alias'
    ]) as k
    where r ? k and jsonb_typeof(r -> k) <> 'null' and coalesce(r ->> k, '') <> '';
$$;

-- 자동 기록 (관리자 아이디가 바꾼 것만)
create or replace function public.log_admin_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid     uuid;
    v_prof    public.profiles;
    v_old     jsonb;
    v_new     jsonb;
    v_row     jsonb;
    v_changes jsonb := '{}'::jsonb;
    k         text;
begin
    begin
        v_uid := auth.uid();
        if v_uid is null then return null; end if;
        select * into v_prof from public.profiles where id = v_uid;
        if v_prof.id is null or v_prof.role is distinct from 'admin' then return null; end if;

        if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
        if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
        if tg_op = 'UPDATE' then
            for k in select jsonb_object_keys(v_new) loop
                if k in ('updated_at', 'updated_by') then continue; end if;
                if (v_new -> k) is distinct from (v_old -> k) then
                    v_changes := v_changes || jsonb_build_object(k,
                        jsonb_build_array(public.activity_short(v_old -> k), public.activity_short(v_new -> k)));
                end if;
            end loop;
            if v_changes = '{}'::jsonb then return null; end if;   -- 실제로 바뀐 칸이 없으면 안 적음
        end if;
        v_row := coalesce(v_new, v_old);

        insert into public.admin_activity (actor_id, actor_name, actor_level, table_name, action, row_key, info, changes)
        values (
            v_uid,
            coalesce(nullif(trim(v_prof.name), ''), v_prof.email, ''),
            coalesce(v_prof.admin_level, 'owner'),
            tg_table_name,
            lower(tg_op),
            coalesce(v_row ->> 'id', v_row ->> 'order_id', v_row ->> 'product_id', v_row ->> 'company_key', v_row ->> 'day'),
            public.activity_info(v_row),
            nullif(v_changes, '{}'::jsonb)
        );

        -- 가끔(약 2천 번에 한 번) 400일 지난 기록 정리
        if random() < 0.0005 then
            delete from public.admin_activity where at < now() - interval '400 days';
        end if;
    exception when others then
        null;   -- 기록에 실패해도 원래 작업은 그대로 진행
    end;
    return null;
end;
$$;

-- 기록할 표에 자동 기록 연결 (아직 안 만든 표는 건너뜀)
do $$
declare
    t text;
begin
    foreach t in array array[
        'orders', 'pickup_requests', 'quick_orders', 'admin_hidden_orders', 'admin_separate_orders',
        'shipments', 'settlements', 'settle_contacts', 'couriers',
        'stock_items', 'stock_visibility', 'products', 'product_aliases', 'inventory', 'inventory_days',
        'order_stock_picks', 'profiles', 'inquiries', 'ai_faq'
    ] loop
        if to_regclass('public.' || t) is not null then
            execute format('drop trigger if exists zz_admin_activity on public.%I', t);
            execute format('create trigger zz_admin_activity after insert or update or delete on public.%I
                            for each row execute function public.log_admin_activity()', t);
        end if;
    end loop;
end;
$$;

notify pgrst, 'reload schema';

-- 결과 확인: 대표 아이디 목록이 나오면 정상입니다.
select email, name, admin_level as 구분 from public.profiles where role = 'admin' order by created_at;
