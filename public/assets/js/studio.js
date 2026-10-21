// 工作室：帖子管理、媒体库、站点设置

import { api } from './api.js';
import { state, navigate, refreshSettings } from './app.js';
import { applyTheme } from './theme.js';
import { esc, $, $$, icon, toast, unlock, withAuth, confirmBox, fmtDate, relTime } from './ui.js';
import { mediaGrid } from './media.js';

const TYPE_NAME = { essay: '文章', note: '碎片', page: '页面' };
const STATUS_NAME = { published: '公开', hidden: '隐藏', draft: '草稿' };

export async function studioView(tab) {
  document.title = '工作室 · ' + state.settings.title;
  applyTheme(state.settings);
  if (!state.admin) {
    $('#app').innerHTML = '<div class="ed-locked"></div>';
    if (!(await unlock())) return navigate('/', { replace: true });
    state.admin = true;
  }
  $('#app').innerHTML = `
    <div class="studio">
      <header class="st-top">
        <a class="st-brand" href="/">${esc(state.settings.title)}<small>工作室</small></a>
        <nav class="st-tabs">
          <a href="/studio/posts" data-tab="posts">帖子</a>
          <a href="/studio/media" data-tab="media">媒体</a>
          <a href="/studio/settings" data-tab="settings">设置</a>
        </nav>
        <div class="st-acts">
          <a class="btn solid" href="/write">${icon('pen', 16)} 写文章</a>
          <button class="btn ghost st-logout">上锁</button>
        </div>
      </header>
      <main class="st-main"></main>
    </div>`;
  $$('.st-tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  $('.st-logout').onclick = async () => {
    await api.post('/auth/logout').catch(() => {});
    state.admin = false;
    toast('已上锁');
    navigate('/');
  };
  const main = $('.st-main');
  if (tab === 'media') return mediaTab(main);
  if (tab === 'settings') return settingsTab(main);
  return postsTab(main);
}

// ---------- 帖子 ----------

