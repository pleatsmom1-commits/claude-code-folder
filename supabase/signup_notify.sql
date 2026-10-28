-- =====================================================================
-- 밤낮딜리버리 - 새 회원가입 알림 (2026-10-28)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요. (여러 번 실행해도 안전합니다)
--  - 셀러가 회원가입하면 사이트가 대표님 휴대폰으로 문자를 보냅니다 (worker/notify.js).
--  - 아무나 이 기능을 불러 문자를 계속 보내지 못하도록, "방금(30분 안에) 가입한 승인대기 계정"에
--    대해서만 한 번씩 알림 정보를 내어줍니다.
-- =====================================================================
alter table public.profiles add column if not exists signup_notified_at timestamptz;

-- 이 SQL 을 실행하기 전에 가입한 계정은 알림 대상에서 뺍니다.
update public.profiles set signup_notified_at = created_at where signup_notified_at is null;

create or replace function public.claim_signup_notice(p_email text)
returns table (company text, name text, phone text)
language plpgsql
security definer
set search_path = public
as $$
begin
    return query
    update public.profiles p
       set signup_notified_at = now()
     where lower(p.email) = lower(trim(p_email))
       and p.status = 'pending'
       and p.signup_notified_at is null
       and p.created_at > now() - interval '30 minutes'
    returning p.company, p.name, p.phone;
end;
$$;

revoke all on function public.claim_signup_notice(text) from public;
grant execute on function public.claim_signup_notice(text) to anon, authenticated;

notify pgrst, 'reload schema';
