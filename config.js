// =====================================================================
// 사이트 환경 설정 (index.html, settle.html 공통)
//  - 실제 사이트 주소에서는 항상 실제 DB를 씁니다.
//  - 그 밖의 주소(브랜치 미리보기 사이트, 내 PC 등)는 "테스트 사이트"로 표시하고,
//    TEST_SUPABASE 가 채워져 있으면 테스트 DB를 씁니다.
//  주소와 publishable 키는 원래 화면에 공개되는 값입니다 (비밀값 아님).
// =====================================================================
// 실제 사이트 주소. 예전 주소(pleatsmom1)는 Cloudflare 하위 도메인을 바꾸기 전/직후를 위해 함께 둡니다.
const PRODUCTION_HOSTS = [
    'bamnat-delivery.bamnat.workers.dev',
    'bamnat-delivery.pleatsmom1.workers.dev',
];
const IS_PRODUCTION = PRODUCTION_HOSTS.includes(location.hostname);

const PROD_SUPABASE = {
    url: 'https://doierphwtctcomrujgem.supabase.co',
    key: 'sb_publishable_5XM4HoFx4U_0kL-8ET_x-Q_WfvGwFXL',
};
// 테스트용 Supabase 프로젝트를 만들면 여기에 넣습니다. (비워두면 테스트 사이트도 실제 DB 사용)
const TEST_SUPABASE = {
    url: '',
    key: '',
};

const USE_TEST_DB = !IS_PRODUCTION && !!(TEST_SUPABASE.url && TEST_SUPABASE.key);
const SUPABASE_URL = USE_TEST_DB ? TEST_SUPABASE.url : PROD_SUPABASE.url;
const SUPABASE_KEY = USE_TEST_DB ? TEST_SUPABASE.key : PROD_SUPABASE.key;

// 테스트 사이트에서는 화면 맨 위에 띠를 띄워 실제 사이트와 헷갈리지 않게 합니다.
if (!IS_PRODUCTION) {
    document.addEventListener('DOMContentLoaded', () => {
        const bar = document.createElement('div');
        bar.id = 'test-site-banner';
        bar.style.cssText = 'position:sticky;top:0;z-index:9999;padding:8px 12px;text-align:center;font:700 13px/1.4 sans-serif;'
            + (USE_TEST_DB ? 'background:#fef3c7;color:#92400e;' : 'background:#e11d48;color:#fff;');
        bar.textContent = USE_TEST_DB
            ? '🧪 테스트 사이트입니다 · 테스트 DB 사용 중 (실제 데이터에 영향 없음)'
            : '⚠️ 테스트 사이트입니다 · 실제 DB와 연결되어 있어 저장하면 실제 데이터가 바뀝니다';
        document.body.prepend(bar);
    });
}
