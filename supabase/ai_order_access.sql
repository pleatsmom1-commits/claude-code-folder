-- =====================================================================
-- 쇼핑몰 주문서 그대로 올리기(AI) → 풀필먼트 이용 업체만 쓰게 하기
--  - profiles.ai_order : 관리자가 셀러 관리 화면에서 켜고 끄는 칸 (처음엔 모두 꺼짐)
--  - 셀러 본인은 이 칸을 바꿀 수 없습니다 (관리자만)
--  - my_ai_order_ok() : 사이트 서버(/api/order-ai)가 "이 계정이 써도 되는지" 확인할 때 씀
--  - 여러 번 실행해도 안전합니다. schema.sql, stock.sql, order_ai.sql 다음에 실행하세요.
-- =====================================================================

alter table public.profiles add column if not exists ai_order boolean not null default false;

-- 셀러가 직접 켜지 못하게 막기 (기존 profiles_protect 는 그대로 두고 따로 하나 더)
create or replace function public.profiles_ai_order_protect()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if current_user in ('authenticated', 'anon') and not public.is_admin() then
        new.ai_order := old.ai_order;
    end if;
    return new;
end;
$$;

drop trigger if exists profiles_ai_order_protect on public.profiles;
create trigger profiles_ai_order_protect
    before update on public.profiles
    for each row execute function public.profiles_ai_order_protect();

-- 가입할 때 스스로 켜고 들어오는 것도 막기
create or replace function public.profiles_ai_order_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if current_user in ('authenticated', 'anon') and not public.is_admin() then
        new.ai_order := false;
    end if;
    return new;
end;
$$;

drop trigger if exists profiles_ai_order_insert on public.profiles;
create trigger profiles_ai_order_insert
    before insert on public.profiles
    for each row execute function public.profiles_ai_order_insert();

-- 이 계정이 AI 주문서 올리기를 써도 되는지 (관리자는 항상 됨)
create or replace function public.my_ai_order_ok()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce((
        select role = 'admin' or (status = 'approved' and ai_order)
        from public.profiles where id = auth.uid()
    ), false);
$$;

grant execute on function public.my_ai_order_ok() to authenticated;

notify pgrst, 'reload schema';
