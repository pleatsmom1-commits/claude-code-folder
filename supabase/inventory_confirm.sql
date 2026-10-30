-- =====================================================================
-- 밤낮딜리버리 - 재고 확정 (재고관리 3단계)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
-- (inventory.sql 을 먼저 실행한 상태여야 합니다. 여러 번 실행해도 안전합니다.)
--
--  - inventory_days      : 날짜(한국 시간)마다 재고를 확정한 시각. 관리자가 [재고정리완료]를 누르거나,
--                          오후 7시가 지나면 누가 화면을 열 때 자동으로 확정됩니다.
--  - inventory_snapshots : 확정할 때의 재고 수량 사진 (날짜별 최종재고). 다시 확정하면 그날 사진을 새로 찍습니다.
-- =====================================================================

create table if not exists public.inventory_days (
    day           date primary key,             -- 한국 날짜
    confirmed_at  timestamptz not null,
    confirmed_by  uuid,
    confirmer     text not null default '',     -- 누른 사람 이름 (자동이면 '자동 확정')
    auto          boolean not null default false,
    times         integer not null default 1    -- 그날 확정한 횟수 (다시 확정 포함)
);

create table if not exists public.inventory_snapshots (
    day          date not null,
    product_id   bigint not null,
    company      text not null,
    code         text not null default '',
    qty_a        integer not null default 0,
    qty_b        integer not null default 0,
    qty_defect   integer not null default 0,
    location     text not null default '',
    primary key (day, product_id)
);
create index if not exists inventory_snapshots_company_idx on public.inventory_snapshots (public.norm_company(company), day desc);

alter table public.inventory_days enable row level security;
alter table public.inventory_snapshots enable row level security;

drop policy if exists inventory_days_select on public.inventory_days;
create policy inventory_days_select on public.inventory_days
    for select to authenticated using (public.is_admin() or public.is_approved_seller());

drop policy if exists inventory_snapshots_select on public.inventory_snapshots;
create policy inventory_snapshots_select on public.inventory_snapshots
    for select to authenticated
    using (public.is_admin() or public.norm_company(company) = public.my_stock_company());

revoke insert, update, delete on public.inventory_days from authenticated, anon;
revoke insert, update, delete on public.inventory_snapshots from authenticated, anon;
grant select on public.inventory_days to authenticated;
grant select on public.inventory_snapshots to authenticated;

-- 확정 + 그날 재고 사진 찍기 (함수끼리만 씀)
create or replace function public.inventory_do_confirm(p_day date, p_auto boolean)
returns public.inventory_days
language plpgsql
security definer
set search_path = public
as $$
declare
    v_name text;
    v_row  public.inventory_days;
begin
    if p_auto then v_name := '자동 확정 (오후 7시)';
    else select coalesce(nullif(name, ''), company, '') into v_name from public.profiles where id = auth.uid();
    end if;
    insert into public.inventory_days (day, confirmed_at, confirmed_by, confirmer, auto, times)
    values (p_day, now(), case when p_auto then null else auth.uid() end, coalesce(v_name, ''), p_auto, 1)
    on conflict (day) do update set confirmed_at = now(), confirmed_by = excluded.confirmed_by,
        confirmer = excluded.confirmer, auto = excluded.auto, times = public.inventory_days.times + 1
    returning * into v_row;

    delete from public.inventory_snapshots where day = p_day;
    insert into public.inventory_snapshots (day, product_id, company, code, qty_a, qty_b, qty_defect, location)
    select p_day, i.product_id, i.company, p.code, i.qty_a, i.qty_b, i.qty_defect, i.location
    from public.inventory i join public.products p on p.id = i.product_id
    where i.qty_a <> 0 or i.qty_b <> 0 or i.qty_defect <> 0;
    return v_row;
end $$;
revoke all on function public.inventory_do_confirm(date, boolean) from public, anon, authenticated;

-- [재고정리완료] / [다시 확정] (관리자)
create or replace function public.inventory_confirm()
returns public.inventory_days
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        raise exception '관리자만 재고를 확정할 수 있습니다.' using errcode = '42501';
    end if;
    return public.inventory_do_confirm((now() at time zone 'Asia/Seoul')::date, false);
end $$;

-- 오늘 상태 (화면을 열 때마다 부름). 오후 7시가 지났는데 확정 안 됐으면 여기서 자동 확정합니다.
--   돌려주는 값: day, now_kst, confirmed_at, confirmer, auto, times, changes_after(확정 뒤 바뀐 수량 기록 수),
--                last_day / last_confirmed_at (가장 최근 확정)
create or replace function public.inventory_today()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_now  timestamp := now() at time zone 'Asia/Seoul';
    v_day  date := (now() at time zone 'Asia/Seoul')::date;
    v_row  public.inventory_days;
    v_last public.inventory_days;
    v_changes integer := 0;
begin
    if not (public.is_admin() or public.is_approved_seller()) then
        raise exception '권한이 없습니다.' using errcode = '42501';
    end if;
    select * into v_row from public.inventory_days where day = v_day;
    if not found and v_now::time >= time '19:00' and exists (select 1 from public.inventory) then
        v_row := public.inventory_do_confirm(v_day, true);
    end if;
    if v_row.day is not null then
        select count(*) into v_changes from public.inventory_moves where at > v_row.confirmed_at;
    end if;
    select * into v_last from public.inventory_days order by day desc limit 1;
    return jsonb_build_object(
        'day', v_day, 'now_kst', v_now,
        'confirmed_at', v_row.confirmed_at, 'confirmer', v_row.confirmer, 'auto', v_row.auto, 'times', v_row.times,
        'changes_after', v_changes,
        'last_day', v_last.day, 'last_confirmed_at', v_last.confirmed_at
    );
end $$;

revoke all on function public.inventory_confirm() from public, anon;
revoke all on function public.inventory_today() from public, anon;
grant execute on function public.inventory_confirm() to authenticated;
grant execute on function public.inventory_today() to authenticated;

notify pgrst, 'reload schema';
