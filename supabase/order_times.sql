-- =====================================================================
-- 밤낮딜리버리 - 주문관리·사입픽업요청에 '셀러 접수 시각'과 '관리자 처리 시각'을 같이 남기기 (2026-11-11)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요. (여러 번 실행해도 안전합니다)
-- (schema.sql, pickup.sql, quick_orders.sql, quick_orders_transfer.sql 을 먼저 실행한 상태여야 합니다.)
--  - origin_created_at : 비회원 간단 접수에서 넘어온 건은 손님이 처음 접수한 시각 (다른 건은 비어 있음 = created_at 이 셀러 접수 시각)
--  - accepted_at       : 주문이 [접수완료]가 된 시각 (관리자 접수). 접수대기로 되돌리면 지워집니다.
--  - handled_at        : 픽업요청이 '접수'에서 확인/완료/취소로 바뀐 시각 (관리자 처리). '접수'로 되돌리면 지워집니다.
--  이 시각들은 DB 가 자동으로 적습니다. 셀러는 바꿀 수 없습니다. (이 SQL 실행 전에 처리된 건은 처리 시각이 비어 있습니다)
-- =====================================================================

alter table public.orders add column if not exists origin_created_at timestamptz;
alter table public.orders add column if not exists accepted_at timestamptz;
alter table public.pickup_requests add column if not exists origin_created_at timestamptz;
alter table public.pickup_requests add column if not exists handled_at timestamptz;

-- 주문: 접수완료가 된 시각 자동 기록 (orders_enforce_owner 다음에 실행되도록 이름을 zz 로 시작)
create or replace function public.orders_track_accepted_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_privileged boolean := public.is_admin() or auth.uid() is null;
begin
    if tg_op = 'INSERT' then
        if not v_privileged then new.origin_created_at := null; end if;
        new.accepted_at := case when new.status = '접수완료' then now() else null end;
        return new;
    end if;
    if not v_privileged then new.origin_created_at := old.origin_created_at; end if;
    if new.status is distinct from old.status then
        new.accepted_at := case when new.status = '접수완료' then now() else null end;
    else
        new.accepted_at := old.accepted_at;
    end if;
    return new;
end;
$$;
drop trigger if exists orders_zz_track_accepted_at on public.orders;
create trigger orders_zz_track_accepted_at
    before insert or update on public.orders
    for each row execute function public.orders_track_accepted_at();

-- 픽업요청: '접수'에서 다른 상태로 바뀐 시각 자동 기록
create or replace function public.pickup_track_handled_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_privileged boolean := public.is_admin() or auth.uid() is null;
begin
    if tg_op = 'INSERT' then
        if not v_privileged then new.origin_created_at := null; end if;
        new.handled_at := case when new.status = '접수' then null else now() end;
        return new;
    end if;
    if not v_privileged then new.origin_created_at := old.origin_created_at; end if;
    if new.status is distinct from old.status then
        new.handled_at := case when new.status = '접수' then null else now() end;
    else
        new.handled_at := old.handled_at;
    end if;
    return new;
end;
$$;
drop trigger if exists pickup_zz_track_handled_at on public.pickup_requests;
create trigger pickup_zz_track_handled_at
    before insert or update on public.pickup_requests
    for each row execute function public.pickup_track_handled_at();

-- 이미 비회원 간단 접수에서 넘어온 건: 손님이 처음 접수한 시각 채우기 (메모의 '비회원 간단접수 #번호'로 찾음)
update public.orders o
   set origin_created_at = q.created_at
  from public.quick_orders q
 where o.origin_created_at is null
   and o.bamnat_memo = '비회원 간단접수 #' || q.id;
update public.pickup_requests p
   set origin_created_at = q.created_at
  from public.quick_orders q
 where p.origin_created_at is null
   and p.memo ~ ('^비회원 간단접수 #' || q.id || '($|\n)');

-- 간단 접수를 넘길 때 손님이 처음 접수한 시각도 같이 넘기도록 함수 다시 만들기
create or replace function public.transfer_quick_order(p_id bigint, p_store_type text default 'store_post')
returns table (pickups integer, orders integer)
language plpgsql
security definer
set search_path = public
as $$
declare
    q public.quick_orders%rowtype;
    s jsonb;
    r jsonb;
    v_type text;
    v_kst timestamp := (now() at time zone 'Asia/Seoul');
    v_prefix text;
    v_phone text;
    v_p integer := 0;
    v_o integer := 0;
    v_note text;
