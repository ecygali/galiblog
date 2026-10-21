// 写作台：Markdown 编辑 + 实时预览 + 上传 + 属性

import { api } from './api.js';
import { state, navigate, setLeaveGuard } from './app.js';
import { applyTheme } from './theme.js';
import { render, enhance, readingStats } from './md.js';
import { esc, $, $$, icon, toast, unlock, withAuth, confirmBox, promptBox, toLocalInput, fmtDate } from './ui.js';
import { uploadMany, markdownFor, mediaLibrary, compressPref, setCompressPref } from './media.js';

const MOODS = ['☀', '☁', '☂', '❄', '☾', '♪', '✦', '◐', '❀', '☕', '✈', '⌁'];
const EMPTY = { id: null, title: '', content: '', type: 'essay', status: 'draft', slug: '', tags: [], cover: '', excerpt: '', mood: '', accent: '', layout: '', pinned: false, publishedAt: 0 };

let post = null;     // 当前编辑对象
let saved = '';      // 最近一次存到服务器的快照
let ed = {};         // DOM 引用

const snapshot = (p) => JSON.stringify({ ...p, updatedAt: undefined, views: undefined, prev: undefined, next: undefined, createdAt: undefined });
const draftKey = () => 'gali:draft:' + (post.id || 'new');
const isDirty = () => snapshot(post) !== saved;