async function postsTab(main) {
  main.innerHTML = `
    <section class="quick">
      <textarea placeholder="随手记一条碎片……（Ctrl+Enter 发出）" rows="2"></textarea>
      <div class="quick-bar"><span class="muted">碎片不需要标题，会直接出现在首页的流里。</span><button class="btn solid tiny">发出</button></div>
    </section>
    <div class="st-filters">
      <div class="seg">
        <button data-f="">全部</button><button data-f="essay">文章</button><button data-f="note">碎片</button>
        <button data-f="page">页面</button><button data-f="draft">草稿</button>
      </div>
      <input class="st-search" placeholder="搜索标题或正文">
      <a class="btn ghost tiny" href="/write?type=page">${icon('plus', 14)} 新页面</a>
    </div>
    <div class="st-list"><p class="muted">载入中…</p></div>`;

  const quick = $('.quick textarea', main);
  const send = async () => {
    const content = quick.value.trim();
    if (!content) return;
    try {
      await withAuth(() => api.post('/posts', { type: 'note', content, status: 'published' }));
      quick.value = '';
      toast('已发出');
      load();
    } catch (e) { toast(e.message, 'error'); }
  };
  $('.quick button', main).onclick = send;
  quick.onkeydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') send(); };
  quick.oninput = () => { quick.style.height = 'auto'; quick.style.height = quick.scrollHeight + 'px'; };

  let filter = '';
  let posts = [];
  const list = $('.st-list', main);
  const draw = () => {
    const kw = $('.st-search', main).value.trim().toLowerCase();
    const rows = posts.filter((p) =>
      (!filter || (filter === 'draft' ? p.status === 'draft' : p.type === filter))
      && (!kw || (p.title + ' ' + p.excerpt).toLowerCase().includes(kw)));
    list.innerHTML = rows.length ? `
      <table class="st-table">
        <thead><tr><th>标题</th><th>类型</th><th>状态</th><th>发布</th><th class="num">字</th><th class="num">阅读</th><th></th></tr></thead>
        <tbody>${rows.map((p) => `
          <tr data-id="${p.id}">
            <td class="t-title"><a href="/write/${p.id}">${p.pinned ? '<span class="pin">✦</span>' : ''}${esc(p.title || p.excerpt.slice(0, 50) || '（空）')}</a>
              ${p.tags.length ? `<span class="t-tags">${p.tags.map((t) => '#' + esc(t)).join(' ')}</span>` : ''}</td>
            <td>${TYPE_NAME[p.type]}</td>
            <td><span class="badge s-${p.status}">${STATUS_NAME[p.status]}</span></td>
            <td title="${fmtDate(p.publishedAt, 'time')}">${fmtDate(p.publishedAt, 'ymd')}<small class="muted"> · 改于 ${relTime(p.updatedAt)}</small></td>
            <td class="num">${p.words ?? ''}</td>
            <td class="num">${p.views || ''}</td>
            <td class="t-acts">
              <a class="icon-btn" href="/p/${encodeURIComponent(p.slug)}" title="查看">${icon('eye', 16)}</a>
              <button class="icon-btn" data-act="pin" title="${p.pinned ? '取消置顶' : '置顶'}">${icon('pin', 16)}</button>
              <button class="icon-btn" data-act="del" title="删除">${icon('trash', 16)}</button>
            </td>
          </tr>`).join('')}</tbody>
      </table>` : '<div class="empty"><p>没有匹配的帖子。</p></div>';
  };
  const load = async () => {
    try {
      const data = await withAuth(() => api.get('/posts?all=1&limit=100'));
      posts = data.posts;
      // 超过 100 篇时继续拉
      for (let page = 2; page <= data.pages; page++) {
        posts = posts.concat((await api.get(`/posts?all=1&limit=100&page=${page}`)).posts);
      }
      draw();
    } catch (e) {
      list.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    }
  };
  $$('.st-filters .seg button', main).forEach((b) => (b.onclick = () => {
    filter = b.dataset.f;
    $$('.st-filters .seg button', main).forEach((x) => x.classList.toggle('on', x === b));
    draw();
  }));
  $('.st-filters .seg button', main).classList.add('on');
  $('.st-search', main).oninput = draw;
  list.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const p = posts.find((x) => x.id === b.closest('tr').dataset.id);
    try {
      if (b.dataset.act === 'pin') {
        const full = await withAuth(() => api.get('/posts/' + p.id));
        await api.put('/posts/' + p.id, { ...full, pinned: !p.pinned });
        p.pinned = !p.pinned;
        draw();
      }
      if (b.dataset.act === 'del') {
        if (!(await confirmBox(`删除「${p.title || p.excerpt.slice(0, 20) || '这条'}」？无法恢复。`, { ok: '删除', danger: true }))) return;
        await withAuth(() => api.del('/posts/' + p.id));
        posts = posts.filter((x) => x !== p);
        draw();
        toast('已删除');
      }
    } catch (err) { toast(err.message, 'error'); }
  };
  load();
}

// ---------- 媒体 ----------

function mediaTab(main) {
  main.innerHTML = '<section class="media media-page"></section>';
  mediaGrid($('.media', main));
}

// ---------- 设置 ----------

