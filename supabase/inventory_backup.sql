-- =====================================================================
-- 매일 최종재고 구글시트 백업 (재고관리 v2 6단계)
--  - 구글시트에 붙인 Apps Script 가 매일 밤 inventory_backup(백업 비밀번호) 를 불러 지금 재고 전체를 받아 갑니다.
--  - 로그인 없이 부르는 함수라, backup_keys 에 넣은 비밀번호가 맞을 때만 재고를 돌려줍니다.
--    비밀번호는 이 파일에 적지 않고, 대표님께 따로 드린 한 줄(insert …)로 넣습니다.
--  - 여러 번 실행해도 안전합니다. inventory.sql 다음에 실행하세요.
-- =====================================================================

create table if not exists public.backup_keys (
    name        text primary key,
    key         text not null,
    created_at  timestamptz not null default now()
);
alter table public.backup_keys enable row level security;
-- 정책 없음 = 화면·API 에서 아무도 못 읽음 (아래 함수 안에서만 확인)
revoke all on public.backup_keys from authenticated, anon;

create or replace function public.inventory_backup(p_key text)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if p_key is null or length(p_key) < 20
       or not exists (select 1 from public.backup_keys where name = 'google_sheet' and key = p_key) then
        raise exception '백업 비밀번호가 맞지 않습니다.' using errcode = '42501';
    end if;
    -- 한 덩어리(json)로 돌려줘서 1,000줄 제한 없이 전부 보냄
    return coalesce((
        select json_agg(json_build_object(
            'code', p.code, 'company', p.company,
            'wholesale_company', p.wholesale_company, 'wholesale_product', p.wholesale_product,
            'color', p.color, 'size', p.size,
            'qty_a', i.qty_a, 'qty_b', i.qty_b, 'qty_defect', i.qty_defect,
            'location', i.location, 'memo', i.memo, 'updated_at', i.updated_at
        ) order by p.company, p.code)
        from public.inventory i
        join public.products p on p.id = i.product_id
        where p.deleted_at is null
    ), '[]'::json);
end;
$$;

revoke all on function public.inventory_backup(text) from public;
grant execute on function public.inventory_backup(text) to anon, authenticated;