export async function editorView(id) {
  document.title = '落笔 · ' + state.settings.title;
  applyTheme(state.settings);
  if (!state.admin) {
    $('#app').innerHTML = '<div class="ed-locked"></div>';
    const ok = await unlock();
    if (!ok) return navigate('/', { replace: true });
    state.admin = true;
  }

  post = { ...EMPTY };
  if (id) {
    try {
      const p = await withAuth(() => api.get('/posts/' + encodeURIComponent(id)));
      post = { ...EMPTY, ...p };
      delete post.prev;
      delete post.next;
    } catch (e) {
      toast(e.message, 'error');
      return navigate('/studio', { replace: true });
    }
  } else {
    const t = new URLSearchParams(location.search).get('type');
    if (t === 'note' || t === 'page') post.type = t;
  }
  saved = snapshot(post);

  mount();
  restoreLocalDraft();
  fill();
  setLeaveGuard(() => !isDirty() || confirm('还有没保存到服务器的改动（本地有备份），确定离开？'));
  window.onbeforeunload = (e) => {
    if (location.pathname.startsWith('/write') && isDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  api.get('/health').then((h) => {
    if (!h.storage) ed.root.classList.add('no-storage');
  }).catch(() => {});
  api.get('/tags').then((tags) => {
    $('#tag-suggest').innerHTML = tags.map((t) => `<option value="${esc(t.tag)}">`).join('');
  }).catch(() => {});
}

// ---------- 结构 ----------

const TOOLS = [
  ['heading', 'H', '标题', 'heading'],
  ['bold', 'bold', '粗体 Ctrl+B'],
  ['italic', 'italic', '斜体 Ctrl+I'],
  ['strike', 'strike', '删除线'],
  ['underline', 'underline', '下划线'],
  ['mark', 'mark', '高亮 ==文字=='],
  ['color', 'type', '字形：大字 / 小字 / 衬线 / 等宽'],
  ['spoiler', 'spoiler', '黑幕 ||文字||'],
  ['code', 'code', '行内代码 Ctrl+E'],
  '|',
  ['quote', 'quote', '引用'],
  ['ul', 'ul', '无序列表'],
  ['ol', 'ol', '有序列表'],
  ['task', 'task', '待办'],
  ['hr', 'hr', '分隔线'],
  '|',
  ['link', 'link', '链接 Ctrl+K'],
  ['image', 'image', '上传图片 / 视频 / 音频'],
  ['file', 'clip', '上传附件'],
  ['library', 'library', '媒体库'],
  ['table', 'table', '表格'],
  ['codeblock', 'block', '代码块'],
  '|',
  ['callout', 'callout', '提示块 / 折叠 / 对齐'],
  ['ruby', 'ruby', '注音 {汉字|hàn zì}'],
  ['foot', 'foot', '脚注'],
  '|',
  ['undo', 'undo', '撤销 Ctrl+Z'],
  ['redo', 'redo', '重做 Ctrl+Shift+Z'],
];

function mount() {
  const t = post.type;
  $('#app').innerHTML = `
  <div class="editor view-${viewPref()}">
    <header class="ed-top">
      <a href="/studio" class="ed-back" title="回工作室">←</a>
      <div class="seg ed-type">
        <button data-type="essay">文章</button><button data-type="note">碎片</button><button data-type="page">页面</button>
      </div>
      <span class="ed-state muted"></span>
      <div class="ed-actions">
        <div class="seg ed-views" title="视图">
          <button data-view="write" title="只写">${icon('pen', 16)}</button>
          <button data-view="split" title="分栏">${icon('split', 16)}</button>
          <button data-view="preview" title="只看">${icon('eye', 16)}</button>
        </div>
        <button class="icon-btn" data-act="focus" title="专注模式（Esc 退出）">${icon('focus')}</button>
        <button class="icon-btn" data-act="props" title="属性">${icon('sliders')}</button>
        <a class="btn ghost ed-view-link" target="_blank" hidden>查看 ↗</a>
        <button class="btn ghost" data-act="draft">存草稿</button>
        <button class="btn solid" data-act="publish">发布</button>
      </div>
    </header>
    <div class="ed-toolbar" role="toolbar">
      ${TOOLS.map((x) => x === '|' ? '<span class="tb-sep"></span>'
        : `<button type="button" class="tb" data-tool="${x[0]}" title="${esc(x[2])}">${x[3] === 'heading' ? '<b class="tb-h">H</b>' : icon(x[1])}</button>`).join('')}
    </div>
    <div class="ed-body">
      <div class="ed-pane ed-write">
        <div class="ed-paper">
          <textarea class="ed-title" rows="1" placeholder="${t === 'note' ? '标题（可以不写）' : '标题'}" spellcheck="false"></textarea>
          <textarea class="ed-text" placeholder="${t === 'note' ? '此刻在想什么……' : '从这里开始。支持 Markdown，可以直接粘贴或拖入图片和文件。'}" spellcheck="false"></textarea>
        </div>
      </div>
      <div class="ed-pane ed-preview">
        <article class="post">
          <header class="post-head"><div class="kicker ed-pv-kicker"></div><h1 class="post-title ed-pv-title"></h1></header>
          <figure class="post-cover ed-pv-cover" hidden><img alt=""></figure>
          <div class="prose ed-pv-body"></div>
        </article>
      </div>
      <aside class="ed-props">
        <div class="ed-props-inner">
          <div class="props-head"><h3>属性</h3><button class="icon-btn" data-act="props">${icon('close')}</button></div>
          <label class="field"><span>可见性</span>
            <select name="status"><option value="published">公开</option><option value="hidden">隐藏 · 只有拿到链接的人能看</option><option value="draft">草稿 · 只有自己</option></select>
          </label>
          <label class="field"><span>链接</span><div class="affix"><i>/p/</i><input name="slug" placeholder="留空则按标题生成"></div></label>
          <label class="field"><span>发布时间</span><input type="datetime-local" name="publishedAt"></label>
          <div class="field"><span>标签</span>
            <div class="chips"><span class="chip-list"></span><input class="chip-input" list="tag-suggest" placeholder="回车添加"></div>
            <datalist id="tag-suggest"></datalist>
          </div>
          <div class="field"><span>封面</span>
            <div class="cover-box"><img hidden alt=""><div class="cover-acts">
              <button type="button" class="btn tiny ghost" data-act="cover-up">上传</button>
              <button type="button" class="btn tiny ghost" data-act="cover-lib">媒体库</button>
              <button type="button" class="btn tiny ghost" data-act="cover-url">链接</button>
              <button type="button" class="btn tiny ghost" data-act="cover-del" hidden>移除</button>
            </div></div>
          </div>
          <label class="field"><span>摘要 <i class="muted">留空自动截取</i></span><textarea name="excerpt" rows="3"></textarea></label>
          <div class="field"><span>心绪</span>
            <input name="mood" placeholder="一个符号，或者几个字" maxlength="40">
            <div class="mood-picks">${MOODS.map((m) => `<button type="button" data-mood="${m}">${m}</button>`).join('')}</div>
          </div>
          <div class="field"><span>版式</span>
            <div class="seg ed-layout"><button data-layout="">标准</button><button data-layout="wide">宽幅</button><button data-layout="verse">诗行</button></div>
          </div>
          <label class="check"><input type="checkbox" name="pinned"><span>置顶</span></label>
          <label class="check"><input type="checkbox" name="compress" ${compressPref() ? 'checked' : ''}><span>上传前压缩大图（WebP，最长边 2560）</span></label>
          <div class="props-danger" hidden><button type="button" class="btn danger tiny" data-act="delete">删除这篇</button></div>
          <div class="props-help">
            <details><summary>写作语法速查</summary>
<pre>## 标题        **粗**  *斜*  ~~删~~
==高亮==      ||黑幕||   {汉字|hàn zì}
- [ ] 待办      > 引用      ---
脚注[^1]      [^1]: 脚注内容
::: note 标题     ::: tip / warn / danger
::: details 点开   ::: center / right
::: wide 宽幅      ::: aside 旁注
（以上都以单独一行 ::: 结束）
![说明](图/视频/音频链接 "图注")
连续多张图片放在一段 → 自动拼图
可以直接写 HTML，比如 &lt;iframe&gt;</pre>
            </details>
            <p class="muted">Ctrl+S 保存 · Ctrl+Enter 发布 · Tab 缩进</p>
          </div>
        </div>
      </aside>
    </div>
    <footer class="ed-foot">
      <span class="ed-count"></span>
      <span class="ed-pos"></span>
      <span class="ed-uploads"></span>
    </footer>
    <div class="ed-drop"><div>松手上传</div></div>
    <input type="file" class="ed-file-media" accept="image/*,video/*,audio/*" multiple hidden>
    <input type="file" class="ed-file-any" multiple hidden>
    <input type="file" class="ed-file-cover" accept="image/*" hidden>
  </div>`;

  const root = $('.editor');
  ed = {
    root,
    title: $('.ed-title', root),
    text: $('.ed-text', root),
    write: $('.ed-write', root),
    preview: $('.ed-preview', root),
    props: $('.ed-props', root),
  };
  bind();
}

function fill() {
  const r = ed.root;
  ed.title.value = post.title;
  ed.text.value = post.content;
  const f = (n) => $(`[name="${n}"]`, r);
  f('status').value = post.status;
  f('slug').value = post.slug;
  f('publishedAt').value = post.publishedAt ? toLocalInput(post.publishedAt) : '';
  f('excerpt').value = post.excerpt;
  f('mood').value = post.mood;
  f('pinned').checked = post.pinned;
  $('.props-danger', r).hidden = !post.id;
  syncChrome();
  drawTags();
  drawCover();
  autoGrow(ed.title);
  autoGrow(ed.text);
  preview();
  count();
}

// 头部按钮、类型、版式等随状态更新
function syncChrome() {
  const r = ed.root;
  $$('.ed-type button', r).forEach((b) => b.classList.toggle('on', b.dataset.type === post.type));
  $$('.ed-layout button', r).forEach((b) => b.classList.toggle('on', b.dataset.layout === post.layout));
  $$('.ed-views button', r).forEach((b) => b.classList.toggle('on', r.classList.contains('view-' + b.dataset.view)));
  ed.title.placeholder = post.type === 'note' ? '标题（可以不写）' : '标题';
  const live = post.id && post.status !== 'draft' && saved && JSON.parse(saved).status !== 'draft';
  $('[data-act="publish"]', r).textContent = live ? '更新' : '发布';
  $('[data-act="draft"]', r).hidden = !!live;
  const link = $('.ed-view-link', r);
  link.hidden = !(post.id && JSON.parse(saved).id);
  link.href = '/p/' + encodeURIComponent(JSON.parse(saved).slug || post.slug);
  $('.ed-pv-body', r).classList.toggle('verse', post.layout === 'verse');
  $('.post', ed.preview).className = `post post-${post.type}${post.layout ? ' layout-' + post.layout : ''}`;
  markState();
}

function markState(text) {
  const el = $('.ed-state', ed.root);
  if (text) { el.textContent = text; return; }
  if (!post.id) el.textContent = isDirty() ? '未保存 · 本地已备份' : '新的一篇';
  else el.textContent = isDirty() ? '有改动 · 本地已备份' : `已保存 · ${{ published: '公开', hidden: '隐藏', draft: '草稿' }[post.status]}`;
}

// ---------- 事件 ----------

function bind() {
  const r = ed.root;

  ed.title.addEventListener('input', () => { post.title = ed.title.value.replace(/\n/g, ' '); autoGrow(ed.title); changed(); });
  ed.title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); ed.text.focus(); ed.text.setSelectionRange(0, 0); }
  });
  ed.text.addEventListener('input', () => { post.content = ed.text.value; autoGrow(ed.text); changed(); });
  ed.text.addEventListener('keydown', onKey);
  ed.text.addEventListener('keyup', pos);
  ed.text.addEventListener('click', pos);
  ed.text.addEventListener('paste', onPaste);
  document.addEventListener('keydown', globalKeys);

  ed.write.addEventListener('scroll', () => {
    if (!r.classList.contains('view-split')) return;
    const max = ed.write.scrollHeight - ed.write.clientHeight;
    const ratio = max > 0 ? ed.write.scrollTop / max : 0;
    ed.preview.scrollTop = ratio * (ed.preview.scrollHeight - ed.preview.clientHeight);
  }, { passive: true });

  $$('.ed-type button', r).forEach((b) => (b.onclick = () => { post.type = b.dataset.type; syncChrome(); changed(); }));
  $$('.ed-layout button', r).forEach((b) => (b.onclick = () => { post.layout = b.dataset.layout; syncChrome(); changed(); }));
  $$('.ed-views button', r).forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  $$('.tb', r).forEach((b) => (b.onmousedown = (e) => e.preventDefault()));
  $('.ed-toolbar', r).onclick = (e) => {
    const b = e.target.closest('.tb');
    if (b) tool(b.dataset.tool, b);
  };

  r.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'props') r.classList.toggle('props-open');
    if (act === 'focus') toggleFocus();
    if (act === 'draft') save('draft');
    if (act === 'publish') save('publish');
    if (act === 'delete') removePost();
    if (act === 'cover-up') $('.ed-file-cover', r).click();
    if (act === 'cover-lib') mediaLibrary({ title: '选一张封面', pickLabel: '用作封面', filter: (f) => f.type.startsWith('image/'), onPick: (f) => setCover(f.url) });
    if (act === 'cover-url') promptBox('封面图片地址', post.cover, { placeholder: 'https://…' }).then((v) => v !== null && setCover(v.trim()));
    if (act === 'cover-del') setCover('');
  });

  const f = (n) => $(`[name="${n}"]`, r);
  f('status').onchange = (e) => { post.status = e.target.value; changed(); };
  f('slug').oninput = (e) => { post.slug = e.target.value; changed(); };
  f('publishedAt').onchange = (e) => { post.publishedAt = e.target.value ? new Date(e.target.value).getTime() : 0; changed(); };
  f('excerpt').oninput = (e) => { post.excerpt = e.target.value; changed(); };
  f('mood').oninput = (e) => { post.mood = e.target.value; changed(); };
  f('pinned').onchange = (e) => { post.pinned = e.target.checked; changed(); };
  f('compress').onchange = (e) => setCompressPref(e.target.checked);
  $$('.mood-picks button', r).forEach((b) => (b.onclick = () => { post.mood = post.mood === b.dataset.mood ? '' : b.dataset.mood; f('mood').value = post.mood; changed(); }));

  const chip = $('.chip-input', r);
  chip.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ',' || e.key === '，') && chip.value.trim()) {
      e.preventDefault();
      addTag(chip.value);
      chip.value = '';
    } else if (e.key === 'Backspace' && !chip.value && post.tags.length) {
      post.tags = post.tags.slice(0, -1);
      drawTags();
      changed();
    }
  });
  chip.addEventListener('change', () => { if (chip.value.trim()) { addTag(chip.value); chip.value = ''; } });
  $('.chip-list', r).onclick = (e) => {
    const x = e.target.closest('[data-tag]');
    if (!x) return;
    post.tags = post.tags.filter((t) => t !== x.dataset.tag);
    drawTags();
    changed();
  };

  $('.ed-file-media', r).onchange = (e) => { insertUploads([...e.target.files]); e.target.value = ''; };
  $('.ed-file-any', r).onchange = (e) => { insertUploads([...e.target.files]); e.target.value = ''; };
  $('.ed-file-cover', r).onchange = async (e) => {
    const [res] = await uploadMany([...e.target.files], progressItem);
    e.target.value = '';
    if (res) setCover(res.url);
  };

  // 拖拽上传
  let depth = 0;
  r.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; r.classList.add('dropping'); } });
  r.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; r.classList.remove('dropping'); } });
  r.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  r.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    r.classList.remove('dropping');
    insertUploads([...e.dataTransfer.files]);
  });
}

