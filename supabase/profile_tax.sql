-- =====================================================================
-- 밤낮딜리버리 - 세금계산서 발행을 위한 정보 (2026-10-27)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
-- (여러 번 실행해도 안전합니다. profile_address.sql 을 안 했어도 주소 칸까지 함께 만듭니다)
--  - 셀러 프로필에 사업자등록번호 / 상호(법인명) / 대표자명 / 세금계산서 이메일 칸 추가
--  - 회원가입 때 입력한 값을 프로필에 자동으로 저장
-- =====================================================================
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

-- 이 SQL 보다 먼저 세금계산서 정보를 적고 가입한 계정이 있으면 채워 넣습니다.
update public.profiles p
set biz_no    = coalesce(p.biz_no,    nullif(trim(u.raw_user_meta_data->>'biz_no'), '')),
    biz_name  = coalesce(p.biz_name,  nullif(trim(u.raw_user_meta_data->>'biz_name'), '')),
    biz_ceo   = coalesce(p.biz_ceo,   nullif(trim(u.raw_user_meta_data->>'biz_ceo'), '')),
    tax_email = coalesce(p.tax_email, nullif(trim(u.raw_user_meta_data->>'tax_email'), ''))
from auth.users u
where u.id = p.id
  and (p.biz_no is null and p.biz_name is null and p.biz_ceo is null and p.tax_email is null)
  and coalesce(u.raw_user_meta_data->>'biz_no', u.raw_user_meta_data->>'biz_name',
               u.raw_user_meta_data->>'biz_ceo', u.raw_user_meta_data->>'tax_email') is not null;

notify pgrst, 'reload schema';
