-- =====================================================================
-- 밤낮딜리버리 - 비회원 간단 접수 → 픽업요청·주문관리로 자동 옮기기 (2026-11-08)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요. (여러 번 실행해도 안전합니다)
-- (schema.sql, pickup.sql, quick_orders.sql 을 먼저 실행한 상태여야 합니다.)
--  관리자가 간단 접수에서 [접수완료 + 주문관리로 옮기기]를 누르면 한 번에:
--   1) 픽업할 매장마다 → 사입 픽업요청 1건 (상태 '접수')
--   2) 받으실 분마다   → 주문관리 주문 1건 (상태 '접수대기')
--      고객에게 바로 = 고객풀필먼트 / 내 매장·사무실 = 매장배송(우체국택배 또는 당일배송, 관리자가 고름)
--   3) 간단 접수는 '접수완료'로 바뀌고, 옮긴 시각이 남아 두 번 옮겨지지 않습니다.
-- =====================================================================

alter table public.quick_orders add column if not exists transferred_at timestamptz;

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
             prepay, prepay_misong, agreed, memo, status)
        values
            (auth.uid(), q.company, q.company, q.phone,
             coalesce(nullif(trim(s->>'store'), ''), '(매장명 없음)'),
             coalesce(nullif(trim(concat_ws(' ', s->>'mall', s->>'floor')), ''), '(위치 없음)'),
             nullif(trim(s->>'phone'), ''),
             q.prepay, q.prepay_misong, (q.prepay or q.prepay_misong),
             v_note || coalesce(nullif(E'\n' || trim(coalesce(q.memo, '')), E'\n'), ''),
             '접수');
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
             zipcode, address, detail_address, product, memo, bamnat_memo, qty, status)
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
             v_note, 1, '접수대기');
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