const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

let saveTimer = null;
let previewTimer = null;
function changed() {
  markState();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => { preview(); count(); }, 120);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      if (isDirty()) localStorage.setItem(draftKey(), JSON.stringify({ at: Date.now(), post }));
      else localStorage.removeItem(draftKey());
    } catch {}
  }, 500);
}

function restoreLocalDraft() {
  let local = null;
  try { local = JSON.parse(localStorage.getItem(draftKey()) || 'null'); } catch {}
  if (!local || !local.post) return;
  if (snapshot({ ...post, ...local.post }) === saved) return;
  if (post.id && post.updatedAt && local.at < post.updatedAt) return;
  const bar = document.createElement('div');
  bar.className = 'ed-restore';
  bar.innerHTML = `<span>发现 ${fmtDate(local.at, 'time')} 留在本机、还没保存的版本。</span>
    <button class="btn tiny solid">恢复</button><button class="btn tiny ghost">丢弃</button>`;
  const [ok, no] = bar.querySelectorAll('button');
  ok.onclick = () => { post = { ...post, ...local.post, id: post.id }; fill(); changed(); bar.remove(); };
  no.onclick = () => { try { localStorage.removeItem(draftKey()); } catch {} bar.remove(); };
  $('.ed-body', ed.root).prepend(bar);
}

