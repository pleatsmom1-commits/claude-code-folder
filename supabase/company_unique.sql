-- =====================================================================
-- 밤낮딜리버리 - 상호명 중복 확인 (2026-10-21)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
-- (schema.sql 을 먼저 실행한 상태여야 합니다. 여러 번 실행해도 안전합니다.)
--  - 회원가입 화면의 [중복확인] 버튼이 쓰는 함수 company_available
--  - 같은 상호명(띄어쓰기·영문 대소문자 무시)이 두 번 생기지 않도록 DB 에서도 막기
--  - 맨 마지막 결과 칸에 이미 겹치는 상호명이 있으면 목록이 나옵니다.
--    (아무것도 안 나오면 = 겹치는 상호 없음, 정상 적용)
-- =====================================================================

-- 상호명 비교 기준: 띄어쓰기 제거 + 영문 소문자
create or replace function public.norm_company(v text)
returns text
language sql
immutable
as $$
    select lower(regexp_replace(coalesce(v, ''), '\s', '', 'g'));
$$;

-- [중복확인]: 로그인 전(회원가입 화면)에도 호출할 수 있고, 사용 가능 여부(true/false)만 알려줍니다.
create or replace function public.company_available(p_company text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select not exists (
        select 1 from public.profiles
        where public.norm_company(company) = public.norm_company(p_company)
    );
$$;
revoke all on function public.company_available(text) from public;
grant execute on function public.company_available(text) to anon, authenticated;

-- DB 에서도 막기. 이미 겹치는 상호명이 있으면 규칙을 만들지 않고 아래 목록으로 알려줍니다.
-- ('미등록'은 예전 계정 정리용 이름이라 제외)
do $$
begin
    if exists (
        select 1 from public.profiles
        where company <> '미등록'
        group by public.norm_company(company)
        having count(*) > 1
    ) then
        raise notice '겹치는 상호명이 있어 DB 중복 방지 규칙을 아직 만들지 않았습니다. 아래 목록의 상호명을 정리한 뒤 다시 실행해주세요.';
    else
        create unique index if not exists profiles_company_norm_uidx
            on public.profiles (public.norm_company(company))
            where company <> '미등록';
    end if;
end;
$$;

notify pgrst, 'reload schema';

-- 겹치는 상호명 목록 (비어 있으면 정상)
select p.company as "겹치는 상호명", p.email as "이메일", p.created_at as "가입일"
from public.profiles p
where p.company <> '미등록'
  and public.norm_company(p.company) in (
      select public.norm_company(company) from public.profiles
      where company <> '미등록'
      group by public.norm_company(company) having count(*) > 1
  )
order by public.norm_company(p.company), p.created_at;
