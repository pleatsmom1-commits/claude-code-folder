-- =====================================================================
-- 밤낮딜리버리 - 정산서 회차(1차·2차·3차) 기록
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
-- (settlement.sql 을 먼저 실행한 상태여야 합니다. 여러 번 실행해도 안전합니다.)
--
--  - [정산서 저장]을 누를 때마다 그 정산일의 회차(round)가 하나 늘고, 그 날 업체 전부의 기록이 남습니다.
--  - changed = 바로 이전 회차와 내용이 다름(또는 첫 회차). 같으면 '중복값이라 미전송'.
--  - 알림톡 발송 결과(settlements 의 sent_at 등)는 그 업체의 가장 최근 '바뀐 회차' 기록에 자동으로 복사됩니다.
-- =====================================================================

create table if not exists public.settlement_versions (
    id             bigint generated always as identity primary key,
    settlement_id  bigint references public.settlements(id) on delete cascade,
    company        text not null,
    settle_date    date not null,
    round          integer not null,
    data           jsonb not null,
    total          numeric,
    result         text,
    changed        boolean not null default true,
    sent_at        timestamptz,
    send_status    text,
    send_error     text,
    saved_at       timestamptz not null default now(),
    unique (settle_date, company, round)
);
create index if not exists settlement_versions_date_idx on public.settlement_versions (settle_date, round);
create index if not exists settlement_versions_settlement_idx on public.settlement_versions (settlement_id, round desc);
alter table public.settlement_versions enable row level security;

drop policy if exists settlement_versions_admin on public.settlement_versions;
create policy settlement_versions_admin on public.settlement_versions
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- 알림톡 발송 결과를 그 업체의 최신 '바뀐 회차' 기록에 복사
create or replace function public.settlement_sync_version_send()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.sent_at is distinct from old.sent_at
       or new.send_status is distinct from old.send_status
       or new.send_error is distinct from old.send_error then
        update public.settlement_versions v
           set sent_at = new.sent_at, send_status = new.send_status, send_error = new.send_error
         where v.id = (
            select id from public.settlement_versions
             where settlement_id = new.id and changed
             order by round desc
             limit 1
         );
    end if;
    return new;
end;
$$;

drop trigger if exists settlements_sync_version_send on public.settlements;
create trigger settlements_sync_version_send
    after update on public.settlements
    for each row execute function public.settlement_sync_version_send();

notify pgrst, 'reload schema';
