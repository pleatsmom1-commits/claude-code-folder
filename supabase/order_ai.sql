-- =====================================================================
-- 셀러 쇼핑몰 주문서 AI 분석 (재고관리 v2 5단계)
--  - order_file_formats : 한 번 AI 가 알아낸 "이 주문서는 몇 번째 칸이 받는분/주소/상품…" 정보를 저장
--                         → 같은 모양의 주문서는 다음부터 AI 없이 바로 읽음 (비용 0)
--  - ai_usage           : AI 를 부를 때마다 사용량·비용 기록 (관리자 'AI 사용료' 화면)
--  - 여러 번 실행해도 안전합니다. schema.sql, stock.sql 다음에 실행하세요.
-- =====================================================================

create table if not exists public.order_file_formats (
    id            bigint generated always as identity primary key,
    company       text not null,                 -- norm_company(셀러 상호)
    signature     text not null,                 -- 제목줄 모양 (같은 쇼핑몰 양식이면 같음)
    platform      text not null default '',      -- AI 가 추정한 쇼핑몰 이름
    mapping       jsonb not null,                -- { header_row, columns: { recipient: 3, ... } }
    use_count     integer not null default 0,
    created_at    timestamptz not null default now(),
    created_by    uuid default auth.uid(),
    last_used_at  timestamptz not null default now()
);
create unique index if not exists order_file_formats_key on public.order_file_formats (company, signature);

create table if not exists public.ai_usage (
    id             bigint generated always as identity primary key,
    created_at     timestamptz not null default now(),
    user_id        uuid not null default auth.uid(),
    company        text not null default '',
    kind           text not null default 'order_file',   -- 어떤 기능에서 썼는지
    model          text not null default '',
    input_tokens   integer not null default 0,
    output_tokens  integer not null default 0,
    cost_usd       numeric(10, 5) not null default 0,
    note           text not null default ''
);
create index if not exists ai_usage_created_idx on public.ai_usage (created_at desc);

alter table public.order_file_formats enable row level security;
alter table public.ai_usage enable row level security;

-- 저장된 양식: 같은 상호의 승인된 셀러끼리만 보고 씀, 관리자는 전부 (잘못 읽힌 양식은 관리자가 지움)
drop policy if exists order_file_formats_select on public.order_file_formats;
create policy order_file_formats_select on public.order_file_formats
    for select to authenticated
    using (public.is_admin() or company = public.my_stock_company());

drop policy if exists order_file_formats_insert on public.order_file_formats;
create policy order_file_formats_insert on public.order_file_formats
    for insert to authenticated
    with check (company = public.my_stock_company());

drop policy if exists order_file_formats_update on public.order_file_formats;
create policy order_file_formats_update on public.order_file_formats
    for update to authenticated
    using (public.is_admin() or company = public.my_stock_company())
    with check (public.is_admin() or company = public.my_stock_company());

drop policy if exists order_file_formats_delete on public.order_file_formats;
create policy order_file_formats_delete on public.order_file_formats
    for delete to authenticated
    using (public.is_admin() or company = public.my_stock_company());

-- 사용 기록: 본인 기록만 남길 수 있고, 보는 건 본인 + 관리자
drop policy if exists ai_usage_insert on public.ai_usage;
create policy ai_usage_insert on public.ai_usage
    for insert to authenticated
    with check (user_id = auth.uid());

drop policy if exists ai_usage_select on public.ai_usage;
create policy ai_usage_select on public.ai_usage
    for select to authenticated
    using (public.is_admin() or user_id = auth.uid());

grant select, insert, update, delete on public.order_file_formats to authenticated;
grant select, insert on public.ai_usage to authenticated;
revoke update, delete on public.ai_usage from authenticated, anon;
