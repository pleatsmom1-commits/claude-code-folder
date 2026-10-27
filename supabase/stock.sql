-- =====================================================================
-- 밤낮딜리버리 - 거래처 재고관리 (관리자 [재고관리] 탭, 셀러 [재고 확인] 화면)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
-- (schema.sql 을 먼저 실행한 상태여야 합니다. 여러 번 실행해도 안전합니다.)
--
--  - stock_items : 거래처 재고표(통합본) 엑셀의 한 줄 = 한 행
--    company 는 재고표의 거래처명(탭 이름) 그대로 저장합니다. 회원가입 여부와 상관없이 등록할 수 있고,
--    회원가입 상호와 같으면(띄어쓰기·영문 대소문자 무시) 그 셀러가 로그인해서 자기 재고를 봅니다.
--  - shipped_on(재고출고일)과 shipped_note(출고 메모)가 둘 다 비어 있으면 '보관중', 하나라도 있으면 '출고됨' 입니다.
-- =====================================================================

-- 상호명 비교 기준: 띄어쓰기 제거 + 영문 소문자 (company_unique.sql 과 같은 함수)
create or replace function public.norm_company(v text)
returns text
language sql
immutable
as $$
    select lower(regexp_replace(coalesce(v, ''), '\s', '', 'g'));
$$;

create table if not exists public.stock_items (
    id                 bigint generated always as identity primary key,
    company            text not null,               -- 거래처명
    wholesale_company  text not null default '',    -- 도매업체명
    wholesale_product  text not null default '',    -- 도매상품명
    retail_product     text not null default '',    -- 소매상품명
    color              text not null default '',    -- 컬러
    size               text not null default '',    -- 사이즈
    quantity           numeric not null default 1,  -- 수량
    location           text not null default '',    -- 재고위치
    stocked_on         date,                        -- 재고생성일
    shipped_on         date,                        -- 재고출고일
    shipped_note       text not null default '',    -- 재고출고일 칸의 글 (예: '재고출고', '11/5매장반품')
    customer           text not null default '',    -- 기타(반품고객명)
    label              text not null default '',    -- 라벨(작업) 표시
    memo               text not null default '',
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);
alter table public.stock_items add column if not exists shipped_note text not null default '';
create index if not exists stock_items_company_idx on public.stock_items (public.norm_company(company));
create index if not exists stock_items_shipped_idx on public.stock_items (shipped_on);

create or replace function public.stock_items_touch()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end $$;

drop trigger if exists stock_items_touch on public.stock_items;
create trigger stock_items_touch before update on public.stock_items
    for each row execute function public.stock_items_touch();

-- ---------------------------------------------------------------------
-- 권한: 관리자는 전부, 승인된 셀러는 자기 상호의 재고를 보기만
-- ---------------------------------------------------------------------
create or replace function public.my_stock_company()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select public.norm_company(company) from public.profiles
    where id = auth.uid() and status = 'approved';
$$;

alter table public.stock_items enable row level security;

drop policy if exists stock_items_admin on public.stock_items;
create policy stock_items_admin on public.stock_items
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

drop policy if exists stock_items_seller_select on public.stock_items;
create policy stock_items_seller_select on public.stock_items
    for select to authenticated
    using (public.norm_company(company) = public.my_stock_company());

grant select, insert, update, delete on public.stock_items to authenticated;

notify pgrst, 'reload schema';
