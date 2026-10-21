// 入口：启动、路由、公共页面

import { api } from './api.js';
import { applyTheme, injectCustomHead, currentMode, setMode } from './theme.js';
import { render, renderInline, enhance, readingStats } from './md.js';
import { esc, $, $$, fmtDate, relTime, icon, toast } from './ui.js';

export const state = { settings: null, admin: false, tags: null };

const TYPE_NAME = { essay: '文章', note: '碎片', page: '页面' };

// ---------- 启动 ----------

async function boot() {
  try {
    const [settings, me] = await Promise.all([api.get('/settings'), api.get('/auth/me')]);
    state.settings = settings;
    state.admin = me.admin;
  } catch (e) {
    return renderSetup(e);
  }
  applyTheme(state.settings);
  injectCustomHead(state.settings.customHead);
  document.addEventListener('click', onLinkClick);
  window.addEventListener('popstate', () => route());
  window.addEventListener('scroll', onScroll, { passive: true });
  route();
}

export function refreshSettings(next) {
  state.settings = next;
  applyTheme(next);
}

function renderSetup(err) {
  $('#app').innerHTML = `
    <div class="setup">
      <h1>还差一步</h1>
      <p class="muted">${esc(err.message)}</p>
      <ol>
        <li>在 Cloudflare 控制台创建一个 <b>D1 数据库</b>，到 Pages 项目 → 设置 → 绑定，添加 D1 绑定，变量名 <code>DB</code>。</li>
        <li>（上传需要）创建一个 <b>R2 存储桶</b> 绑定为 <code>FILES</code>；或者一个 <b>KV 命名空间</b> 绑定为 <code>FILES_KV</code>。</li>
        <li>在 设置 → 变量和机密 里添加 <code>ADMIN_PASSWORD</code>（发帖口令），类型选「密钥」。</li>
        <li>重新部署一次。表会在第一次访问时自动建好。</li>
      </ol>
    </div>`;
}

// ---------- 路由 ----------

export function navigate(to, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  route();
}

function onLinkClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a');
  if (!a || a.target || a.hasAttribute('download')) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return;
  if (/^\/(f|api)\//.test(url.pathname) || url.pathname === '/feed.xml') return;
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
  e.preventDefault();
  navigate(url.pathname + url.search + url.hash);
}

let leaveGuard = null;
export function setLeaveGuard(fn) { leaveGuard = fn; }

let currentPath = null;
async function route() {
  const path = decodeURI(location.pathname);
  const params = new URLSearchParams(location.search);

  if (leaveGuard && currentPath && currentPath !== location.pathname + location.search) {
    if (!leaveGuard()) {
      history.pushState(null, '', currentPath);
      return;
    }
  }
  leaveGuard = null;
  currentPath = location.pathname + location.search;
  document.documentElement.classList.remove('nav-open');

  let m;
  if (path === '/write' || (m = path.match(/^\/write\/(.+)$/))) {
    const { editorView } = await import('./editor.js');
    return editorView(m ? m[1] : null);
  }
  if (path === '/studio' || path.startsWith('/studio/')) {
    const { studioView } = await import('./studio.js');
    return studioView(path.split('/')[2] || 'posts');
  }

  shell();
  const view = $('#view');
  view.classList.add('leaving');
  try {
    if (path === '/') await homeView(view, params);
    else if ((m = path.match(/^\/p\/(.+)$/))) await postView(view, m[1]);
    else if (path === '/archive') await archiveView(view);
    else if (path === '/about') aboutView(view);
    else if ((m = path.match(/^\/tag\/(.+)$/))) { navigate('/?tag=' + encodeURIComponent(m[1]), { replace: true }); return; }
    else notFound(view);
  } catch (e) {
    if (e.status === 404) notFound(view);
    else view.innerHTML = `<div class="empty"><p>出错了：${esc(e.message)}</p></div>`;
  }
  view.classList.remove('leaving');
  markNav();
  if (location.hash) {
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) target.scrollIntoView();
  } else window.scrollTo(0, 0);
  onScroll();
}

function setTitle(t) {
  const site = state.settings.title;
  document.title = t ? `${t} · ${site}` : `${site}${state.settings.tagline ? ' — ' + state.settings.tagline : ''}`;
}

// ---------- 外壳：左侧书脊 + 主栏 ----------