begin
    if not public.is_admin() then
        raise exception '관리자만 할 수 있습니다.' using errcode = '42501';
    end if;
    if p_store_type not in ('store_post', 'store_sameday') then
        raise exception '매장배송 방법(우체국/당일)을 골라 주세요.';
    end if;

    select * into q from public.quick_orders where id = p_id for update;
    if not found then raise exception '간단 접수를 찾을 수 없습니다.'; end if;
    if q.transferred_at is not null then
        raise exception '이미 주문관리로 옮긴 접수입니다. (%)', to_char(q.transferred_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI');
    end if;
    if q.status = 'canceled' then raise exception '취소된 접수는 옮길 수 없습니다.'; end if;

    v_note := '비회원 간단접수 #' || q.id;
    v_type := case when q.ship_to = 'customer' then 'fulfillment' else p_store_type end;
    v_prefix := case v_type when 'fulfillment' then 'ORD' when 'store_post' then 'ORD-POST' else 'ORD-DAY' end;

    -- 1) 픽업할 매장마다 픽업요청
    for s in select * from jsonb_array_elements(q.stores) loop
        insert into public.pickup_requests
            (seller_id, seller_company, orderer_name, orderer_phone, store_name, store_location, store_phone,
             prepay, prepay_misong, agreed, memo, status, origin_created_at)
        values
            (auth.uid(), q.company, q.company, q.phone,
             coalesce(nullif(trim(s->>'store'), ''), '(매장명 없음)'),
             coalesce(nullif(trim(concat_ws(' ', s->>'mall', s->>'floor')), ''), '(위치 없음)'),
             nullif(trim(s->>'phone'), ''),
             q.prepay, q.prepay_misong, (q.prepay or q.prepay_misong),
             v_note || coalesce(nullif(E'\n' || trim(coalesce(q.memo, '')), E'\n'), ''),
             '접수', q.created_at);
        v_p := v_p + 1;
    end loop;

    -- 2) 받으실 분마다 주문
    for r in select * from jsonb_array_elements(q.recipients) loop
        v_phone := regexp_replace(coalesce(r->>'phone', ''), '[^0-9]', '', 'g');
        v_phone := case
            when length(v_phone) = 11 then substr(v_phone, 1, 3) || '-' || substr(v_phone, 4, 4) || '-' || substr(v_phone, 8)
            when length(v_phone) = 10 and v_phone like '02%' then '02-' || substr(v_phone, 3, 4) || '-' || substr(v_phone, 7)
            when length(v_phone) = 10 then substr(v_phone, 1, 3) || '-' || substr(v_phone, 4, 3) || '-' || substr(v_phone, 7)
            else coalesce(nullif(trim(r->>'phone'), ''), '-') end;
        insert into public.orders
            (id, order_type, seller_id, seller_company, sender_name, cs_phone, recipient, phone,
             zipcode, address, detail_address, product, memo, bamnat_memo, qty, status, origin_created_at)
        values
            (v_prefix || '-' || to_char(v_kst, 'YYYYMMDD-HH24MISS') || '-'
                 || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4)),
             v_type, null, q.company,
             case when v_type = 'fulfillment' then '밤낮딜리버리(' || q.company || ')' else '밤낮딜리버리' end,
             case when v_type = 'fulfillment'
                  then substr(q.phone, 1, 3) || '-' || substr(q.phone, 4, length(q.phone) - 7) || '-' || right(q.phone, 4)
                  else '010-5425-9060' end,
             coalesce(nullif(trim(r->>'name'), ''), q.company), v_phone,
             null, coalesce(nullif(trim(r->>'address'), ''), '-'), null,
             coalesce(trim(r->>'product'), ''),
             nullif(trim(coalesce(r->>'message', '')), ''),
             v_note, 1, '접수대기', q.created_at);
        v_o := v_o + 1;
    end loop;

    update public.quick_orders
       set status = 'done', handled_at = coalesce(handled_at, now()), transferred_at = now()
     where id = q.id;

    return query select v_p, v_o;
end;
$$;

revoke all on function public.transfer_quick_order(bigint, text) from public;
grant execute on function public.transfer_quick_order(bigint, text) to authenticated;

notify pgrst, 'reload schema';
