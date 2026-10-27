-- =====================================================================
-- 밤낮딜리버리 - 셀러 매장·사무실 주소 (2026-10-27)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
-- (schema.sql 을 먼저 실행한 상태여야 합니다. 여러 번 실행해도 안전합니다.)
--  - 셀러 프로필에 우편번호 / 주소 / 상세주소 칸 추가
--  - 회원가입 때 입력한 주소를 프로필에 자동으로 저장
-- =====================================================================
-- (세금계산서 정보 칸도 함께 만듭니다: profile_tax.sql 과 같은 내용이라 어느 쪽을 다시 실행해도 안전)
alter table public.profiles add column if not exists zipcode        text;
alter table public.profiles add column if not exists address        text;
alter table public.profiles add column if not exists detail_address text;
alter table public.profiles add column if not exists biz_no         text;  -- 사업자등록번호 (000-00-00000)
alter table public.profiles add column if not exists biz_name       text;  -- 상호(법인명)
alter table public.profiles add column if not exists biz_ceo        text;  -- 대표자명 (사업자등록증상)
alter table public.profiles add column if not exists tax_email      text;  -- 세금계산서 받을 이메일


-- 회원가입 시 프로필 자동 생성 (주소 + 세금계산서 정보까지 저장)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, email, company, name, phone, zipcode, address, detail_address,
                                 biz_no, biz_name, biz_ceo, tax_email)
    values (
        new.id,
        new.email,
        coalesce(nullif(trim(new.raw_user_meta_data->>'company'), ''), '미등록'),
        nullif(trim(new.raw_user_meta_data->>'name'), ''),
        nullif(trim(new.raw_user_meta_data->>'phone'), ''),
        nullif(trim(new.raw_user_meta_data->>'zipcode'), ''),
        nullif(trim(new.raw_user_meta_data->>'address'), ''),
        nullif(trim(new.raw_user_meta_data->>'detail_address'), ''),
        nullif(trim(new.raw_user_meta_data->>'biz_no'), ''),
        nullif(trim(new.raw_user_meta_data->>'biz_name'), ''),
        nullif(trim(new.raw_user_meta_data->>'biz_ceo'), ''),
        nullif(trim(new.raw_user_meta_data->>'tax_email'), '')
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
