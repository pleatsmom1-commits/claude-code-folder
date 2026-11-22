-- =====================================================================
-- 밤낮딜리버리 - 택배 업체용 "내 택배 주문" (2026-11-20)
--  풀필먼트를 이용하지 않고 직접 택배를 보내는 업체가
--   ① 쇼핑몰 주문서를 올려 '내 택배 주문 목록'에 모으고
--   ② 자기 운송장 프로그램 엑셀 양식(칸 순서)을 등록해 두면
--   ③ 그 양식 그대로 운송장 엑셀을 내려받습니다.
--  밤낮딜리버리 주문관리(orders)와 완전히 따로입니다. 관리자도 볼 수 없습니다 (손님 개인정보 최소화).
--  손님 정보(받는분·연락처·주소)는 90일이 지나면 저절로 지워집니다.
--  Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요. (여러 번 실행해도 안전합니다.)
-- =====================================================================

-- 1. 내 택배 주문 목록 (업체 계정 본인 것만)
create table if not exists public.seller_ship_orders (
    id           bigint generated always as identity primary key,
    seller_id    uuid not null default auth.uid(),
    company      text not null default '',
    ship_date    date not null default (now() at time zone 'Asia/Seoul')::date,  -- 보낼 날짜 (주문서 올린 날)
    source_file  text not null default '',
    platform     text not null default '',
    order_no     text not null default '',
    recipient    text not null default '',
    phone        text not null default '',
    phone2       text not null default '',
    zipcode      text not null default '',
    address      text not null default '',     -- 기본주소
    address_detail text not null default '',   -- 상세주소 (주문서에 따로 있을 때)
    product      text not null default '',     -- 쇼핑몰 상품명
    option       text not null default '',
    qty          integer not null default 1,
    memo         text not null default '',     -- 배송메세지
    tracking_no  text not null default '',
    downloaded_at timestamptz,                 -- 운송장 엑셀로 받은 때
    created_at   timestamptz not null default now()
);
create index if not exists seller_ship_orders_seller_idx on public.seller_ship_orders (seller_id, ship_date desc, id);
create index if not exists seller_ship_orders_created_idx on public.seller_ship_orders (created_at);

-- 2. 내 운송장 양식 (운송장 프로그램 엑셀의 칸 제목 순서 + 칸마다 넣을 값)
--  columns: [{"title": "수하인명", "field": "recipient"}, {"title": "운임구분", "field": "fixed", "value": "선불"}, ...]
create table if not exists public.seller_ship_templates (
    id          bigint generated always as identity primary key,
    seller_id   uuid not null default auth.uid(),
    name        text not null default '',     -- 예: CJ대한통운
    file_name   text not null default '',
    sheet_name  text not null default '',
    header_row  integer not null default 0,   -- 양식에서 칸 제목이 있는 줄 (0부터)
    columns     jsonb not null default '[]'::jsonb,
    sender      jsonb not null default '{}'::jsonb,  -- 보내는분 이름·연락처·주소 (한 번 적어 두는 값)
    is_default  boolean not null default false,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index if not exists seller_ship_templates_seller_idx on public.seller_ship_templates (seller_id);

-- 3. 보기·쓰기: 업체 본인(승인된 셀러) 것만. 관리자도 못 봄
alter table public.seller_ship_orders enable row level security;
alter table public.seller_ship_templates enable row level security;

drop policy if exists seller_ship_orders_own on public.seller_ship_orders;
create policy seller_ship_orders_own on public.seller_ship_orders
    for all to authenticated
    using (seller_id = auth.uid())
    with check (seller_id = auth.uid() and public.my_stock_company() is not null);

drop policy if exists seller_ship_templates_own on public.seller_ship_templates;
create policy seller_ship_templates_own on public.seller_ship_templates
    for all to authenticated
    using (seller_id = auth.uid())
    with check (seller_id = auth.uid() and public.my_stock_company() is not null);

-- 4. 90일 지난 주문 지우기 (손님 개인정보 보관 기간)
--  '내 택배 주문' 화면을 열 때마다, 그리고 사이트 자동 깨우기(2일마다)에서 불러 지웁니다.
create or replace function public.ship_orders_purge()
returns integer
language sql
security definer
set search_path = public
as $$
    with gone as (
        delete from public.seller_ship_orders where created_at < now() - interval '90 days' returning 1
    )
    select count(*)::integer from gone;
$$;
revoke all on function public.ship_orders_purge() from public;
grant execute on function public.ship_orders_purge() to anon, authenticated;
