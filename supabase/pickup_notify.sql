-- =====================================================================
-- 밤낮딜리버리 - 새 픽업요청을 사입팀에게 자동 알림 (2026-11-07)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요. (여러 번 실행해도 안전합니다)
-- (schema.sql, pickup.sql 을 먼저 실행한 상태여야 합니다)
--  - 셀러가 픽업요청을 접수하면 사이트가 사입팀 휴대폰으로 알림을 보냅니다 (worker/pickup_notify.js).
--  - 새로 들어온 요청만 한 번씩 보냅니다. 이 SQL 을 실행하기 전에 들어온 요청은 보내지 않습니다.
--  - 알림 받을 번호는 관리자 화면 [사입픽업요청] 탭 위쪽 '사입팀 알림 받을 번호'에서 넣습니다.
-- =====================================================================
alter table public.pickup_requests add column if not exists notified_at timestamptz;

-- 이 SQL 을 처음 실행하기 전에 들어온 요청은 알림 대상에서 뺍니다.
-- (두 번째 실행부터는, 방금 들어와 아직 알림을 기다리는 요청을 건드리지 않도록 10분 넘은 것만)
update public.pickup_requests
   set notified_at = created_at
 where notified_at is null
   and created_at < now() - interval '10 minutes';

-- 사이트 설정값 (지금은 '사입팀 알림 받을 번호'만). 관리자만 보고 바꿀 수 있습니다.
create table if not exists public.app_settings (
    key         text primary key,
    value       text not null default '',
    updated_at  timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists app_settings_admin_all on public.app_settings;
create policy app_settings_admin_all on public.app_settings
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- 방금(30분 안에) 접수된, 아직 알리지 않은 픽업요청 1건을 "알림 보냄"으로 표시하고 내용과 받을 번호를 돌려줍니다.
-- 아무나 불러도 같은 요청으로 문자가 두 번 가지 않습니다.
create or replace function public.claim_pickup_notice(p_id uuid)
returns table (
    seller_company text, orderer_name text, orderer_phone text,
    store_name text, store_location text, store_phone text,
    prepay boolean, prepay_misong boolean, memo text, created_at timestamptz,
    phones text
)
language plpgsql
security definer
set search_path = public
as $$
begin
    return query
    update public.pickup_requests r
       set notified_at = now()
     where r.id = p_id
       and r.notified_at is null
       and r.status = '접수'
       and r.created_at > now() - interval '30 minutes'
    returning r.seller_company, r.orderer_name, r.orderer_phone,
              r.store_name, r.store_location, r.store_phone,
              r.prepay, r.prepay_misong, r.memo, r.created_at,
              coalesce((select s.value from public.app_settings s where s.key = 'pickup_notify_phones'), '');
end;
$$;

revoke all on function public.claim_pickup_notice(uuid) from public;
grant execute on function public.claim_pickup_notice(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
