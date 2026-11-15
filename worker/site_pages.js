// =====================================================================
// 홈페이지 최신 내용 읽기 (worker/ask.js 가 AI 에게 함께 전달)
//  - 홈페이지가 바뀌면 AI 답변도 따라 바뀌도록, 아래 페이지의 글자만 뽑아 AI 에게 보여 줍니다.
//  - 한 번 읽으면 6시간 동안 다시 쓰고(같은 서버 안), 그 뒤 질문이 오면 다시 읽습니다.
//  - 구글폼 접수는 더 이상 쓰지 않으므로, 구글폼(forms.gle) 이 들어간 줄은 빼고 읽습니다.
//  - 읽기에 실패한 페이지는 지난번 내용(없으면 빼고)으로 답합니다. knowledge.js 안내자료는 항상 함께 씁니다.
//  - 페이지를 더하거나 빼려면 PAGES 만 고치면 됩니다.
// =====================================================================
export const PAGES = [
  { name: '이용방법 (접수 방법·순서)', url: 'https://www.bamnatdelivery.com/m3.html', max: 3500 },
  { name: '요금안내', url: 'https://www.bamnatdelivery.com/m2.html', max: 3000 },
  { name: '서비스안내', url: 'https://www.bamnatdelivery.com/mm.html', max: 2500 },
  { name: '한집만 사입', url: 'https://www.bamnatdelivery.com/1jip.html', max: 1200 },
  { name: '도매물류전담', url: 'https://www.bamnatdelivery.com/dome.html', max: 1200 },
  { name: '새 홈페이지 첫 화면 (bamnat1.dothome.co.kr)', url: 'https://bamnat1.dothome.co.kr/', max: 1500 },
  { name: '새 홈페이지 자주 묻는 질문', url: 'https://bamnat1.dothome.co.kr/faq.html', max: 2500 },
];

const KEEP_MS = 6 * 60 * 60 * 1000;   // 6시간
const TIMEOUT_MS = 3000;              // 한 페이지 최대 3초 기다림
const memo = new Map();               // url → { text, at }

// 옛 접수 방법(구글폼) 줄은 빼기
const OLD_LINE = /forms\.gle|구글\s*폼|google\s*form/i;

export function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, ' ')
    // 화면에 안 보이게 숨긴 요소(hidden, display:none)는 통째로 빼기 (안쪽에 같은 태그가 또 있으면 그 부분까지만)
    .replace(/<(\w+)\b[^>]*(?:\shidden(?=[\s>=])|display\s*:\s*none)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) =>
      /^https?:/i.test(href) && !inner.includes(href) ? `${inner} (${href}) ` : `${inner} `)
    .replace(/<\/?(br|p|div|li|ul|ol|h[1-6]|tr|table|section|article|header|footer|nav|dt|dd|summary|details|figure|figcaption)\b[^>]*>/gi, '\n')
    .replace(/<\/?(td|th)\b[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&middot;/g, '·')
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n));
  return s.split('\n')
    .map(l => l.replace(/[ \t ]+/g, ' ').replace(/^[\s|]+|[\s|]+$/g, '').trim())
    .filter(l => l && !OLD_LINE.test(l))
    .join('\n');
}

async function readPage(p) {
  const old = memo.get(p.url);
  if (old && Date.now() - old.at < KEEP_MS) return old.text;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    const res = await fetch(p.url, {
      signal: ctl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (bamnat-ai-helper)', Accept: 'text/html' },
      cf: { cacheTtl: 6 * 60 * 60, cacheEverything: true },
    }).finally(() => clearTimeout(t));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = htmlToText(await res.text());
    memo.set(p.url, { text, at: Date.now() });
    return text;
  } catch (e) {
    console.log('site_pages: read failed', p.url, e.message);
    if (old) { old.at = Date.now() - KEEP_MS + 10 * 60 * 1000; return old.text; } // 10분 뒤 다시 시도
    return '';
  }
}

// AI 에게 줄 글: 페이지마다 제목을 붙이고, 앞 페이지에 이미 나온 줄(메뉴·바닥글 등)은 빼서 짧게.
export async function loadSitePages() {
  const texts = await Promise.all(PAGES.map(readPage));
  const seen = new Set();
  const parts = [];
  PAGES.forEach((p, i) => {
    const lines = texts[i].split('\n').filter(l => {
      if (l.length < 2 || seen.has(l)) return false;
      seen.add(l);
      return true;
    });
    const body = lines.join('\n').slice(0, p.max);
    if (body) parts.push(`## ${p.name} — ${p.url}\n${body}`);
  });
  return parts.join('\n\n');
}
