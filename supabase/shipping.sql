-- =====================================================================
-- 밤낮딜리버리 - 업체별 운송장 전송 (2026-10-28)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
-- (schema.sql 을 먼저 실행한 상태여야 합니다. 여러 번 실행해도 안전합니다.)
--  - 관리자 [운송장 전송] 탭에서 송장 엑셀을 올리면 업체(상호)·출고일별로 한 줄씩 저장됩니다.
--  - 업체에게는 링크(/ship?t=...)로 자기 운송장 목록만 보여줍니다.
-- =====================================================================
create table if not exists public.shipments (
    id              bigint generated always as identity primary key,
    token           text not null unique,
    company         text not null,
    ship_date       date not null,
    items           jsonb not null,      -- [{recipient, tracking, state(출고/부분출고/미출고), product, fee, store}]
    parcel_count    integer not null default 0,   -- 출고건수 = 서로 다른 송장번호 개수
    unshipped_count integer not null default 0,   -- 미출고 상품 수
    extra_fee       numeric not null default 0,   -- 부피추가비용 합계
    sent_at         timestamptz,          -- 마지막 발송 시각
    send_status     text,
    send_error      text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    unique (company, ship_date)
);
create index if not exists shipments_date_idx on public.shipments (ship_date);
alter table public.shipments enable row level security;

drop policy if exists shipments_admin on public.shipments;
create policy shipments_admin on public.shipments
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- 업체가 링크로 자기 운송장 1건만 볼 수 있게 하는 함수 (로그인 없이, 정확한 token 을 알아야만 나옴)
create or replace function public.get_shipment(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'company', s.company,
        'ship_date', s.ship_date,
        'items', s.items,
        'parcel_count', s.parcel_count,
        'unshipped_count', s.unshipped_count,
        'extra_fee', s.extra_fee,
        'updated_at', s.updated_at
    )
    from public.shipments s
    where length(coalesce(p_token, '')) >= 24
      and s.token = p_token;
$$;
revoke all on function public.get_shipment(text) from public;
grant execute on function public.get_shipment(text) to anon, authenticated;

notify pgrst, 'reload schema';