function shell() {
  if ($('#view')) return refreshSpine();
  const s = state.settings;
  applyTheme(s);
  $('#app').innerHTML = `
    <div class="shell">
      <aside class="spine">
        <div class="spine-top">
          <a class="brand" href="/"><span class="brand-title">${esc(s.title)}</span></a>
          <button class="icon-btn nav-toggle" aria-label="菜单">${icon('menu')}</button>
        </div>
        <div class="spine-body">
          ${s.tagline ? `<p class="tagline">${esc(s.tagline)}</p>` : ''}
          <nav class="nav">${s.nav.map((n) => `<a href="${esc(n.href)}">${esc(n.label)}</a>`).join('')}</nav>
          ${s.now ? `<div class="now" title="此刻"><span class="now-emoji">${esc(s.nowEmoji || '●')}</span><span>${esc(s.now)}</span></div>` : ''}
          <div class="spine-tools">
            <button class="icon-btn mode-btn" aria-label="切换明暗"></button>
            <a class="icon-btn" href="/feed.xml" aria-label="RSS" target="_blank">${icon('rss')}</a>
            <span class="admin-tools"></span>
          </div>
        </div>
      </aside>
      <main class="main">
        <div id="view" class="view"></div>
        <footer class="colophon">
          <div class="colophon-text">${renderInline(s.footer || '')}</div>
          <div class="colophon-meta">
            <span>© ${new Date().getFullYear()} ${esc(s.author || s.title)}</span>
            ${s.links.map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener me">${esc(l.label)}</a>`).join('')}
            <a href="/write" class="quill" title="落笔" aria-label="写">✎</a>
          </div>
        </footer>
      </main>
      <button class="to-top icon-btn" aria-label="回到顶部">${icon('arrowUp')}</button>
    </div>`;
  $('.nav-toggle').onclick = () => document.documentElement.classList.toggle('nav-open');
  $('.mode-btn').onclick = cycleMode;
  $('.to-top').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  refreshSpine();
}

function refreshSpine() {
  const mode = currentMode();
  const btn = $('.mode-btn');
  if (btn) {
    btn.innerHTML = icon(mode === 'day' ? 'sun' : mode === 'night' ? 'moon' : 'auto');
    btn.title = { auto: '跟随', day: '白', night: '黑' }[mode];
  }
  const tools = $('.admin-tools');
  if (tools) {
    tools.innerHTML = state.admin
      ? `<a class="icon-btn" href="/write" title="写点什么">${icon('pen')}</a><a class="icon-btn" href="/studio" title="工作室">${icon('sliders')}</a>`
      : '';
  }
}

function cycleMode() {
  const order = ['auto', 'day', 'night'];
  const next = order[(order.indexOf(currentMode()) + 1) % 3];
  setMode(next);
  refreshSpine();
  toast({ auto: '跟随', day: '白', night: '黑' }[next]);
}

function markNav() {
  const here = location.pathname + location.search;
  $$('.nav a').forEach((a) => {
    const href = a.getAttribute('href');
    a.classList.toggle('active', href === here || (href !== '/' && href.split('?')[0] !== '/' && location.pathname.startsWith(href)));
  });
}

let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    const top = $('.to-top');
    if (top) top.classList.toggle('show', scrollY > 900);
    const bar = $('#progress');
    const prose = $('.post .prose');
    if (prose && bar) {
      const r = prose.getBoundingClientRect();
      const total = r.height - innerHeight * 0.6;
      const p = Math.min(1, Math.max(0, -r.top / Math.max(1, total)));
      bar.style.transform = `scaleX(${p})`;
      bar.classList.add('on');
    } else if (bar) bar.classList.remove('on');
    const toc = $('.toc');
    if (toc) {
      let active = null;
      $$('.post .prose h2[id], .post .prose h3[id]').forEach((h) => {
        if (h.getBoundingClientRect().top < 120) active = h.id;
      });
      $$('a', toc).forEach((a) => a.classList.toggle('active', a.dataset.id === active));
    }
  });
}

// ---------- 首页 ----------

async function homeView(view, params) {
  const s = state.settings;
  const type = params.get('type') || '';
  const tag = params.get('tag') || '';
  const q = params.get('q') || '';
  const page = Math.max(1, +params.get('page') || 1);
  const qs = new URLSearchParams({ limit: s.perPage, page });
  if (type) qs.set('type', type);
  if (tag) qs.set('tag', tag);
  if (q) qs.set('q', q);
  const [data, tags] = await Promise.all([
    api.get('/posts?' + qs),
    state.tags ? Promise.resolve(state.tags) : api.get('/tags').catch(() => []),
  ]);
  state.tags = tags;
  const filtered = type || tag || q;
  setTitle(tag ? '#' + tag : q ? `搜索：${q}` : type === 'note' ? '碎片' : type === 'essay' ? '文章' : '');

  const hero = s.showHero && !filtered && page === 1 ? heroHtml() : '';
  const link = (patch) => {
    const p = new URLSearchParams({ ...(type && { type }), ...(tag && { tag }), ...(q && { q }), ...patch });
    for (const [k, v] of [...p]) if (!v) p.delete(k);
    const str = p.toString();
    return '/' + (str ? '?' + str : '');
  };

  const filters = `
    <div class="filters">
      <div class="seg">
        <a href="${link({ type: '', page: '' })}" class="${!type ? 'on' : ''}">全部</a>
        <a href="${link({ type: 'essay', page: '' })}" class="${type === 'essay' ? 'on' : ''}">文章</a>
        <a href="${link({ type: 'note', page: '' })}" class="${type === 'note' ? 'on' : ''}">碎片</a>
      </div>
      <form class="search" role="search">
        ${icon('search', 16)}<input name="q" value="${esc(q)}" placeholder="找点什么" aria-label="搜索">
      </form>
    </div>
    ${tags.length ? `<div class="tag-row">${tags.slice(0, 16).map((t) =>
      `<a href="${link({ tag: t.tag === tag ? '' : t.tag, page: '' })}" class="tag${t.tag === tag ? ' on' : ''}">#${esc(t.tag)}<sup>${t.count}</sup></a>`).join('')}</div>` : ''}
    ${filtered ? `<p class="result-line">${q ? `「${esc(q)}」` : ''}${tag ? `#${esc(tag)}` : ''} · ${data.total} 条 <a href="/" class="clear">清除</a></p>` : ''}`;

  const offset = (page - 1) * s.perPage;
  const list = data.posts.length
    ? listHtml(data.posts, s.homeLayout, data.total, offset)
    : `<div class="empty"><p class="empty-mark">∅</p><p>${filtered ? '没有找到。' : '这里还是空白的。'}</p>${state.admin && !filtered ? '<a class="btn solid" href="/write">写下第一篇</a>' : ''}</div>`;

  const pager = data.pages > 1 ? `
    <nav class="pager">
      ${page > 1 ? `<a href="${link({ page: page - 1 > 1 ? page - 1 : '' })}">← 更近的</a>` : '<span></span>'}
      <span class="pager-n">${page} / ${data.pages}</span>
      ${page < data.pages ? `<a href="${link({ page: page + 1 })}">更早的 →</a>` : '<span></span>'}
    </nav>` : '';

  view.innerHTML = `${hero}<section class="home">${filters}${list}${pager}</section>`;
  const form = $('.search', view);
  form.onsubmit = (e) => {
    e.preventDefault();
    navigate(link({ q: form.q.value.trim(), page: '' }));
  };
  $$('.note-body', view).forEach((el) => enhance(el));
}

function heroHtml() {
  const s = state.settings;
  return `
    <section class="hero">
      <div class="manifesto">${render(s.manifesto)}</div>
      <div class="hero-sig">
        ${s.avatar ? `<img class="avatar" src="${esc(s.avatar)}" alt="">` : '<span class="sig-line"></span>'}
        <span class="sig-name">${esc(s.author)}</span>
      </div>
    </section>`;
}

function listHtml(posts, layout, total, offset) {
  if (layout === 'cards') return `<div class="cards">${posts.map(cardHtml).join('')}</div>`;
  if (layout === 'stream') return `<div class="stream">${posts.map((p) => (p.type === 'note' ? noteHtml(p) : streamHtml(p))).join('')}</div>`;
  let year = null;
  return `<div class="index">${posts.map((p, i) => {
    const y = new Date(p.publishedAt).getFullYear();
    const divider = !p.pinned && y !== year ? `<div class="year"><span>${y}</span></div>` : '';
    if (!p.pinned) year = y;
    return divider + (p.type === 'note' ? noteHtml(p) : rowHtml(p, total - offset - i));
  }).join('')}</div>`;
}


function rowHtml(p, n) {
  return `
    <a class="row${p.pinned ? ' pinned' : ''}" href="/p/${encodeURIComponent(p.slug)}">
      <span class="row-no">${p.pinned ? '✦' : String(Math.max(n, 1)).padStart(3, '0')}</span>
      <span class="row-main">
        <span class="row-title">${esc(p.title)}${p.mood ? `<span class="row-mood">${esc(p.mood)}</span>` : ''}</span>
        ${p.excerpt ? `<span class="row-excerpt">${esc(p.excerpt)}</span>` : ''}
      </span>
      <span class="row-date">${fmtDate(p.publishedAt, 'md')}</span>
    </a>`;
}

function noteHtml(p) {
  return `
    <article class="note">
      <div class="note-meta">
        <a href="/p/${encodeURIComponent(p.slug)}" title="${fmtDate(p.publishedAt, 'time')}">${relTime(p.publishedAt)}</a>
        ${p.mood ? `<span>${esc(p.mood)}</span>` : ''}
        ${p.tags.map((t) => `<a class="tag" href="/?tag=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}
      </div>
      ${p.title ? `<h3 class="note-title">${esc(p.title)}</h3>` : ''}
      <div class="note-body prose">${render(p.content || p.excerpt)}</div>
    </article>`;
}

function cardHtml(p) {
  const href = `/p/${encodeURIComponent(p.slug)}`;
  const face = p.cover
    ? `<img src="${esc(p.cover)}" alt="" loading="lazy">`
    : `<span class="card-glyph">${esc((p.title || p.excerpt || '·').trim().slice(0, 1))}</span>`;
  return `
    <a class="card card-${p.type}" href="${href}">
      <span class="card-face${p.cover ? '' : ' bare'}">${face}</span>
      <span class="card-meta">${TYPE_NAME[p.type]} · ${fmtDate(p.publishedAt, 'ymd')}${p.mood ? ' · ' + esc(p.mood) : ''}</span>
      <span class="card-title">${esc(p.title || p.excerpt.slice(0, 40))}</span>
      ${p.title && p.excerpt ? `<span class="card-excerpt">${esc(p.excerpt)}</span>` : ''}
    </a>`;
}

function streamHtml(p) {
  return `
    <article class="stream-item">
      <div class="kicker">${fmtDate(p.publishedAt, 'ymd')}${p.mood ? ' · ' + esc(p.mood) : ''}${p.pinned ? ' · 置顶' : ''}</div>
      <h2><a href="/p/${encodeURIComponent(p.slug)}">${esc(p.title)}</a></h2>
      ${p.cover ? `<a href="/p/${encodeURIComponent(p.slug)}" class="stream-cover"><img src="${esc(p.cover)}" alt="" loading="lazy"></a>` : ''}
      <p class="stream-excerpt">${esc(p.excerpt)}</p>
      <a class="more" href="/p/${encodeURIComponent(p.slug)}">继续读 →</a>
    </article>`;
}

// ---------- 文章页 ----------

async function postView(view, slug) {
  const p = await api.get('/posts/' + encodeURIComponent(slug));
  const stats = readingStats(p.content);
  setTitle(p.title || p.excerpt.slice(0, 24) || '碎片');
  const isPage = p.type === 'page';
  const kicker = isPage ? '' : `
    <div class="kicker">
      <span>${TYPE_NAME[p.type]}</span>
      <time datetime="${new Date(p.publishedAt).toISOString()}">${fmtDate(p.publishedAt)}</time>
      ${p.type === 'essay' ? `<span>${stats.words} 字 · ${stats.minutes} 分钟</span>` : ''}
      ${p.mood ? `<span>${esc(p.mood)}</span>` : ''}
      ${p.status !== 'published' ? `<span class="badge">${p.status === 'draft' ? '草稿' : '隐藏'}</span>` : ''}
    </div>`;
  const nav = (p.prev || p.next) ? `
    <nav class="post-nav">
      ${p.next ? `<a href="/p/${encodeURIComponent(p.next.slug)}" class="pn-next"><small>较新</small><span>${esc(p.next.title || p.next.excerpt.slice(0, 30))}</span></a>` : '<span></span>'}
      ${p.prev ? `<a href="/p/${encodeURIComponent(p.prev.slug)}" class="pn-prev"><small>较早</small><span>${esc(p.prev.title || p.prev.excerpt.slice(0, 30))}</span></a>` : '<span></span>'}
    </nav>` : '';

  view.innerHTML = `
    <article class="post post-${p.type}${p.layout ? ' layout-' + p.layout : ''}">
      <header class="post-head">
        ${kicker}
        ${p.title ? `<h1 class="post-title">${esc(p.title)}</h1>` : ''}
      </header>
      ${p.cover ? `<figure class="post-cover"><img src="${esc(p.cover)}" alt=""></figure>` : ''}
      <div class="prose${p.layout === 'verse' ? ' verse' : ''}">${render(p.content)}</div>
      <footer class="post-foot">
        ${p.tags.length ? `<div class="post-tags">${p.tags.map((t) => `<a class="tag" href="/?tag=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</div>` : ''}
        <div class="post-tools">
          ${p.updatedAt - p.publishedAt > 3600e3 ? `<span>修订于 ${fmtDate(p.updatedAt, 'ymd')}</span>` : ''}
          ${!isPage && p.views ? `<span>${p.views} 次阅读</span>` : ''}
          <button class="linkish copy-link">复制链接</button>
          ${state.admin ? `<a href="/write/${p.id}">编辑</a>` : ''}
        </div>
      </footer>
      ${isPage ? '' : nav}
    </article>`;
  const prose = $('.prose', view);
  enhance(prose);
  $('.copy-link', view).onclick = async (e) => {
    try {
      await navigator.clipboard.writeText(location.origin + location.pathname);
      e.target.textContent = '已复制';
    } catch {
      e.target.textContent = location.href;
    }
  };
  buildToc(view, prose);
}

function buildToc(view, prose) {
  const hs = $$('h2[id], h3[id]', prose);
  if (hs.length < 3) return;
  const toc = document.createElement('aside');
  toc.className = 'toc';
  toc.innerHTML = `<div class="toc-title">目录</div>` + hs.map((h) =>
    `<a href="#${h.id}" data-id="${h.id}" class="toc-${h.tagName.toLowerCase()}">${esc(h.textContent.replace(/^§/, ''))}</a>`).join('');
  view.appendChild(toc);
}

// ---------- 归档 ----------

async function archiveView(view) {
  setTitle('归档');
  const [items, tags] = await Promise.all([api.get('/archive'), api.get('/tags')]);
  state.tags = tags;
  const essays = items.filter((x) => x.type === 'essay');
  const words = items.reduce((n, x) => n + (x.words || 0), 0);
  const groups = new Map();
  for (const it of items) {
    const y = new Date(it.publishedAt).getFullYear();
    if (!groups.has(y)) groups.set(y, []);
    groups.get(y).push(it);
  }
  const max = Math.max(1, ...tags.map((t) => t.count));
  view.innerHTML = `
    <section class="archive">
      <header class="page-head">
        <h1 class="page-title">归档</h1>
        <p class="stats"><span><b>${essays.length}</b> 篇文章</span><span><b>${items.length - essays.length}</b> 条碎片</span><span><b>${words.toLocaleString()}</b> 字</span></p>
      </header>
      ${[...groups].map(([y, list]) => `
        <div class="arch-year">
          <h2 class="arch-y">${y}<sup>${list.length}</sup></h2>
          <ol class="arch-list">
            ${list.map((it) => `
              <li class="arch-item arch-${it.type}">
                <time>${fmtDate(it.publishedAt, 'md')}</time>
                <a href="/p/${encodeURIComponent(it.slug)}">${it.title ? esc(it.title) : `<i>${esc(it.excerpt.slice(0, 60))}</i>`}</a>
                ${it.mood ? `<span class="arch-mood">${esc(it.mood)}</span>` : ''}
              </li>`).join('')}
          </ol>
        </div>`).join('') || '<div class="empty"><p>还没有东西。</p></div>'}
      ${tags.length ? `<div class="cloud"><h2 class="arch-y small">标签</h2>${tags.map((t) =>
        `<a class="tag" style="font-size:${(0.85 + (t.count / max) * 0.9).toFixed(2)}em" href="/?tag=${encodeURIComponent(t.tag)}">#${esc(t.tag)}</a>`).join('')}</div>` : ''}
    </section>`;
}

// ---------- 关于 ----------

function aboutView(view) {
  const s = state.settings;
  setTitle('关于');
  view.innerHTML = `
    <article class="post post-page about">
      ${s.avatar ? `<img class="about-avatar" src="${esc(s.avatar)}" alt="">` : ''}
      <div class="prose">${render(s.about)}</div>
      ${s.links.length ? `<ul class="about-links">${s.links.map((l) => `<li><a href="${esc(l.href)}" target="_blank" rel="noopener me">${esc(l.label)} ↗</a></li>`).join('')}</ul>` : ''}
    </article>`;
  enhance($('.prose', view));
}

function notFound(view) {
  setTitle('不在这里');
  view.innerHTML = `<div class="empty lost"><p class="empty-mark">404</p><p>这一页还没被写出来。</p><a href="/" class="btn ghost">回到开头</a></div>`;
}

boot();
