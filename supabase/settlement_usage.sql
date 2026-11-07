-- =====================================================================
-- 밤낮딜리버리 - 업체가 로그인해서 보는 "내 이용 현황" (usage.html)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
-- (schema.sql, settlement.sql 을 먼저 실행한 상태여야 합니다. 여러 번 실행해도 안전합니다.)
--
--  - 정산서 표(settlements)는 지금처럼 관리자만 직접 읽을 수 있습니다. 업체에게 표를 열어주지 않습니다.
--  - 대신 아래 함수 하나로, 로그인한 승인 셀러에게 "가입 상호와 같은 상호"의 정산서만 돌려줍니다.
--    (상호 비교는 띄어쓰기·영문 대소문자 무시. 다른 업체 정산서는 절대 나오지 않습니다)
--  - 관리자는 p_company 로 업체를 골라 업체 화면 미리보기를 할 수 있습니다.
-- =====================================================================

-- 상호명 비교 기준 (stock.sql 과 같은 함수, 이미 있으면 그대로 덮어씀)
create or replace function public.norm_company(v text)
returns text
language sql
immutable
as $$
    select lower(regexp_replace(coalesce(v, ''), '\s', '', 'g'));
$$;

create or replace function public.get_my_settlements(p_from date, p_to date, p_company text default null)
returns table (
    company      text,
    settle_date  date,
    total        numeric,
    result       text,
    token        text,
    data         jsonb
)
language sql
stable
security definer
set search_path = public
as $$
    with me as (
        select case
            when public.is_admin() then public.norm_company(p_company)
            else (select public.norm_company(p.company) from public.profiles p
                  where p.id = auth.uid() and p.status = 'approved' and p.role = 'seller')
        end as company_key
    )
    select s.company, s.settle_date, s.total, s.result, s.token,
           -- 정산서 화면에 이미 보이는 값만 (단가 등 내부 정보는 원래 저장하지 않음). 매장별 사입내역은 빼서 가볍게.
           s.data - 'stores' - 'phone'
    from public.settlements s, me
    where me.company_key is not null and me.company_key <> ''
      and public.norm_company(s.company) = me.company_key
      and s.settle_date between least(p_from, p_to) and greatest(p_from, p_to)
      and greatest(p_from, p_to) - least(p_from, p_to) <= 400
    order by s.settle_date desc;
$$;
revoke all on function public.get_my_settlements(date, date, text) from public;
grant execute on function public.get_my_settlements(date, date, text) to authenticated;

notify pgrst, 'reload schema';
