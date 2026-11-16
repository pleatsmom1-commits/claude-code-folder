// 재고/상품/출고관리 설명서 PDF 만들기: node tests/guide-stock-pdf.js <설명서폴더>  → 폴더 안 admin.html/seller.html 을 PDF 로
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const DIR = process.argv[2];
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png' };
const JOBS = [['admin.html', '밤낮딜리버리_재고상품출고관리_관리자용.pdf', '관리자용 재고/상품/출고관리 사용설명서'],
  ['seller.html', '밤낮딜리버리_재고확인_상품관리_셀러용.pdf', '셀러용 재고 확인·상품관리 사용설명서']];
const srv = http.createServer((q, s) => { const f = path.join(DIR, decodeURIComponent(q.url.split(/[?#]/)[0]));
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); });
srv.listen(0, async () => {
  const port = srv.address().port, b = await chromium.launch();
  for (const [page, out, title] of JOBS) {
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(`http://localhost:${port}/${page}`, { waitUntil: 'networkidle' });
    await p.evaluate(async () => { await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))); await document.fonts.ready; });
    const broken = await p.evaluate(() => [...document.images].filter(i => !i.naturalWidth).map(i => i.src));
    await p.emulateMedia({ media: 'print' });
    await p.pdf({ path: path.join(DIR, out), format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
      displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#888">밤낮딜리버리 ${title} · <span class="pageNumber"></span> / <span class="totalPages"></span></div>` });
    console.log(out, errs.length ? errs : 'ok', broken.length ? '깨진 그림: ' + broken : '');
    await p.close();
  }
  await b.close(); srv.close();
});
