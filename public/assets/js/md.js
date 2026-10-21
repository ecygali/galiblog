// Markdown 渲染：GFM + 若干扩展
//   ==高亮==   ||黑幕||   {汉字|hàn zì}（注音）   [^1] 脚注
//   ::: note / tip / warn / danger [标题]   ::: details 标题   ::: center   ::: right   ::: wide   ::: aside
//   ![说明](视频或音频地址) 自动变成播放器；连续多张图自动拼成画廊

import { Marked } from '/assets/vendor/marked.esm.js';

const MEDIA_VIDEO = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;
const MEDIA_AUDIO = /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus)(\?|#|$)/i;
const CALLOUTS = { note: '注', tip: '提示', warn: '留意', danger: '警告', quote: '引' };

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function headingId(text, used) {
  let id = String(text).toLowerCase().trim()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'section';
  let n = 1;
  const base = id;
  while (used.has(id)) id = `${base}-${++n}`;
  used.add(id);
  return id;
}

let state = { ids: new Set(), notes: new Map(), order: [] };

const container = {
  name: 'container',
  level: 'block',
  start(src) { return src.match(/^:::/m)?.index; },
  tokenizer(src) {
    const m = /^:::[ \t]*([\w-]+)[ \t]*([^\n]*)\n([\s\S]*?)\n:::[ \t]*(?:\n+|$)/.exec(src);
    if (!m) return;
    return {
      type: 'container',
      raw: m[0],
      kind: m[1].toLowerCase(),
      arg: m[2].trim(),
      tokens: this.lexer.blockTokens(m[3], []),
    };
  },
  renderer(t) {
    const body = this.parser.parse(t.tokens);
    const arg = escapeHtml(t.arg);
    if (t.kind === 'details') return `<details class="md-details"><summary>${arg || '展开'}</summary><div>${body}</div></details>`;
    if (CALLOUTS[t.kind]) {
      return `<div class="callout callout-${t.kind}"><div class="callout-title">${arg || CALLOUTS[t.kind]}</div>${body}</div>`;
    }
    if (t.kind === 'center' || t.kind === 'right') return `<div class="align-${t.kind}">${body}</div>`;
    if (t.kind === 'wide') return `<div class="bleed">${body}</div>`;
    if (t.kind === 'aside') return `<aside class="marginal">${body}</aside>`;
    return `<div class="md-${escapeHtml(t.kind)}">${body}</div>`;
  },
};

function inlinePair(name, mark, tag, cls) {
  const re = new RegExp(`^${mark}(?=\\S)([\\s\\S]*?\\S)${mark}`);
  return {
    name,
    level: 'inline',
    start(src) { return src.indexOf(mark.replace(/\\/g, '')); },
    tokenizer(src) {
      const m = re.exec(src);
      if (m) return { type: name, raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
    },
    renderer(t) {
      return `<${tag}${cls ? ` class="${cls}"` : ''}>${this.parser.parseInline(t.tokens)}</${tag}>`;
    },
  };
}

const ruby = {
  name: 'ruby',
  level: 'inline',
  start(src) { return src.indexOf('{'); },
  tokenizer(src) {
    const m = /^\{([^{}|\n]+)\|([^{}\n]+)\}/.exec(src);
    if (m) return { type: 'ruby', raw: m[0], base: m[1], rt: m[2] };
  },
  renderer(t) { return `<ruby>${escapeHtml(t.base)}<rp>(</rp><rt>${escapeHtml(t.rt)}</rt><rp>)</rp></ruby>`; },
};

const footnoteRef = {
  name: 'fnref',
  level: 'inline',
  start(src) { return src.indexOf('[^'); },
  tokenizer(src) {
    const m = /^\[\^([^\]\s]+)\]/.exec(src);
    if (m && state.notes.has(m[1])) return { type: 'fnref', raw: m[0], id: m[1] };
  },
  renderer(t) {
    let n = state.order.indexOf(t.id) + 1;
    if (!n) { state.order.push(t.id); n = state.order.length; }
    const id = encodeURIComponent(t.id);
    return `<sup class="fnref"><a href="#fn-${id}" id="fnref-${id}">${n}</a></sup>`;
  },
};

const renderer = {
  heading({ tokens, depth }) {
    const html = this.parser.parseInline(tokens);
    const id = headingId(html, state.ids);
    return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">§</a>${html}</h${depth}>\n`;
  },
  code({ text, lang }) {
    const l = (lang || '').trim().split(/\s+/)[0];
    const cls = l ? ` class="language-${escapeHtml(l)}"` : '';
    return `<div class="code"><div class="code-bar"><span>${escapeHtml(l || 'text')}</span><button type="button" class="code-copy">复制</button></div><pre><code${cls}>${escapeHtml(text)}</code></pre></div>\n`;
  },
  image({ href, title, text }) {
    const src = escapeHtml(href);
    const t = title ? ` title="${escapeHtml(title)}"` : '';
    if (MEDIA_VIDEO.test(href)) return `<video controls preload="metadata" playsinline src="${src}"${t}></video>`;
    if (MEDIA_AUDIO.test(href)) return `<audio controls preload="metadata" src="${src}"${t}></audio>`;
    return `<img src="${src}" alt="${escapeHtml(text)}"${t} loading="lazy" decoding="async">`;
  },
  link({ href, title, tokens }) {
    const inner = this.parser.parseInline(tokens);
    const t = title ? ` title="${escapeHtml(title)}"` : '';
    const h = escapeHtml(href);
    if (/^\/f\//.test(href)) {
      const name = decodeURIComponent(href.split('/').pop() || '');
      const ext = (name.match(/\.(\w{1,6})$/) || [, 'file'])[1].toUpperCase();
      return `<a class="attach" href="${h}" target="_blank"${t}><span class="attach-ext">${escapeHtml(ext)}</span><span class="attach-name">${inner}</span><span class="attach-dl">↓</span></a>`;
    }
    const external = /^https?:\/\//.test(href) && !href.startsWith(location.origin);
    return `<a href="${h}"${t}${external ? ' target="_blank" rel="noopener"' : ''}>${inner}</a>`;
  },
  table(token) {
    // 用默认渲染，再套一层可横向滚动的容器
    return `<div class="table-wrap">${this.constructor.prototype.table.call(this, token)}</div>`;
  },
};

const md = new Marked({ gfm: true, breaks: true });
md.use({
  extensions: [container, inlinePair('mark', '==', 'mark'), inlinePair('spoiler', '\\|\\|', 'span', 'spoiler'), ruby, footnoteRef],
  renderer,
});

const PURIFY = {
  ADD_TAGS: ['iframe', 'video', 'audio', 'source', 'details', 'summary', 'ruby', 'rt', 'rp', 'mark', 'aside', 'figure', 'figcaption'],
  ADD_ATTR: ['target', 'allow', 'allowfullscreen', 'frameborder', 'controls', 'loading', 'preload', 'playsinline', 'decoding', 'align', 'start'],
};

export function render(src) {
  state = { ids: new Set(), notes: new Map(), order: [] };
  const text = String(src || '').replace(/^\[\^([^\]\s]+)\]:[ \t]+(.+)$/gm, (_, id, body) => {
    state.notes.set(id, body);
    return '';
  });
  let html = md.parse(text, { async: false });
  if (state.order.length) {
    html += '<section class="footnotes"><ol>' + state.order.map((id) => {
      const eid = encodeURIComponent(id);
      return `<li id="fn-${eid}">${md.parseInline(state.notes.get(id), { async: false })} <a href="#fnref-${eid}" class="fnback">↩</a></li>`;
    }).join('') + '</ol></section>';
  }
  return window.DOMPurify ? window.DOMPurify.sanitize(html, PURIFY) : html;
}

