-- =====================================================================
-- 밤낮딜리버리 - 비회원 간단 주문접수 (2026-11-07)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요. (여러 번 실행해도 안전합니다)
-- (schema.sql 을 먼저 실행한 상태여야 합니다. is_admin() 함수를 씁니다.)
--  - quick_orders : 회원가입 없이 /quick 화면에서 남긴 첫 주문 (픽업할 매장 + 받는 분)
--    손님은 표를 볼 수 없고 submit_quick_order 함수로 1건 남기기만 합니다. 관리자만 보고 처리합니다.
-- =====================================================================

create table if not exists public.quick_orders (
    id              bigint generated always as identity primary key,
    created_at      timestamptz not null default now(),
    company         text not null,          -- 주문자 상호 / 쇼핑몰명
    phone           text not null,          -- 주문자 연락처 (숫자만)
    stores          jsonb not null,         -- 픽업할 매장 [{mall, store, floor, phone}]
    prepay          boolean not null,       -- true: 대납하고 픽업
    prepay_misong   boolean not null,       -- true: 재고 없으면 대납미송 잡음
    ship_to         text not null,          -- 'store': 내 매장·사무실로 / 'customer': 고객에게 바로 (풀필먼트)
    recipients      jsonb not null,         -- 받는 분 [{name, phone, address, product, message}]
    memo            text,
    source          text,
    status          text not null default 'waiting',   -- waiting: 확인 대기, done: 접수완료, canceled: 취소
    admin_memo      text,
    handled_at      timestamptz
);
create index if not exists quick_orders_created_idx on public.quick_orders (created_at desc);
create index if not exists quick_orders_phone_idx on public.quick_orders (phone);
alter table public.quick_orders enable row level security;

drop policy if exists quick_orders_admin on public.quick_orders;
create policy quick_orders_admin on public.quick_orders
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- 손님(로그인 안 한 사람)이 간단 주문 1건을 남기는 함수. 같은 번호로 몇 번째 접수인지 돌려줍니다.
create or replace function public.submit_quick_order(
    p_company text, p_phone text, p_stores jsonb, p_prepay boolean, p_prepay_misong boolean,
    p_ship_to text, p_recipients jsonb, p_memo text, p_source text)
returns table (id bigint, nth integer)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
    v_id bigint;
    v_nth integer;
begin
    if length(trim(coalesce(p_company, ''))) = 0 then raise exception '상호를 적어 주세요.'; end if;
    if v_phone !~ '^01[0-9]{8,9}$' then raise exception '휴대폰 번호를 확인해 주세요.'; end if;
    if p_stores is null or jsonb_typeof(p_stores) <> 'array' or jsonb_array_length(p_stores) = 0
       or jsonb_array_length(p_stores) > 20 then raise exception '픽업할 매장을 적어 주세요.'; end if;
    if p_recipients is null or jsonb_typeof(p_recipients) <> 'array' or jsonb_array_length(p_recipients) = 0
       or jsonb_array_length(p_recipients) > 50 then raise exception '받는 분 정보를 적어 주세요.'; end if;
    if p_ship_to not in ('store', 'customer') then raise exception '받는 곳을 골라 주세요.'; end if;
    if length(p_stores::text) + length(p_recipients::text) > 40000 then raise exception '내용이 너무 깁니다.'; end if;
    -- 같은 번호로 1시간에 5건까지만 (장난 방지)
    if (select count(*) from public.quick_orders q where q.phone = v_phone and q.created_at > now() - interval '1 hour') >= 5 then
        raise exception '잠시 후 다시 접수해 주세요.';
    end if;
    -- 개인정보 보관 기간: 접수 후 1년이 지난 기록은 지웁니다.
    delete from public.quick_orders q where q.created_at < now() - interval '1 year';

    insert into public.quick_orders (company, phone, stores, prepay, prepay_misong, ship_to, recipients, memo, source)
    values (left(trim(p_company), 100), v_phone, p_stores, coalesce(p_prepay, false), coalesce(p_prepay_misong, false),
            p_ship_to, p_recipients, left(trim(coalesce(p_memo, '')), 1000), left(p_source, 300))
    returning quick_orders.id into v_id;

    select count(*) into v_nth from public.quick_orders q where q.phone = v_phone;
    return query select v_id, v_nth;
end;
$$;

revoke all on function public.submit_quick_order(text, text, jsonb, boolean, boolean, text, jsonb, text, text) from public;
grant execute on function public.submit_quick_order(text, text, jsonb, boolean, boolean, text, jsonb, text, text) to anon, authenticated;