// ---------- 预览与统计 ----------

function preview() {
  const r = ed.root;
  $('.ed-pv-title', r).textContent = post.title;
  $('.ed-pv-title', r).hidden = !post.title;
  const kind = { essay: '文章', note: '碎片', page: '页面' }[post.type];
  $('.ed-pv-kicker', r).innerHTML = post.type === 'page' ? '' :
    `<span>${kind}</span><span>${fmtDate(post.publishedAt || Date.now())}</span>${post.mood ? `<span>${esc(post.mood)}</span>` : ''}`;
  const body = $('.ed-pv-body', r);
  body.innerHTML = render(post.content) || '<p class="muted">预览会出现在这里。</p>';
  enhance(body, { lightbox: false });
}

function count() {
  const s = readingStats(post.content);
  $('.ed-count', ed.root).textContent = `${s.words} 字 · 约 ${s.minutes} 分钟`;
}

function pos() {
  const v = ed.text.value.slice(0, ed.text.selectionStart);
  const line = v.split('\n').length;
  const col = v.length - v.lastIndexOf('\n');
  const sel = ed.text.selectionEnd - ed.text.selectionStart;
  $('.ed-pos', ed.root).textContent = `行 ${line}，列 ${col}${sel ? ` · 选中 ${sel}` : ''}`;
}

