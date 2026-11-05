// =====================================================================
// 밤낮딜리버리 최종재고 → 구글시트 매일 백업 (Apps Script)
//  - 구글시트 [확장 프로그램] → [Apps Script] 에 이 코드를 통째로 붙여넣고, 위쪽에서 setup 을 골라 [실행] 한 번.
//  - 그다음부터 매일 밤 9시(한국시간)에 자동으로:
//      · '최신재고' 탭을 지금 재고로 덮어쓰고
//      · 날짜 탭(예: 2026-10-31)을 하나 새로 만들어 그날 재고를 남깁니다 (90일 지난 날짜 탭은 자동 삭제)
//  - 바로 한 번 더 받고 싶으면 위쪽에서 backupInventory 를 골라 [실행].
//  - BACKUP_KEY 는 Supabase 에 넣은 백업 비밀번호와 같아야 합니다 (supabase/inventory_backup.sql).
// =====================================================================
const SUPABASE_URL = 'https://doierphwtctcomrujgem.supabase.co';
const SUPABASE_KEY = 'sb_publishable_5XM4HoFx4U_0kL-8ET_x-Q_WfvGwFXL';   // 공개용 키 (비밀값 아님)
const BACKUP_KEY = '여기에_백업_비밀번호';
const KEEP_DAYS = 90;
const HEADERS = ['상품코드', '거래처', '도매처', '도매상품명', '컬러', '사이즈', '상품화(A)', '미상품화(B)', '불량', '합계', '재고위치', '메모', '마지막 수정'];

function setup() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('backupInventory').timeBased().everyDays(1).atHour(21).inTimezone('Asia/Seoul').create();
  backupInventory();
}

function backupInventory() {
  const res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/inventory_backup', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
    payload: JSON.stringify({ p_key: BACKUP_KEY }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('재고를 받지 못했습니다 (HTTP ' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300));
  const items = JSON.parse(res.getContentText()) || [];
  const tz = 'Asia/Seoul';
  const now = new Date();
  const day = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  const rows = items.map(r => [
    r.code, r.company, r.wholesale_company, r.wholesale_product, r.color, r.size,
    r.qty_a, r.qty_b, r.qty_defect, (r.qty_a || 0) + (r.qty_b || 0) + (r.qty_defect || 0),
    r.location, r.memo, r.updated_at ? Utilities.formatDate(new Date(r.updated_at), tz, 'yyyy-MM-dd HH:mm') : '',
  ]);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const title = '백업 시각: ' + Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm') + ' · ' + rows.length + '개 상품';
  writeTab(ss, '최신재고', title, rows, 0);
  writeTab(ss, day, title, rows, 1);
  // 오래된 날짜 탭 정리
  const limit = new Date(now.getTime() - KEEP_DAYS * 86400000);
  ss.getSheets().forEach(sh => {
    const name = sh.getName();
    if (/^\d{4}-\d{2}-\d{2}$/.test(name) && new Date(name + 'T00:00:00+09:00') < limit) ss.deleteSheet(sh);
  });
}

function writeTab(ss, name, title, rows, index) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name, index);
  sh.clear();
  sh.getRange(1, 1).setValue(title).setFontWeight('bold');
  sh.getRange(2, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#eef2ff');
  if (rows.length) sh.getRange(3, 1, rows.length, HEADERS.length).setValues(rows);
  sh.setFrozenRows(2);
}
