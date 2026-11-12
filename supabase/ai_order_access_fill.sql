-- =====================================================================
-- (한 번만 실행) 지금 재고표에 재고가 있는 업체의 승인된 계정은 AI 주문서 올리기를 켜 둡니다.
--  - 켜기만 하고 끄지는 않습니다. 그 뒤로는 관리자 화면에서 업체별로 켜고 끄세요.
--  - ai_order_access.sql 을 먼저 실행해야 합니다.
-- =====================================================================
update public.profiles p
set ai_order = true
where p.role = 'seller'
  and p.status = 'approved'
  and p.ai_order = false
  and exists (
      select 1 from public.inventory i
      where public.norm_company(i.company) = public.norm_company(p.company)
        and (i.qty_a + i.qty_b) > 0
  );

-- 켜진 업체 확인
select company, name, email from public.profiles where ai_order order by company;
