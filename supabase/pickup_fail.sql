-- =====================================================================
-- 밤낮딜리버리 - 사입 픽업요청 상태에 '픽업실패' 추가 (2026-11-11)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요. (여러 번 실행해도 안전합니다)
-- 상태 값: 접수 / 확인(사입팀접수확인) / 완료(픽업완료) / 실패(픽업실패) / 취소(접수취소)
-- =====================================================================

alter table public.pickup_requests drop constraint if exists pickup_requests_status_check;
alter table public.pickup_requests add constraint pickup_requests_status_check
    check (status in ('접수', '확인', '완료', '실패', '취소'));

notify pgrst, 'reload schema';
