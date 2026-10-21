// 媒体库：上传、浏览、插入、删除

import { api, uploadFile, maybeCompress } from './api.js';
import { esc, fmtSize, relTime, modal, toast, confirmBox, withAuth, icon } from './ui.js';

export function compressPref() {
  try { return localStorage.getItem('gali:compress') !== '0'; } catch { return true; }
}
export function setCompressPref(on) {
  try { localStorage.setItem('gali:compress', on ? '1' : '0'); } catch {}
}

// 上传一组文件；onItem(file, progress|result|error) 用于展示进度
export async function uploadMany(files, onItem) {
  const results = [];
  for (const raw of files) {
    const file = compressPref() ? await maybeCompress(raw) : raw;
    try {
      const res = await withAuth(() => uploadFile(file, (p) => onItem && onItem(raw, { progress: p })));
      onItem && onItem(raw, { done: res });
      results.push(res);
    } catch (e) {
      onItem && onItem(raw, { error: e });
      toast(`${raw.name}：${e.message}`, 'error');
    }
  }
  return results;
}

export function markdownFor(f) {
  const name = f.name.replace(/[[\]]/g, '');
  if (/^(image|video|audio)\//.test(f.type)) return `![${name}](${f.url})`;
  return `[${name}](${f.url})`;
}

function thumb(f) {
  if (f.type.startsWith('image/')) return `<img src="${esc(f.url)}" alt="" loading="lazy">`;
  if (f.type.startsWith('video/')) return `<video src="${esc(f.url)}#t=0.1" preload="metadata" muted></video>`;
  const ext = (f.name.match(/\.(\w{1,6})$/) || [, '?'])[1].toUpperCase();
  return `<span class="m-ext">${esc(ext)}</span>`;
}

// 在 container 里渲染一个媒体网格
export async function mediaGrid(container, { onPick, pickLabel = '插入', filter } = {}) {
  container.innerHTML = `
    <div class="m-head">
      <label class="btn solid m-upload">${icon('plus', 16)} 上传<input type="file" multiple hidden></label>
      <label class="check"><input type="checkbox" class="m-compress" ${compressPref() ? 'checked' : ''}><span>压缩大图</span></label>
      <input class="m-search" placeholder="按文件名筛选">
      <span class="m-count muted"></span>
    </div>
    <div class="m-progress"></div>
    <div class="m-grid"><p class="muted">载入中…</p></div>`;
  const grid = container.querySelector('.m-grid');
  let files = [];

  const draw = () => {
    const kw = container.querySelector('.m-search').value.trim().toLowerCase();
    const list = files.filter((f) => (!filter || filter(f)) && (!kw || f.name.toLowerCase().includes(kw)));
    container.querySelector('.m-count').textContent = `${list.length} 个文件`;
    grid.innerHTML = list.length ? list.map((f) => `
      <div class="m-item" data-id="${f.id}">
        <div class="m-thumb">${thumb(f)}</div>
        <div class="m-info"><span class="m-name" title="${esc(f.name)}">${esc(f.name)}</span>
        <span class="muted">${fmtSize(f.size)} · ${relTime(f.createdAt)}</span></div>
        <div class="m-acts">
          ${onPick ? `<button class="btn tiny solid" data-act="pick">${esc(pickLabel)}</button>` : ''}
          <button class="icon-btn" data-act="copy" title="复制链接">${icon('copy', 16)}</button>
          <button class="icon-btn" data-act="del" title="删除">${icon('trash', 16)}</button>
        </div>
      </div>`).join('') : '<p class="muted m-empty">还没有文件。拖进来，或者点上传。</p>';
  };

  const load = async () => {
    try {
      files = await withAuth(() => api.get('/files'));
      draw();
    } catch (e) {
      grid.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    }
  };

  const doUpload = async (list) => {
    const prog = container.querySelector('.m-progress');
    const rows = new Map();
    await uploadMany(list, (file, st) => {
      let row = rows.get(file);
      if (!row) {
        row = document.createElement('div');
        row.className = 'up-row';
        row.innerHTML = `<span>${esc(file.name)}</span><i></i>`;
        prog.appendChild(row);
        rows.set(file, row);
      }
      if (st.progress !== undefined) row.querySelector('i').style.width = (st.progress * 100).toFixed(0) + '%';
      if (st.done || st.error) setTimeout(() => row.remove(), 600);
    });
    await load();
  };

  container.querySelector('.m-upload input').onchange = (e) => {
    doUpload([...e.target.files]);
    e.target.value = '';
  };
  container.querySelector('.m-compress').onchange = (e) => setCompressPref(e.target.checked);
  container.querySelector('.m-search').oninput = draw;
  container.addEventListener('dragover', (e) => { e.preventDefault(); container.classList.add('dragging'); });
  container.addEventListener('dragleave', (e) => { if (!container.contains(e.relatedTarget)) container.classList.remove('dragging'); });
  container.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    container.classList.remove('dragging');
    if (e.dataTransfer.files.length) doUpload([...e.dataTransfer.files]);
  });

  grid.onclick = async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('.m-item').dataset.id;
    const f = files.find((x) => x.id === id);
    if (btn.dataset.act === 'pick') onPick(f);
    if (btn.dataset.act === 'copy') {
      try {
        await navigator.clipboard.writeText(location.origin + f.url);
        toast('链接已复制');
      } catch { toast(location.origin + f.url); }
    }
    if (btn.dataset.act === 'del') {
      if (!(await confirmBox(`删除「${f.name}」？已经引用它的帖子里会变成坏链接。`, { ok: '删除', danger: true }))) return;
      try {
        await withAuth(() => api.del('/files/' + id));
        files = files.filter((x) => x.id !== id);
        draw();
      } catch (err) { toast(err.message, 'error'); }
    }
  };

  await load();
}

export function mediaLibrary(opts = {}) {
  const m = modal(`<div class="modal-head"><h3>${esc(opts.title || '媒体库')}</h3><button class="icon-btn" data-close>${icon('close')}</button></div><div class="media"></div>`, { wide: true });
  mediaGrid(m.el.querySelector('.media'), {
    ...opts,
    onPick: opts.onPick && ((f) => { opts.onPick(f); if (!opts.keepOpen) m.close(); }),
  });
  return m;
}
