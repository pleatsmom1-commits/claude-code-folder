-- =====================================================================
-- 밤낮딜리버리 - 셀러 매장·사무실 주소 (2026-10-27)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
-- (schema.sql 을 먼저 실행한 상태여야 합니다. 여러 번 실행해도 안전합니다.)
--  - 셀러 프로필에 우편번호 / 주소 / 상세주소 칸 추가
--  - 회원가입 때 입력한 주소를 프로필에 자동으로 저장
-- =====================================================================
alter table public.profiles add column if not exists zipcode        text;
alter table public.profiles add column if not exists address        text;
alter table public.profiles add column if not exists detail_address text;

-- 회원가입 시 프로필 자동 생성 (role 은 항상 seller, 상태는 승인 대기로 시작)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, email, company, name, phone, zipcode, address, detail_address)
    values (
        new.id,
        new.email,
        coalesce(nullif(trim(new.raw_user_meta_data->>'company'), ''), '미등록'),
        nullif(trim(new.raw_user_meta_data->>'name'), ''),
        nullif(trim(new.raw_user_meta_data->>'phone'), ''),
        nullif(trim(new.raw_user_meta_data->>'zipcode'), ''),
        nullif(trim(new.raw_user_meta_data->>'address'), ''),
        nullif(trim(new.raw_user_meta_data->>'detail_address'), '')
    );
    return new;
end;
$$;

-- 이 SQL 보다 먼저 가입하면서 주소를 적은 계정이 있으면 채워 넣습니다.
update public.profiles p
set zipcode        = coalesce(p.zipcode, nullif(trim(u.raw_user_meta_data->>'zipcode'), '')),
    address        = coalesce(p.address, nullif(trim(u.raw_user_meta_data->>'address'), '')),
    detail_address = coalesce(p.detail_address, nullif(trim(u.raw_user_meta_data->>'detail_address'), ''))
from auth.users u
where u.id = p.id and p.address is null and nullif(trim(u.raw_user_meta_data->>'address'), '') is not null;

notify pgrst, 'reload schema';