function autoGrow(el) {
  const y = ed.write.scrollTop;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
  ed.write.scrollTop = y;
}

function viewPref() {
  try {
    return localStorage.getItem('gali:edview') || (innerWidth > 1100 ? 'split' : 'write');
  } catch { return 'split'; }
}

function setView(v) {
  const r = ed.root;
  r.classList.remove('view-write', 'view-split', 'view-preview');
  r.classList.add('view-' + v);
  try { localStorage.setItem('gali:edview', v); } catch {}
  syncChrome();
  if (v !== 'preview') requestAnimationFrame(() => { autoGrow(ed.title); autoGrow(ed.text); });
}

function toggleFocus(force) {
  const on = force ?? !ed.root.classList.contains('focus');
  ed.root.classList.toggle('focus', on);
  if (on) {
    setView('write');
    document.documentElement.requestFullscreen?.().catch(() => {});
    ed.text.focus();
  } else if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

// ---------- 文本操作（走 execCommand 以保留撤销栈）----------

function replace(start, end, text, selStart, selEnd) {
  const ta = ed.text;
  ta.focus();
  ta.setSelectionRange(start, end);
  const ok = document.execCommand && document.execCommand('insertText', false, text);
  if (!ok || ta.value.slice(start, start + text.length) !== text) {
    ta.setRangeText(text, start, end, 'end');
    ta.dispatchEvent(new Event('input'));
  }
  if (selStart !== undefined) ta.setSelectionRange(selStart, selEnd ?? selStart);
  pos();
}

function wrap(before, after = before, placeholder = '文字') {
  const ta = ed.text;
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const sel = value.slice(s, e);
  // 已包裹则取消
  if (value.slice(s - before.length, s) === before && value.slice(e, e + after.length) === after) {
    replace(s - before.length, e + after.length, sel, s - before.length, e - before.length);
    return;
  }
  if (sel.startsWith(before) && sel.endsWith(after) && sel.length >= before.length + after.length) {
    const inner = sel.slice(before.length, sel.length - after.length);
    replace(s, e, inner, s, s + inner.length);
    return;
  }
  const inner = sel || placeholder;
  replace(s, e, before + inner + after, s + before.length, s + before.length + inner.length);
}

function lineRange() {
  const ta = ed.text;
  const v = ta.value;
  const start = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  let end = v.indexOf('\n', ta.selectionEnd - (ta.selectionEnd > ta.selectionStart && v[ta.selectionEnd - 1] === '\n' ? 1 : 0));
  if (end === -1) end = v.length;
  return { start, end, text: v.slice(start, end) };
}

function prefixLines(make, strip) {
  const { start, end, text } = lineRange();
  const lines = text.split('\n');
  const all = lines.every((l) => strip.test(l) || !l.trim());
  const out = lines.map((l, i) => (all ? l.replace(strip, '') : l.trim() || lines.length === 1 ? make(i) + l.replace(strip, '') : l));
  const joined = out.join('\n');
  replace(start, end, joined, start, start + joined.length);
}

function setHeading(level) {
  const { start, end, text } = lineRange();
  const bare = text.replace(/^#{1,6}\s+/, '');
  const current = (text.match(/^(#{1,6})\s/) || [])[1]?.length;
  const next = current === level ? bare : '#'.repeat(level) + ' ' + bare;
  replace(start, end, next, start + next.length);
}

function insertBlock(text, selectFrom, selectLen = 0) {
  const ta = ed.text;
  const v = ta.value;
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const before = v.slice(0, s);
  const after = v.slice(e);
  const pre = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const post = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const full = pre + text + post;
  const base = s + pre.length;
  replace(s, e, full, selectFrom !== undefined ? base + selectFrom : base + text.length, selectFrom !== undefined ? base + selectFrom + selectLen : undefined);
}

function insertInline(text) {
  const ta = ed.text;
  replace(ta.selectionStart, ta.selectionEnd, text, ta.selectionStart + text.length);
}

// ---------- 工具栏 ----------

function tool(name, btn) {
  const ta = ed.text;
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  switch (name) {
    case 'heading':
      return popover(btn, [1, 2, 3, 4].map((n) => `<button data-v="${n}" class="pop-h pop-h${n}">${'#'.repeat(n)} 标题 ${n}</button>`).join(''), (v) => setHeading(+v));
    case 'bold': return wrap('**');
    case 'italic': return wrap('*');
    case 'strike': return wrap('~~');
    case 'underline': return wrap('<u>', '</u>');
    case 'mark': return wrap('==');
    case 'spoiler': return wrap('||', '||', '藏起来的话');
    case 'code': return wrap('`', '`', 'code');
    case 'color':
      return popover(btn, '<button data-v="big">大字</button><button data-v="small">小字</button><button data-v="muted">淡色</button><button data-v="serif">衬线</button><button data-v="mono">等宽</button>', (v) => {
        if (v === 'big') return wrap('<span style="font-size:1.4em">', '</span>');
        if (v === 'small') return wrap('<small>', '</small>');
        if (v === 'serif') return wrap('<span style="font-family:var(--serif)">', '</span>');
        if (v === 'mono') return wrap('<span style="font-family:var(--mono)">', '</span>');
        if (v === 'muted') return wrap('<span style="color:var(--fg-3)">', '</span>');
      });
    case 'quote': return prefixLines(() => '> ', /^>\s?/);
    case 'ul': return prefixLines(() => '- ', /^\s*[-*+]\s(\[[ xX]\]\s)?/);
    case 'ol': return prefixLines((i) => `${i + 1}. `, /^\s*\d+[.)]\s/);
    case 'task': return prefixLines(() => '- [ ] ', /^\s*[-*+]\s\[[ xX]\]\s/);
    case 'hr': return insertBlock('---');
    case 'link': return insertLink(sel);
    case 'image': return $('.ed-file-media', ed.root).click();
    case 'file': return $('.ed-file-any', ed.root).click();
    case 'library': return mediaLibrary({ keepOpen: true, onPick: (f) => { insertInline(markdownFor(f) + ' '); toast('已插入'); } });
    case 'table':
      return popover(btn, tableGrid(), (v) => {
        const [rows, cols] = v.split('x').map(Number);
        const head = '| ' + Array.from({ length: cols }, (_, i) => `标题${i + 1}`).join(' | ') + ' |';
        const line = '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |';
        const body = Array.from({ length: rows - 1 }, () => '| ' + Array.from({ length: cols }, () => '   ').join(' | ') + ' |');
        insertBlock([head, line, ...body].join('\n'), 2, 3);
      }, true);
    case 'codeblock': {
      const lang = 'js';
      const body = sel || '';
      return insertBlock('```' + lang + '\n' + body + '\n```', 3, lang.length);
    }
    case 'callout':
      return popover(btn, [
        ['note', '注 · note'], ['tip', '提示 · tip'], ['warn', '留意 · warn'], ['danger', '警告 · danger'],
        ['details', '折叠 · details'], ['center', '居中 · center'], ['right', '靠右 · right'],
        ['wide', '宽幅 · wide'], ['aside', '旁注 · aside'],
      ].map(([k, label]) => `<button data-v="${k}">${label}</button>`).join(''), (k) => {
        const head = k === 'details' ? '::: details 点开看看' : `::: ${k}`;
        const body = sel || '内容';
        insertBlock(`${head}\n${body}\n:::`, head.length + 1, body.length);
      });
    case 'ruby': return wrap('{', '|pīn yīn}', '汉字');
    case 'foot': {
      const used = [...ta.value.matchAll(/\[\^(\d+)\]/g)].map((m) => +m[1]);
      const n = (used.length ? Math.max(...used) : 0) + 1;
      insertInline(`[^${n}]`);
      const v = ta.value;
      const def = `${v.endsWith('\n') ? '' : '\n'}\n[^${n}]: `;
      return replace(v.length, v.length, def + '脚注内容', v.length + def.length, v.length + def.length + 4);
    }
    case 'undo': ta.focus(); return document.execCommand('undo');
    case 'redo': ta.focus(); return document.execCommand('redo');
  }
}

async function insertLink(sel) {
  const ta = ed.text;
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const isUrl = /^https?:\/\/\S+$/.test(sel);
  const url = isUrl ? sel : await promptBox('链接地址', 'https://');
  if (url === null) return ta.focus();
  const text = isUrl ? '链接文字' : sel || '链接文字';
  const md = `[${text}](${url})`;
  replace(s, e, md, s + 1, s + 1 + text.length);
}

function tableGrid() {
  let cells = '';
  for (let r = 1; r <= 8; r++) for (let c = 1; c <= 8; c++) cells += `<button data-v="${r}x${c}" data-r="${r}" data-c="${c}"></button>`;
  return `<div class="pop-grid">${cells}</div><div class="pop-grid-label muted">选择行列</div>`;
}

function popover(anchor, inner, onPick, isGrid = false) {
  document.querySelector('.pop')?.remove();
  const pop = document.createElement('div');
  pop.className = 'pop';
  pop.innerHTML = inner;
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = r.bottom + 6 + 'px';
  pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 8) + 'px';
  const close = () => { pop.remove(); document.removeEventListener('mousedown', outside, true); };
  const outside = (e) => { if (!pop.contains(e.target) && e.target !== anchor) close(); };
  setTimeout(() => document.addEventListener('mousedown', outside, true));
  pop.onmousedown = (e) => e.preventDefault();
  pop.onclick = (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    close();
    onPick(b.dataset.v);
  };
  if (isGrid) {
    pop.onmouseover = (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      const R = +b.dataset.r;
      const C = +b.dataset.c;
      $$('[data-r]', pop).forEach((x) => x.classList.toggle('on', +x.dataset.r <= R && +x.dataset.c <= C));
      $('.pop-grid-label', pop).textContent = `${R} 行 × ${C} 列`;
    };
  }
}

// ---------- 键盘 ----------

function onKey(e) {
  const ta = ed.text;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); return wrap('**'); }
    if (k === 'i') { e.preventDefault(); return wrap('*'); }
    if (k === 'k') { e.preventDefault(); return insertLink(ta.value.slice(ta.selectionStart, ta.selectionEnd)); }
    if (k === 'e') { e.preventDefault(); return wrap('`', '`', 'code'); }
  }
  if (mod && e.altKey && /^[1-4]$/.test(e.key)) { e.preventDefault(); return setHeading(+e.key); }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'x') { e.preventDefault(); return wrap('~~'); }

  if (e.key === 'Tab') {
    e.preventDefault();
    const { start, end, text } = lineRange();
    const multi = ta.selectionStart !== ta.selectionEnd && text.includes('\n');
    const inList = /^\s*([-*+]|\d+[.)])\s/.test(text);
    if (e.shiftKey) {
      const out = text.split('\n').map((l) => l.replace(/^( {1,2}|\t)/, '')).join('\n');
      replace(start, end, out, start, start + out.length);
    } else if (multi || inList) {
      const out = text.split('\n').map((l) => '  ' + l).join('\n');
      const caret = ta.selectionStart + 2;
      replace(start, end, out, multi ? start : caret, multi ? start + out.length : caret);
    } else insertInline('  ');
    return;
  }

  if (e.key === 'Enter' && !e.shiftKey && !mod && !e.isComposing) {
    const s = ta.selectionStart;
    if (s !== ta.selectionEnd) return;
    const v = ta.value;
    const lineStart = v.lastIndexOf('\n', s - 1) + 1;
    const line = v.slice(lineStart, s);
    const m = line.match(/^(\s*)([-*+]|(\d+)([.)]))\s(\[[ xX]\]\s)?/) || line.match(/^(\s*)(>)\s?/);
    if (!m) return;
    e.preventDefault();
    if (line.trim() === m[0].trim()) {
      // 空的列表项：结束列表，并留出一个空行，避免下一段被并进列表或引用
      replace(lineStart, s, '\n', lineStart + 1);
      return;
    }
    let marker;
    if (m[2] === '>') marker = '> ';
    else if (m[3]) marker = `${+m[3] + 1}${m[4]} `;
    else marker = `${m[2]} ${m[5] ? '[ ] ' : ''}`;
    insertInline('\n' + m[1] + marker);
  }
}

