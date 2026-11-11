-- =====================================================================
-- 밤낮딜리버리 - 업체가 자기 픽업요청을 직접 [취소] 할 수 있게 하는 설정
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
-- (pickup.sql 을 먼저 실행한 상태여야 합니다. 여러 번 실행해도 안전합니다.)
--
-- · 업체는 '접수' 상태(사입팀이 아직 확인 전)인 자기 요청만 취소할 수 있습니다.
-- · 상태만 '취소'로 바뀌고, 다른 내용은 바꿀 수 없습니다.
-- =====================================================================

-- 업체가 취소한 시각 (관리자가 취소한 경우는 비어 있음)
alter table public.pickup_requests add column if not exists canceled_at timestamptz;

create or replace function public.cancel_my_pickup(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.pickup_requests
       set status = '취소', canceled_at = now()
     where id = p_id
       and seller_id = auth.uid()
       and status = '접수';
    return found;
end;
$$;

revoke all on function public.cancel_my_pickup(uuid) from public, anon;
grant execute on function public.cancel_my_pickup(uuid) to authenticated;

notify pgrst, 'reload schema';
