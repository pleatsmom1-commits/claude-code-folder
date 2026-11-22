-- =====================================================================
-- 밤낮딜리버리 - 관리자 사입팀 픽업요청: 접수건 삭제(휴지통) + 복원 (2026-11-22)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요. (여러 번 실행해도 안전합니다)
-- (pickup.sql, order_times.sql 을 먼저 실행한 상태여야 합니다.)
--
--  - [선택 삭제]: 체크한 픽업요청을 목록에서 빼서 '휴지통'(admin_deleted_pickups)에 그대로 보관합니다.
--      → 관리자 목록, 셀러 '내 픽업요청 내역' 등 모든 곳에서 사라집니다.
--  - [휴지통]에서 [선택 복원]: 접수시각·상태·관리자 처리시각·카톡 전송 기록까지 그대로 다시 넣습니다.
--      (복원해도 사입팀에게 카톡이 다시 가지 않습니다)
--  - 휴지통 보관 기간: 90일. 90일이 지난 건은 개인정보 보호를 위해 자동으로 완전히 지워집니다.
--  - 관리자만 쓸 수 있습니다. 누가 지우고 복원했는지는 '작업 기록'에도 남습니다.
-- =====================================================================

-- 1) 휴지통 표
create table if not exists public.admin_deleted_pickups (
    pickup_id       uuid primary key,
    data            jsonb not null,              -- 지우기 전 픽업요청 한 줄 전체
    deleted_at      timestamptz not null default now(),
    deleted_by      uuid default auth.uid(),
    deleted_by_name text
);
create index if not exists admin_deleted_pickups_at_idx on public.admin_deleted_pickups (deleted_at desc);
alter table public.admin_deleted_pickups enable row level security;

drop policy if exists admin_deleted_pickups_admin_read on public.admin_deleted_pickups;
create policy admin_deleted_pickups_admin_read on public.admin_deleted_pickups
    for select to authenticated
    using (public.is_admin());
-- 넣기·빼기는 아래 함수로만 합니다. (직접 쓰기 권한 없음)

-- 2) 복원할 때는 '관리자 처리시각'(handled_at)을 원래 값 그대로 둡니다. (order_times.sql 과 같은 내용 + 예외 1줄)
create or replace function public.pickup_track_handled_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_privileged boolean := public.is_admin() or auth.uid() is null;
begin
    if tg_op = 'INSERT' then
        -- 예외: 휴지통에서 복원할 때는 원래 처리시각 그대로
        if v_privileged and coalesce(current_setting('bamnat.restore', true), '') = 'on' then
            return new;
        end if;
        if not v_privileged then new.origin_created_at := null; end if;
        new.handled_at := case when new.status = '접수' then null else now() end;
        return new;
    end if;
    if not v_privileged then new.origin_created_at := old.origin_created_at; end if;
    if new.status is distinct from old.status then
        new.handled_at := case when new.status = '접수' then null else now() end;
    else
        new.handled_at := old.handled_at;
    end if;
    return new;
end;
$$;

-- 3) 삭제(휴지통으로 옮기기)
create or replace function public.admin_trash_pickups(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_name text;
    v_cnt  integer := 0;
    r      public.pickup_requests;
begin
    if not public.is_admin() then
        raise exception '관리자만 삭제할 수 있습니다.' using errcode = '42501';
    end if;
    select coalesce(nullif(trim(name), ''), email) into v_name from public.profiles where id = auth.uid();

    for r in select * from public.pickup_requests where id = any(p_ids) for update loop
        insert into public.admin_deleted_pickups (pickup_id, data, deleted_at, deleted_by, deleted_by_name)
        values (r.id, to_jsonb(r), now(), auth.uid(), v_name)
        on conflict (pickup_id) do update
            set data = excluded.data, deleted_at = excluded.deleted_at,
                deleted_by = excluded.deleted_by, deleted_by_name = excluded.deleted_by_name;
        delete from public.pickup_requests where id = r.id;
        v_cnt := v_cnt + 1;
    end loop;

    -- 90일 지난 휴지통 정리 (개인정보 보호)
    delete from public.admin_deleted_pickups where deleted_at < now() - interval '90 days';
    return v_cnt;
end;
$$;

-- 4) 복원
create or replace function public.admin_restore_pickups(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cnt integer := 0;
    d     public.admin_deleted_pickups;
begin
    if not public.is_admin() then
        raise exception '관리자만 복원할 수 있습니다.' using errcode = '42501';
    end if;
    perform set_config('bamnat.restore', 'on', true);

    for d in select * from public.admin_deleted_pickups where pickup_id = any(p_ids) for update loop
        if not exists (select 1 from public.pickup_requests where id = d.pickup_id) then
            insert into public.pickup_requests
            select (jsonb_populate_record(null::public.pickup_requests, d.data)).*;
        end if;
        delete from public.admin_deleted_pickups where pickup_id = d.pickup_id;
        v_cnt := v_cnt + 1;
    end loop;

    perform set_config('bamnat.restore', '', true);
    return v_cnt;
end;
$$;

revoke all on function public.admin_trash_pickups(uuid[]) from public;
revoke all on function public.admin_restore_pickups(uuid[]) from public;
grant execute on function public.admin_trash_pickups(uuid[]) to authenticated;
grant execute on function public.admin_restore_pickups(uuid[]) to authenticated;

-- 5) 작업 기록(staff_activity.sql)을 실행했다면, 휴지통 표도 기록에 연결 (안 했으면 건너뜀)
do $$
begin
    if to_regproc('public.log_admin_activity') is not null then
        drop trigger if exists zz_admin_activity on public.admin_deleted_pickups;
        create trigger zz_admin_activity after insert or update or delete on public.admin_deleted_pickups
            for each row execute function public.log_admin_activity();
    end if;
end;
$$;

notify pgrst, 'reload schema';
