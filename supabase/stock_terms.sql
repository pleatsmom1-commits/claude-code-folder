-- =====================================================================
-- 밤낮딜리버리 - 재고 보관 서비스 이용약관 동의 기록
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요. (여러 번 실행해도 안전합니다)
--
--  - 셀러가 [재고 확인]/[재고 증감]을 처음 열 때 뜨는 동의 창(stock-terms.js)에서 [동의하고 재고 보기]를 누르면
--    누가(계정·업체) · 언제 · 어떤 약관 버전에 동의했는지 한 줄씩 남습니다.
--  - 기록은 지우거나 고칠 수 없고(분쟁 대비), 관리자는 모두, 셀러는 자기 기록만 볼 수 있습니다.
--  - 이 SQL 을 실행하기 전에는 동의 창이 뜨지 않고 재고 화면이 그대로 열립니다.
-- =====================================================================

create table if not exists public.stock_terms_agreements (
    id         bigint generated always as identity primary key,
    user_id    uuid not null default auth.uid(),
    company    text not null default '',
    version    text not null,
    agreed_at  timestamptz not null default now(),
    user_agent text not null default ''
);
create unique index if not exists stock_terms_agreements_user_version_uidx on public.stock_terms_agreements (user_id, version);
create index if not exists stock_terms_agreements_company_idx on public.stock_terms_agreements (company, agreed_at desc);

alter table public.stock_terms_agreements enable row level security;
drop policy if exists stock_terms_agreements_select on public.stock_terms_agreements;
create policy stock_terms_agreements_select on public.stock_terms_agreements
    for select to authenticated
    using (public.is_admin() or user_id = auth.uid());
revoke insert, update, delete on public.stock_terms_agreements from authenticated, anon;
grant select on public.stock_terms_agreements to authenticated;

-- 이 계정이 이 약관 버전에 동의했는지
create or replace function public.stock_terms_status(p_version text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (select 1 from public.stock_terms_agreements where user_id = auth.uid() and version = p_version);
$$;

-- 동의 기록 남기기 (이미 동의했으면 그대로)
create or replace function public.stock_terms_agree(p_version text, p_user_agent text default '')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_company text;
begin
    if auth.uid() is null then
        raise exception '로그인 후 동의할 수 있습니다.' using errcode = '42501';
    end if;
    if coalesce(p_version, '') = '' then
        raise exception '약관 버전이 없습니다.';
    end if;
    select coalesce(company, '') into v_company from public.profiles where id = auth.uid();
    insert into public.stock_terms_agreements (user_id, company, version, user_agent)
    values (auth.uid(), coalesce(v_company, ''), p_version, left(coalesce(p_user_agent, ''), 300))
    on conflict (user_id, version) do nothing;
    return true;
end $$;

revoke all on function public.stock_terms_status(text) from public, anon;
revoke all on function public.stock_terms_agree(text, text) from public, anon;
grant execute on function public.stock_terms_status(text) to authenticated;
grant execute on function public.stock_terms_agree(text, text) to authenticated;

notify pgrst, 'reload schema';
