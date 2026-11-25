-- =====================================================================
-- 밤낮딜리버리 - 방문 통계 (2026-11-23)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요. (여러 번 실행해도 안전합니다)
-- (schema.sql 을 먼저 실행한 상태여야 합니다.)
--  - site_visits : 주문접수 사이트 · 카페24 홈페이지 · 새 홈페이지(닷홈)의 조회수, 누른 버튼, 머문 시간
--  - 개인정보는 저장하지 않습니다: IP·이름·아이디·연락처 없음.
--    방문 묶음 번호(session)는 창을 닫으면 사라지는 무작위 글자라 사람을 알 수 없습니다.
--  - 관리자만 볼 수 있고, 2년이 지난 기록은 자동으로 지웁니다.
-- =====================================================================

create table if not exists public.site_visits (
    id          bigint generated always as identity primary key,
    created_at  timestamptz not null default now(),
    site        text not null,        -- app(주문접수 사이트) / cafe24(카페24 홈페이지) / dothome(새 홈페이지) / test(테스트 사이트)
    kind        text not null,        -- view(화면 열기) / click(버튼 누르기) / time(머문 시간)
    path        text,                 -- 화면 주소 (? 뒤는 지움)
    title       text,                 -- 화면 제목
    label       text,                 -- 누른 버튼 이름 (숫자는 지움)
    sec         integer,              -- 머문 시간(초). 실제로 화면을 보고 있던 시간만
    session     text,                 -- 방문 한 번 묶음 (무작위, 창 닫으면 사라짐)
    role        text,                 -- 주문접수 사이트: guest(로그인 전) / seller / admin
    device      text,                 -- pc / mobile
    referrer    text                  -- 어디서 왔는지 (주소의 앞부분만, 예: search.naver.com)
);
create index if not exists site_visits_created_idx on public.site_visits (created_at desc);
create index if not exists site_visits_site_idx on public.site_visits (site, created_at desc);
alter table public.site_visits enable row level security;

drop policy if exists site_visits_admin on public.site_visits;
create policy site_visits_admin on public.site_visits
    for select to authenticated
    using (public.is_admin());

-- 기록 서버(worker /api/track)가 여러 건을 한 번에 남길 때 쓰는 함수. 표를 직접 읽거나 고칠 수는 없습니다.
create or replace function public.log_site_events(p_site text, p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    e jsonb;
    n integer := 0;
begin
    if p_site not in ('app', 'cafe24', 'dothome', 'test') then return 0; end if;
    if jsonb_typeof(p_events) <> 'array' then return 0; end if;
    for e in select * from jsonb_array_elements(p_events) limit 50 loop
        if coalesce(e->>'kind', '') not in ('view', 'click', 'time') then continue; end if;
        insert into public.site_visits (site, kind, path, title, label, sec, session, role, device, referrer)
        values (
            p_site,
            e->>'kind',
            left(split_part(split_part(coalesce(e->>'path', ''), '?', 1), '#', 1), 200),
            nullif(left(coalesce(e->>'title', ''), 100), ''),
            nullif(left(btrim(regexp_replace(regexp_replace(coalesce(e->>'label', ''), '[0-9]', '', 'g'), '[\s\-.,:()/]+$', '')), 40), ''),
            case when (e->>'sec') ~ '^[0-9]{1,6}$' then least((e->>'sec')::int, 1800) end,
            nullif(left(regexp_replace(coalesce(e->>'session', ''), '[^A-Za-z0-9]', '', 'g'), 24), ''),
            case when e->>'role' in ('guest', 'seller', 'admin') then e->>'role' end,
            case when e->>'device' in ('pc', 'mobile') then e->>'device' end,
            nullif(left(lower(regexp_replace(coalesce(e->>'referrer', ''), '[^A-Za-z0-9.\-]', '', 'g')), 80), '')
        );
        n := n + 1;
    end loop;
    -- 보관 기간: 2년이 지난 기록은 가끔(약 100번에 1번) 지웁니다.
    if random() < 0.01 then
        delete from public.site_visits where created_at < now() - interval '2 years';
    end if;
    return n;
end;
$$;

revoke all on function public.log_site_events(text, jsonb) from public;
grant execute on function public.log_site_events(text, jsonb) to anon, authenticated;

-- 관리자 [방문 통계] 화면이 쓰는 집계 (한국 시간 기준 날짜). p_site 가 비면 모든 곳.
create or replace function public.site_visit_stats(p_from date, p_to date, p_site text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    result jsonb;
begin
    if not public.is_admin() then
        raise exception '관리자만 볼 수 있습니다.';
    end if;
    with v as (
        select *, (created_at at time zone 'Asia/Seoul') as kst
        from public.site_visits
        where created_at >= (p_from::timestamp at time zone 'Asia/Seoul')
          and created_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
          and (coalesce(p_site, '') = '' or site = p_site)
    )
    select jsonb_build_object(
        'sites', (select coalesce(jsonb_agg(x order by x.views desc), '[]') from (
            select site,
                   count(*) filter (where kind = 'view') as views,
                   count(distinct session) filter (where kind = 'view') as sessions,
                   coalesce(sum(sec) filter (where kind = 'time'), 0) as total_sec
            from v group by site) x),
        'daily', (select coalesce(jsonb_agg(x order by x.day, x.site), '[]') from (
            select kst::date as day, site,
                   count(*) filter (where kind = 'view') as views,
                   count(distinct session) filter (where kind = 'view') as sessions,
                   coalesce(sum(sec) filter (where kind = 'time'), 0) as total_sec
            from v group by 1, 2) x),
        'pages', (select coalesce(jsonb_agg(x order by x.views desc), '[]') from (
            select site, path, max(title) as title,
                   count(*) filter (where kind = 'view') as views,
                   count(distinct session) filter (where kind = 'view') as sessions,
                   coalesce(sum(sec) filter (where kind = 'time'), 0) as total_sec
            from v group by site, path
            having count(*) filter (where kind = 'view') > 0
            order by 4 desc limit 30) x),
        'clicks', (select coalesce(jsonb_agg(x order by x.clicks desc), '[]') from (
            select site, label, max(role) filter (where role is not null) as role,
                   count(*) as clicks, count(distinct session) as sessions
            from v where kind = 'click' and label is not null
            group by site, label order by 4 desc limit 40) x),
        'referrers', (select coalesce(jsonb_agg(x order by x.sessions desc), '[]') from (
            select site, referrer, count(distinct session) as sessions
            from v where kind = 'view' and referrer is not null
            group by site, referrer order by 3 desc limit 20) x),
        'devices', (select coalesce(jsonb_agg(x), '[]') from (
            select device, count(distinct session) as sessions
            from v where kind = 'view' and device is not null group by device) x),
        'roles', (select coalesce(jsonb_agg(x), '[]') from (
            select role, count(distinct session) as sessions
            from v where kind = 'view' and role is not null and site in ('app', 'test') group by role) x),
        'hours', (select coalesce(jsonb_agg(x order by x.hour), '[]') from (
            select extract(hour from kst)::int as hour, count(*) as views
            from v where kind = 'view' group by 1) x)
    ) into result;
    return result;
end;
$$;

revoke all on function public.site_visit_stats(date, date, text) from public;
grant execute on function public.site_visit_stats(date, date, text) to authenticated;

notify pgrst, 'reload schema';
