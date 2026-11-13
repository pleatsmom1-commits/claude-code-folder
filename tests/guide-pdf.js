// 설명서 PDF 만들기: node tests/guide-pdf.js  → guide/bamnat-guide.pdf (그림 미리보기는 두 번째 인자 폴더에)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.pdf': 'application/pdf' };
const srv = http.createServer((q, s) => { let f = path.join(ROOT, decodeURIComponent(q.url.split(/[?#]/)[0])); if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); });
srv.listen(0, async () => {
  const port = srv.address().port, b = await chromium.launch(), p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${port}/guide/`, { waitUntil: 'networkidle' });
  await p.evaluate(async () => { document.querySelectorAll('details').forEach(d => d.open = true);
    const im = [...document.images]; im.forEach(i => i.loading = 'eager');
    await Promise.all(im.map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))); await document.fonts.ready; });
  await p.emulateMedia({ media: 'print' });
  await p.pdf({ path: path.join(ROOT, 'guide/bamnat-guide.pdf'), format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
    displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#888">밤낮딜리버리 이용 설명서 · <span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
  if (process.argv[2]) { await p.emulateMedia({ media: 'screen' }); await p.setViewportSize({ width: 1000, height: 900 }); await p.screenshot({ path: path.join(process.argv[2], 'pdf_before_top.png') }); }
  console.log(errs.length ? errs.join('\n') : 'no page errors'); await b.close(); srv.close();
});