function globalKeys(e) {
  if (!document.body.contains(ed.root)) {
    document.removeEventListener('keydown', globalKeys);
    return;
  }
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(post.status === 'draft' && (!post.id || JSON.parse(saved).status === 'draft') ? 'draft' : 'publish'); }
  if (mod && e.key === 'Enter') { e.preventDefault(); save('publish'); }
  if (e.key === 'Escape' && ed.root.classList.contains('focus') && !document.querySelector('.modal-wrap')) toggleFocus(false);
}

// ---------- 粘贴与上传 ----------

function onPaste(e) {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) {
    e.preventDefault();
    insertUploads(files);
    return;
  }
  const text = e.clipboardData?.getData('text/plain') || '';
  const ta = ed.text;
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  if (sel && /^https?:\/\/\S+$/.test(text.trim()) && !/\n/.test(sel)) {
    e.preventDefault();
    insertInline(`[${sel}](${text.trim()})`);
  }
}

let upSeq = 0;
async function insertUploads(files) {
  if (!files.length) return;
  if (ed.root.classList.contains('no-storage')) {
    toast('还没有绑定文件存储（R2 的 FILES 或 KV 的 FILES_KV），暂时不能上传', 'error');
    return;
  }
  const marks = files.map((f) => {
    const token = `![上传中 ${f.name.replace(/[[\]]/g, '')} …](#up-${++upSeq})`;
    return { f, token };
  });
  const before = ed.text.value.slice(0, ed.text.selectionStart);
  const lead = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  insertInline(lead + marks.map((m) => m.token).join('\n') + '\n');
  for (const m of marks) {
    const [res] = await uploadMany([m.f], progressItem);
    const at = ed.text.value.indexOf(m.token);
    if (at === -1) continue;
    if (res) replace(at, at + m.token.length, markdownFor(res));
    else replace(at, at + m.token.length + (ed.text.value[at + m.token.length] === '\n' ? 1 : 0), '');
  }
}