async function settingsTab(main) {
  let s = structuredClone(state.settings);
  let health = null;
  try { health = await api.get('/health'); } catch {}

  main.innerHTML = `
    <form class="settings">
      ${health ? `<div class="health">
        <span class="${health.db ? 'ok' : 'bad'}">D1 数据库 ${health.db ? '已连接' : '未绑定'}</span>
        <span class="${health.storage ? 'ok' : 'bad'}">文件存储 ${health.storage === 'r2' ? 'R2' : health.storage === 'kv' ? 'KV' : '未绑定'}${health.storage ? ` · 单个上限 ${Math.round(health.uploadLimit / 1048576)}MB` : ''}</span>
        <span class="ok">口令 已设置</span>
      </div>` : ''}

      <fieldset>
        <legend>名字</legend>
        <div class="grid2">
          <label class="field"><span>站点名</span><input name="title"></label>
          <label class="field"><span>署名</span><input name="author"></label>
          <label class="field"><span>一句话</span><input name="tagline" placeholder="出现在侧栏与浏览器标题"></label>
          <label class="field"><span>图标字符 <i class="muted">一个字或符号</i></span><input name="favicon" maxlength="2"></label>
        </div>
        <label class="field"><span>头像地址 <i class="muted">可以在媒体库上传后复制链接</i></span><input name="avatar" placeholder="/f/… 或 https://…"></label>
      </fieldset>

      <fieldset>
        <legend>自白</legend>
        <label class="field"><span>首页开篇 <i class="muted">Markdown，写什么都行</i></span><textarea name="manifesto" rows="4"></textarea></label>
        <label class="check"><input type="checkbox" name="showHero"><span>在首页显示开篇</span></label>
        <div class="grid2 now-row">
          <label class="field"><span>此刻 · 符号</span><input name="nowEmoji" maxlength="4"></label>
          <label class="field"><span>此刻 · 状态 <i class="muted">留空则不显示</i></span><input name="now"></label>
        </div>
        <label class="field"><span>「关于」页 <i class="muted">Markdown</i></span><textarea name="about" rows="8"></textarea></label>
        <label class="field"><span>页脚</span><input name="footer"></label>
      </fieldset>

      <fieldset>
        <legend>样子</legend>
        <div class="field"><span>默认明暗 <i class="muted">访客也可以在侧栏自己切换</i></span>
          <div class="seg" data-seg="defaultMode">
            <button type="button" data-v="auto">跟随系统</button><button type="button" data-v="day">白</button><button type="button" data-v="night">黑</button>
          </div>
        </div>
        <div class="grid2">
          <div class="field"><span>正文字体</span><div class="seg" data-seg="bodyFont"><button type="button" data-v="serif">衬线 · 宋</button><button type="button" data-v="sans">无衬线 · 黑</button></div></div>
          <label class="field"><span>正文字号 <output class="fs-out"></output></span><input type="range" name="fontSize" min="14" max="22" step="1"></label>
        </div>
        <div class="field"><span>首页排布</span>
          <div class="seg" data-seg="homeLayout">
            <button type="button" data-v="index">${icon('list', 14)} 目录</button>
            <button type="button" data-v="cards">${icon('grid', 14)} 卡片</button>
            <button type="button" data-v="stream">${icon('menu', 14)} 长流</button>
          </div>
        </div>
        <div class="checks">
          <label class="check"><input type="checkbox" name="verticalTitle"><span>站名竖排</span></label>
          <label class="check"><input type="checkbox" name="webFonts"><span>加载网络字体（Google Fonts）</span></label>
        </div>
        <label class="field narrow"><span>每页条数</span><input type="number" name="perPage" min="5" max="100"></label>
      </fieldset>

      <fieldset>
        <legend>导航</legend>
        <div class="pairs" data-list="nav"></div>
        <p class="muted small">站内页面写成 <code>/p/链接名</code>，首页筛选写成 <code>/?tag=标签</code> 或 <code>/?type=note</code>。</p>
      </fieldset>

      <fieldset>
        <legend>别处的我</legend>
        <div class="pairs" data-list="links"></div>
        <p class="muted small">出现在页脚和「关于」页，比如邮箱写 <code>mailto:you@example.com</code>。</p>
      </fieldset>

      <fieldset>
        <legend>更深处</legend>
        <label class="field"><span>自定义 CSS <i class="muted">会在全站生效，可以覆盖任何样式</i></span><textarea name="customCss" rows="6" class="mono" spellcheck="false" placeholder=":root { --measure: 38em; }\n.post-title { letter-spacing: -0.04em; }"></textarea></label>
        <label class="field"><span>插入 &lt;head&gt; 的 HTML <i class="muted">统计脚本、验证标签等，刷新后生效</i></span><textarea name="customHead" rows="4" class="mono" spellcheck="false"></textarea></label>
      </fieldset>

      <div class="save-bar"><span class="muted save-hint">改动会立即预览，保存后对所有人生效。</span>
        <button type="button" class="btn ghost" data-act="reset">撤回</button><button class="btn solid">保存</button></div>
    </form>`;

  const form = $('.settings', main);
  const fill = () => {
    for (const el of form.elements) {
      if (!el.name || !(el.name in s)) continue;
      if (el.type === 'checkbox') el.checked = !!s[el.name];
      else if (el.type === 'radio') el.checked = s[el.name] === el.value;
      else el.value = s[el.name];
    }
    $$('[data-seg]', form).forEach((seg) => $$('button', seg).forEach((b) => b.classList.toggle('on', s[seg.dataset.seg] === b.dataset.v)));
    $('.fs-out', form).textContent = s.fontSize + 'px';
    drawPairs('nav');
    drawPairs('links');
  };

  const drawPairs = (key) => {
    const box = $(`[data-list="${key}"]`, form);
    box.innerHTML = s[key].map((x, i) => `
      <div class="pair" data-i="${i}">
        <input data-k="label" value="${esc(x.label)}" placeholder="名字">
        <input data-k="href" value="${esc(x.href)}" placeholder="链接">
        <button type="button" class="icon-btn" data-move="-1" title="上移">↑</button>
        <button type="button" class="icon-btn" data-remove title="删除">${icon('close', 14)}</button>
      </div>`).join('') + `<button type="button" class="btn ghost tiny" data-add>${icon('plus', 14)} 添加</button>`;
  };

  const live = () => applyTheme(s);

  form.addEventListener('input', (e) => {
    const el = e.target;
    const pair = el.closest('.pair');
    if (pair) {
      const key = pair.parentElement.dataset.list;
      s[key][+pair.dataset.i][el.dataset.k] = el.value;
      return;
    }
    if (!el.name || !(el.name in s)) return;
    if (el.type === 'checkbox') s[el.name] = el.checked;
    else if (el.type === 'number' || el.type === 'range') s[el.name] = +el.value;
    else s[el.name] = el.value;
    if (el.name === 'fontSize') $('.fs-out', form).textContent = el.value + 'px';
    live();
  });

  form.addEventListener('click', (e) => {
    const segBtn = e.target.closest('[data-seg] button');
    if (segBtn) {
      const seg = segBtn.closest('[data-seg]');
      s[seg.dataset.seg] = segBtn.dataset.v;
      $$('button', seg).forEach((b) => b.classList.toggle('on', b === segBtn));
      live();
    }
    const list = e.target.closest('[data-list]');
    if (list) {
      const key = list.dataset.list;
      if (e.target.closest('[data-add]')) { s[key].push({ label: '', href: '' }); drawPairs(key); $$('.pair input', list).at(-2)?.focus(); }
      const rm = e.target.closest('[data-remove]');
      if (rm) { s[key].splice(+rm.closest('.pair').dataset.i, 1); drawPairs(key); }
      const mv = e.target.closest('[data-move]');
      if (mv) {
        const i = +mv.closest('.pair').dataset.i;
        if (i > 0) { [s[key][i - 1], s[key][i]] = [s[key][i], s[key][i - 1]]; drawPairs(key); }
      }
    }
    if (e.target.closest('[data-act="reset"]')) {
      s = structuredClone(state.settings);
      fill();
      live();
      toast('已撤回到上次保存的样子');
    }
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('.save-bar .solid', form);
    btn.disabled = true;
    try {
      const next = await withAuth(() => api.put('/settings', s));
      refreshSettings(next);
      s = structuredClone(next);
      toast('已保存');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  };

  fill();
}