export function renderInline(src) {
  const html = md.parseInline(String(src || ''), { async: false });
  return window.DOMPurify ? window.DOMPurify.sanitize(html, PURIFY) : html;
}

export function plainText(src) {
  const div = document.createElement('div');
  div.innerHTML = render(src);
  return div.textContent || '';
}

export function readingStats(src) {
  const text = String(src || '');
  const cjk = (text.match(/[㐀-鿿豈-﫿぀-ヿ가-힯]/g) || []).length;
  const latin = (text.replace(/[㐀-鿿豈-﫿぀-ヿ가-힯]/g, ' ').match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
  const words = cjk + latin;
  return { words, minutes: Math.max(1, Math.round(cjk / 400 + latin / 220)) };
}

let hljsPromise = null;
function loadHljs() {
  if (window.hljs) return Promise.resolve(window.hljs);
  if (!hljsPromise) {
    hljsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/assets/vendor/highlight.min.js';
      s.onload = () => resolve(window.hljs);
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  return hljsPromise;
}

// 渲染后的 DOM 加工：代码高亮、图片成组、灯箱、表格、视频嵌入
export function enhance(root, { lightbox = true } = {}) {
  const blocks = root.querySelectorAll('pre code');
  if (blocks.length) {
    loadHljs().then((hljs) => {
      blocks.forEach((el) => {
        if (el.dataset.highlighted) return;
        const lang = (el.className.match(/language-([\w+#-]+)/) || [])[1];
        if (lang && !hljs.getLanguage(lang)) el.classList.add('nohighlight');
        try { hljs.highlightElement(el); } catch {}
      });
    }).catch(() => {});
  }

  root.querySelectorAll('.code-copy').forEach((btn) => {
    btn.onclick = async () => {
      const code = btn.closest('.code').querySelector('code').textContent;
      try {
        await navigator.clipboard.writeText(code);
        btn.textContent = '已复制';
      } catch {
        btn.textContent = '复制失败';
      }
      setTimeout(() => (btn.textContent = '复制'), 1400);
    };
  });

  // 只装着图片/视频的段落 → figure 或画廊
  root.querySelectorAll('p').forEach((p) => {
    const media = [...p.children].filter((c) => /^(IMG|VIDEO|AUDIO)$/.test(c.tagName));
    const onlyMedia = media.length && [...p.childNodes].every((n) =>
      (n.nodeType === 1 && (/^(IMG|VIDEO|AUDIO|BR)$/.test(n.tagName))) || (n.nodeType === 3 && !n.textContent.trim()));
    if (!onlyMedia) return;
    if (media.length === 1) {
      const el = media[0];
      const fig = document.createElement('figure');
      fig.appendChild(el);
      const caption = el.getAttribute('title') || (el.alt && !/\.\w{2,5}$/.test(el.alt) ? el.alt : '');
      if (caption) {
        const fc = document.createElement('figcaption');
        fc.textContent = caption;
        fig.appendChild(fc);
      }
      p.replaceWith(fig);
    } else {
      const g = document.createElement('div');
      g.className = 'gallery';
      g.dataset.count = Math.min(media.length, 4);
      media.forEach((m) => g.appendChild(m));
      p.replaceWith(g);
    }
  });

  root.querySelectorAll('iframe').forEach((f) => {
    if (f.parentElement.classList.contains('embed')) return;
    const w = document.createElement('div');
    w.className = 'embed';
    f.replaceWith(w);
    w.appendChild(f);
    f.setAttribute('loading', 'lazy');
  });

  root.querySelectorAll('.spoiler').forEach((s) => {
    s.tabIndex = 0;
    s.onclick = () => s.classList.toggle('open');
  });

  root.querySelectorAll('input[type=checkbox]').forEach((c) => (c.disabled = true));

  if (lightbox) {
    root.querySelectorAll('img').forEach((img) => {
      if (img.closest('a')) return;
      img.classList.add('zoomable');
      img.onclick = () => openLightbox(img);
    });
  }
}

function openLightbox(img) {
  const box = document.createElement('div');
  box.className = 'lightbox';
  const big = document.createElement('img');
  big.src = img.currentSrc || img.src;
  big.alt = img.alt;
  box.appendChild(big);
  const cap = img.getAttribute('title') || '';
  if (cap) {
    const c = document.createElement('div');
    c.className = 'lightbox-cap';
    c.textContent = cap;
    box.appendChild(c);
  }
  const close = () => {
    box.classList.remove('show');
    setTimeout(() => box.remove(), 220);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  box.onclick = close;
  document.addEventListener('keydown', onKey);
  document.body.appendChild(box);
  requestAnimationFrame(() => box.classList.add('show'));
}