function progressItem(file, st) {
  const box = $('.ed-uploads', ed.root);
  if (!box) return;
  let el = box.querySelector(`[data-name="${CSS.escape(file.name)}"]`);
  if (!el) {
    el = document.createElement('span');
    el.className = 'up-chip';
    el.dataset.name = file.name;
    el.innerHTML = `<i></i><b>${esc(file.name)}</b>`;
    box.appendChild(el);
  }
  if (st.progress !== undefined) el.querySelector('i').style.width = Math.round(st.progress * 100) + '%';
  if (st.done) { el.classList.add('ok'); setTimeout(() => el.remove(), 1200); }
  if (st.error) { el.classList.add('bad'); setTimeout(() => el.remove(), 4000); }
}

// ---------- 属性 ----------

function addTag(v) {
  for (const t of v.split(/[,，\s]+/)) {
    const tag = t.replace(/^#/, '').trim();
    if (tag && !post.tags.includes(tag)) post.tags.push(tag);
  }
  drawTags();
  changed();
}

function drawTags() {
  $('.chip-list', ed.root).innerHTML = post.tags.map((t) => `<span class="chip" data-tag="${esc(t)}">#${esc(t)}<i>×</i></span>`).join('');
}

function setCover(url) {
  post.cover = url;
  drawCover();
  changed();
}

function drawCover() {
  const box = $('.cover-box', ed.root);
  const img = $('img', box);
  img.hidden = !post.cover;
  if (post.cover) img.src = post.cover;
  $('[data-act="cover-del"]', box).hidden = !post.cover;
  const pv = $('.ed-pv-cover', ed.root);
  pv.hidden = !post.cover;
  if (post.cover) $('img', pv).src = post.cover;
}

// ---------- 保存 ----------

let saving = false;
async function save(mode) {
  if (saving) return;
  const body = { ...post };
  if (mode === 'draft') body.status = 'draft';
  else if (body.status === 'draft') body.status = 'published';
  if (body.type !== 'note' && !body.title.trim()) {
    toast('给它起个标题吧', 'error');
    ed.title.focus();
    return;
  }
  if (!body.title.trim() && !body.content.trim()) {
    toast('还什么都没写', 'error');
    return;
  }
  if (ed.text.value.includes('](#up-')) {
    toast('还有文件在上传', 'error');
    return;
  }
  saving = true;
  markState('保存中…');
  const wasNew = !post.id;
  const firstPublish = mode === 'publish' && (wasNew || JSON.parse(saved).status === 'draft');
  try {
    const res = await withAuth(() => (post.id ? api.put('/posts/' + post.id, body) : api.post('/posts', body)));
    try { localStorage.removeItem(draftKey()); } catch {}
    post = { ...post, ...res };
    saved = snapshot(post);
    try { localStorage.removeItem('gali:draft:new'); } catch {}
    state.tags = null;
    if (firstPublish && post.status !== 'draft') {
      toast(post.status === 'hidden' ? '已保存为隐藏' : '已发布');
      setLeaveGuard(null);
      return navigate('/p/' + encodeURIComponent(post.slug));
    }
    toast(mode === 'draft' ? '草稿已保存' : '已更新');
    if (wasNew) history.replaceState(null, '', '/write/' + post.id);
    fill();
  } catch (e) {
    toast(e.message, 'error');
    markState();
  } finally {
    saving = false;
  }
}

async function removePost() {
  if (!post.id) return;
  if (!(await confirmBox(`删除「${post.title || '这条碎片'}」？删除后无法恢复。`, { ok: '删除', danger: true }))) return;
  try {
    await withAuth(() => api.del('/posts/' + post.id));
    try { localStorage.removeItem(draftKey()); } catch {}
    saved = snapshot(post);
    toast('已删除');
    navigate('/studio');
  } catch (e) {
    toast(e.message, 'error');
  }
}
