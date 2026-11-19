// 상호통일 (supabase/company_unify.sql) - 화면 공용 도우미
//  관리자 화면에서 '다른 상호'를 '메인 상호'로 바꿔 줍니다. (DB 도 저장할 때 자동으로 바꾸지만,
//  엑셀 올리기처럼 화면에서 먼저 같은 상품인지 비교하는 곳에서 미리 맞춰 두려고 씁니다.)
//  SQL 을 아직 실행하지 않았거나 셀러 화면이면 아무것도 바꾸지 않습니다.
window.COMPANY_UNIFY = (function () {
    const map = new Map();   // norm(다른 상호) → { alias, main }
    const norm = v => String(v ?? '').replace(/\s+/g, '').toLowerCase();
    // 상호통일이 적용되는 기능 (company-unify.html 안내 상자와 같이 고칩니다)
    const APPLIED = ['상품관리', '재고표', '재고출고', '재고 증감 내역', '사입할 상품 목록(쇼핑몰 주문서 올리기)', '셀러 재고 확인'];
    const NOT_APPLIED = ['주문관리', '정산서', '이용 현황', '출고 리포트', '회원 가입 상호'];
    async function load(client) {
        map.clear();
        try {
            const { data, error } = await client.from('company_aliases').select('alias,main');
            if (!error) (data || []).forEach(r => { if (norm(r.alias) !== norm(r.main)) map.set(norm(r.alias), r); });
        } catch (e) { /* 표가 없으면 그냥 넘어감 */ }
        return map.size;
    }
    function main(name) { const r = map.get(norm(name)); return r ? r.main : name; }
    function aliasesOf(name) {
        const k = norm(main(name));
        return [...map.values()].filter(r => norm(r.main) === k).map(r => r.alias);
    }
    return { load, main, aliasesOf, norm, APPLIED, NOT_APPLIED, get size() { return map.size; } };
})();
