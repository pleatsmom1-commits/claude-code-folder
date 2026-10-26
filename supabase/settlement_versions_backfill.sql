-- =====================================================================
-- (한 번만) 회차 기록 기능이 생기기 전에 저장해 둔 정산서를 '1차'로 옮겨 넣기
-- settlement_versions.sql 을 실행한 뒤 SQL Editor 에서 [Run] 하세요.
-- 회차 기록이 하나도 없는 정산일만 채우므로 여러 번 실행해도 안전합니다.
-- 보낸 뒤에 내용이 바뀌어 다시 저장된 정산서(저장이 발송보다 2분 넘게 늦음)는 '미발송'으로 넣습니다.
-- =====================================================================
insert into public.settlement_versions
    (settlement_id, company, settle_date, round, data, total, result, changed, sent_at, send_status, send_error, saved_at)
select
    s.id, s.company, s.settle_date, 1, s.data, s.total, s.result, true,
    case when s.sent_at is not null and s.updated_at - s.sent_at > interval '2 minutes' then null else s.sent_at end,
    case when s.sent_at is not null and s.updated_at - s.sent_at > interval '2 minutes' then null else s.send_status end,
    s.send_error,
    s.updated_at
from public.settlements s
where not exists (select 1 from public.settlement_versions v where v.settle_date = s.settle_date);

select count(*) as "1차로 옮긴 정산서 수" from public.settlement_versions where round = 1;
