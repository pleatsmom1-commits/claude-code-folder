-- =====================================================================
-- 밤낮딜리버리 - 밤늦게(22:30 이후) 들어온 픽업요청을 사입팀 카톡으로 자동 전송 (2026-11-19)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요. (여러 번 실행해도 안전합니다)
-- (schema.sql, pickup.sql 을 먼저 실행한 상태여야 합니다)
--  - 셀러가 [사입팀 픽업요청]을 접수하면 사이트가 사입팀 휴대폰으로 카톡(알림톡)을 보냅니다 (worker/pickup_notify.js).
--  - 보내는 시간: 한국시간 22:30 ~ 다음날 06:00 에 접수된 요청만 (관리자 화면에서 바꿀 수 있음)
--  - 받는 번호: 처음엔 사입팀 010-5091-5784 (관리자 화면 [사입픽업요청] 탭 위쪽에서 바꿀 수 있음)
--  - 보낸 결과는 픽업요청마다 기록돼서 관리자 화면 [카톡 전송 내역] 버튼으로 봅니다.
--  - 이 SQL 을 실행하기 전에 들어온 요청은 보내지 않습니다.
-- =====================================================================
alter table public.pickup_requests add column if not exists notified_at    timestamptz; -- 전송한 시각
alter table public.pickup_requests add column if not exists notify_result  text;        -- sent / failed / test
alter table public.pickup_requests add column if not exists notify_channel text;        -- alimtalk / sms
alter table public.pickup_requests add column if not exists notify_to      text;        -- 받은 번호 (가운데 가림)
alter table public.pickup_requests add column if not exists notify_detail  text;        -- 실패 이유 등

-- 이 SQL 을 처음 실행하기 전에 들어온 요청은 전송 대상에서 뺍니다. (결과 칸이 비어 있어 '전송 내역'에는 안 보입니다)
-- (두 번째 실행부터는, 방금 들어와 아직 전송을 기다리는 요청을 건드리지 않도록 10분 넘은 것만)
update public.pickup_requests
   set notified_at = created_at
 where notified_at is null
   and created_at < now() - interval '10 minutes';

-- 사이트 설정값. 관리자만 보고 바꿀 수 있습니다.
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

-- 처음 값 (이미 넣어 둔 값이 있으면 그대로 둡니다)
insert into public.app_settings (key, value) values
    ('pickup_notify_phones', '010-5091-5784'),
    ('pickup_notify_start',  '22:30'),
    ('pickup_notify_end',    '06:00')
on conflict (key) do update set value = excluded.value, updated_at = now()
 where public.app_settings.value = '';

-- 방금(30분 안에) 접수된, 아직 보내지 않은 픽업요청 1건을 "전송함"으로 표시하고 내용과 받을 번호를 돌려줍니다.
--  - 접수 시각(한국시간)이 보내는 시간(22:30~06:00) 안일 때만 돌려줍니다.
--  - 아무나 불러도 같은 요청으로 카톡이 두 번 가지 않습니다.
drop function if exists public.claim_pickup_notice(uuid);
create function public.claim_pickup_notice(p_id uuid)
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
declare
    v_start time;
    v_end   time;
begin
    begin
        v_start := coalesce(nullif((select s.value from public.app_settings s where s.key = 'pickup_notify_start'), ''), '22:30')::time;
        v_end   := coalesce(nullif((select s.value from public.app_settings s where s.key = 'pickup_notify_end'), ''), '06:00')::time;
    exception when others then
        v_start := '22:30'; v_end := '06:00';
    end;

    return query
    update public.pickup_requests r
       set notified_at = now()
     where r.id = p_id
       and r.notified_at is null
       and r.status = '접수'
       and r.created_at > now() - interval '30 minutes'
       and (case when v_start <= v_end
                 then (r.created_at at time zone 'Asia/Seoul')::time >= v_start and (r.created_at at time zone 'Asia/Seoul')::time < v_end
                 else (r.created_at at time zone 'Asia/Seoul')::time >= v_start or  (r.created_at at time zone 'Asia/Seoul')::time < v_end
            end)
    returning r.seller_company, r.orderer_name, r.orderer_phone,
              r.store_name, r.store_location, r.store_phone,
              r.prepay, r.prepay_misong, r.memo, r.created_at,
              coalesce((select s.value from public.app_settings s where s.key = 'pickup_notify_phones'), '');
end;
$$;

revoke all on function public.claim_pickup_notice(uuid) from public;
grant execute on function public.claim_pickup_notice(uuid) to anon, authenticated;

-- 보낸 결과 기록 (사이트가 보낸 직후 1번만 적을 수 있음)
create or replace function public.record_pickup_notice(p_id uuid, p_result text, p_channel text, p_to text, p_detail text)
returns void
language sql
security definer
set search_path = public
as $$
    update public.pickup_requests r
       set notify_result  = left(p_result, 20),
           notify_channel = left(p_channel, 20),
           notify_to      = left(p_to, 200),
           notify_detail  = left(p_detail, 300)
     where r.id = p_id
       and r.notify_result is null
       and r.notified_at > now() - interval '10 minutes'
       and p_result in ('sent', 'failed', 'test');
$$;

revoke all on function public.record_pickup_notice(uuid, text, text, text, text) from public;
grant execute on function public.record_pickup_notice(uuid, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
