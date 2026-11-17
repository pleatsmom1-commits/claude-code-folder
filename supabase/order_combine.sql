-- =====================================================================
-- 밤낮딜리버리 - 관리자 주문관리: 합배송 묶기 / 부분출고(따로 출고)로 풀기 (2026-11-16)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요. (여러 번 실행해도 안전합니다)
-- (schema.sql 을 먼저 실행한 상태여야 합니다.)
--  - 합배송 묶기: 체크한 상품들을 같은 주문 번호(예: 158-1, 158-2)로 묶고 상품명 앞에 (합)을 붙입니다.
--                 셀러가 엑셀에 (합)을 적어 올렸을 때와 똑같은 모양이 됩니다.
--  - 부분출고로 풀기: 체크한 상품의 (합)을 떼고 각자 자기 주문 번호를 받아, 준비된 것부터 따로 출고되게 합니다.
--  - 관리자만 쓸 수 있습니다. 출고완료된 상품은 바꾸지 않습니다.
-- =====================================================================

-- 1) 주문 번호 잠금에 "관리자 합배송 함수가 바꿀 때만" 예외를 둡니다. (schema.sql 과 같은 내용)
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
        -- 예외: 관리자 합배송 묶기/부분출고로 풀기 함수(order_combine.sql)가 번호를 다시 정할 때
        if (old.order_no is not null and coalesce(current_setting('bamnat.renumber', true), '') <> 'on') or not v_privileged then
            new.order_no := old.order_no;
            new.item_no := old.item_no;
        end if;
        if (old.seller_order_no is not null and coalesce(current_setting('bamnat.renumber', true), '') <> 'on') or not v_privileged then
            new.seller_order_no := old.seller_order_no;
        end if;
        if not v_privileged then
            new.order_type := old.order_type;
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


-- 2) 합배송 묶기 / 부분출고로 풀기
--    p_mode = 'combine' (합배송으로 묶기) 또는 'split' (부분출고 = 따로 출고로 풀기)
create or replace function public.admin_set_combined(p_ids text[], p_mode text)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ids text[];
    v_cnt integer;
    v_sellers integer;
    v_target bigint;
    v_target_seller_no integer;
    v_next integer;
    v_groups bigint[];
    v_new bigint;
    g bigint;
    r record;
begin
    if not public.is_admin() then
        raise exception '관리자만 할 수 있습니다.' using errcode = '42501';
    end if;
    if p_mode not in ('combine', 'split') then
        raise exception '잘못된 요청입니다.' using errcode = '22023';
    end if;

    select array_agg(distinct x) into v_ids from unnest(coalesce(p_ids, '{}')) x where x is not null;
    select count(*), count(distinct seller_id) into v_cnt, v_sellers
    from public.orders where id = any(coalesce(v_ids, '{}'));
    if v_cnt = 0 then
        raise exception '선택한 주문을 찾을 수 없습니다.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.orders where id = any(v_ids) and order_type = 'keep') then
        raise exception '사무실 보관요청 건은 합배송/부분출고로 바꿀 수 없습니다.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.orders where id = any(v_ids) and ship_status = '출고완료') then
        raise exception '이미 출고완료된 상품이 있어 바꿀 수 없습니다.' using errcode = 'P0001';
    end if;

    -- 바뀌기 전 주문 번호들 (나중에 남은 상품 번호를 1, 2, 3 으로 다시 매김)
    select array_agg(distinct order_no) into v_groups
    from public.orders where id = any(v_ids) and order_no is not null;

    perform set_config('bamnat.renumber', 'on', true);

    if p_mode = 'combine' then
        if v_cnt < 2 then
            raise exception '합배송은 2개 이상 선택해야 합니다.' using errcode = 'P0001';
        end if;
        if v_sellers > 1 then
            raise exception '다른 업체(셀러)의 주문끼리는 합배송으로 묶을 수 없습니다.' using errcode = 'P0001';
        end if;

        -- 가장 먼저 접수된(번호가 작은) 주문 번호로 모읍니다.
        select order_no, seller_order_no into v_target, v_target_seller_no
        from public.orders where id = any(v_ids) and order_no is not null
        order by order_no, item_no limit 1;
        if v_target is null then
            v_target := nextval('public.orders_order_no_seq');
        end if;
        select coalesce(max(item_no), 0) into v_next from public.orders where order_no = v_target;

        for r in select id from public.orders
                 where id = any(v_ids) and order_no is distinct from v_target
                 order by order_no nulls last, item_no, created_at, id loop
            v_next := v_next + 1;
            update public.orders
               set order_no = v_target, item_no = v_next,
                   seller_order_no = coalesce(v_target_seller_no, seller_order_no)
             where id = r.id;
        end loop;

        -- 묶인 주문의 상품명 앞에 (합) 표시
        update public.orders
           set product = '(합)' || coalesce(product, '')
         where order_no = v_target and coalesce(product, '') not like '%(합)%';
    else
        -- (합) 표시 떼기
        update public.orders
           set product = trim(regexp_replace(product, '\(합\)\s*', '', 'g'))
         where id = any(v_ids) and product like '%(합)%';

        -- 같은 주문 번호에 묶여 있던 상품은 각자 새 번호를 받습니다.
        -- (그 주문의 상품을 모두 골랐다면 첫 번째 상품은 원래 번호를 그대로 씁니다.)
        foreach g in array coalesce(v_groups, '{}') loop
            for r in select o.id, o.seller_id from public.orders o
                     where o.order_no = g and o.id = any(v_ids)
                       and (exists (select 1 from public.orders x where x.order_no = g and not (x.id = any(v_ids)))
                            or o.item_no > (select min(y.item_no) from public.orders y where y.order_no = g))
                     order by o.item_no, o.id loop
                v_new := nextval('public.orders_order_no_seq');
                update public.orders
                   set order_no = v_new, item_no = 1,
                       seller_order_no = public.orders_pick_seller_no(r.seller_id, v_new, r.id)
                 where id = r.id;
            end loop;
        end loop;
    end if;

    -- 상품이 빠져나간 주문은 남은 상품 번호를 1, 2, 3 ... 으로 다시 매깁니다.
    foreach g in array coalesce(v_groups, '{}') loop
        update public.orders o
           set item_no = s.rn
          from (select id, row_number() over (order by item_no, created_at, id) as rn
                from public.orders where order_no = g) s
         where o.id = s.id and o.item_no is distinct from s.rn;
    end loop;

    perform set_config('bamnat.renumber', '', true);

    return query
        select * from public.orders
        where id = any(v_ids)
           or order_no = any(coalesce(v_groups, '{}'))
           or (p_mode = 'combine' and order_no = v_target);
end;
$$;

revoke all on function public.admin_set_combined(text[], text) from public, anon;
grant execute on function public.admin_set_combined(text[], text) to authenticated;

notify pgrst, 'reload schema';
