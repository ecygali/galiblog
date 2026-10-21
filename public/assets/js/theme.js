// 只有两套：白与黑

const LIGHT = { bg: '#fbfbfa', bg2: '#f1f1ef', fg: '#141414', fg2: '#555553', fg3: '#9a9a97', line: '#e3e3e0', dark: false };
const DARK = { bg: '#0d0d0d', bg2: '#171717', fg: '#e9e9e7', fg2: '#a1a19e', fg3: '#636361', line: '#262626', dark: true };

// 访客自己的选择优先；否则用站点默认（auto 表示跟随系统）
export function currentMode() {
  try { return localStorage.getItem('gali:mode') || 'auto'; } catch { return 'auto'; }
}

let siteDefault = 'auto';
function applyMode(mode) {
  const m = mode === 'auto' ? siteDefault : mode;
  if (m === 'auto') delete document.documentElement.dataset.mode;
  else document.documentElement.dataset.mode = m;
}

export function setMode(mode) {
  try {
    if (mode === 'auto') localStorage.removeItem('gali:mode');
    else localStorage.setItem('gali:mode', mode);
  } catch {}
  applyMode(mode);
}

const vars = (p) => `--bg:${p.bg};--bg-2:${p.bg2};--fg:${p.fg};--fg-2:${p.fg2};--fg-3:${p.fg3};--line:${p.line};color-scheme:${p.dark ? 'dark' : 'light'};`;

export function themeCss(s) {
  const common = `--fs:${s.fontSize || 17}px;--body-font:var(--${s.bodyFont === 'sans' ? 'sans' : 'serif'});`;
  return `:root{${common}${vars(LIGHT)}}`
    + `@media (prefers-color-scheme: dark){:root:not([data-mode="day"]){${vars(DARK)}}}`
    + `:root[data-mode="night"]{${vars(DARK)}}`;
}

let fontsLoaded = false;
export function applyTheme(s) {
  const css = themeCss(s);
  document.getElementById('theme-vars').textContent = css;
  try { localStorage.setItem('gali:theme-css', css); } catch {}

  siteDefault = s.defaultMode === 'day' || s.defaultMode === 'night' ? s.defaultMode : 'auto';
  try { localStorage.setItem('gali:site-mode', siteDefault); } catch {}
  applyMode(currentMode());

  let custom = document.getElementById('custom-css');
  if (!custom) {
    custom = document.createElement('style');
    custom.id = 'custom-css';
    document.head.appendChild(custom);
  }
  custom.textContent = s.customCss || '';

  document.documentElement.classList.toggle('vertical-title', !!s.verticalTitle);

  if (s.webFonts && !fontsLoaded) {
    fontsLoaded = true;
    const pre = document.createElement('link');
    pre.rel = 'preconnect';
    pre.href = 'https://fonts.gstatic.com';
    pre.crossOrigin = '';
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..700&family=JetBrains+Mono:wght@400;600&family=Noto+Serif+SC:wght@400;600;900&display=swap';
    document.head.append(pre, link);
  }

  const ch = (s.favicon || '').trim();
  if (ch) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#141414"/>`
      + `<text x="32" y="44" font-family="Georgia,serif" font-size="36" text-anchor="middle" fill="#fbfbfa">${ch.replace(/[<&>"]/g, '')}</text></svg>`;
    document.querySelector('link[rel="icon"]').href = 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
}

let headInjected = false;
export function injectCustomHead(html) {
  if (headInjected || !html) return;
  headInjected = true;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  for (const node of tpl.content.childNodes) {
    if (node.nodeName === 'SCRIPT') {
      // innerHTML 插入的 <script> 不会执行，要重新创建
      const s = document.createElement('script');
      for (const a of node.attributes) s.setAttribute(a.name, a.value);
      s.textContent = node.textContent;
      document.head.appendChild(s);
    } else {
      document.head.appendChild(node.cloneNode(true));
    }
  }
}
