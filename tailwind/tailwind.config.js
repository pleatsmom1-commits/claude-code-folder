// 화면 꾸밈(디자인) 파일 tailwind.css 를 만드는 설정입니다.
// 화면 파일(*.html, *.js)에 새 꾸밈 이름(class)을 쓰면 아래 명령으로 tailwind.css 를 다시 만들어 주세요.
//   npx tailwindcss@3.4.19 -c tailwind/tailwind.config.js -i tailwind/input.css -o tailwind.css --minify
const colors = 'slate|gray|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
module.exports = {
  content: ['./*.html', './*.js'],
  // 글자를 이어 붙여 만드는 색 이름(예: bg-${color}-50)은 자동으로 못 찾으므로 미리 넣어 둡니다
  safelist: [
    { pattern: new RegExp(`^(bg|text|border|ring)-(${colors})-(50|100|200|300|400|500|600|700|800)$`), variants: ['hover'] },
  ],
};
