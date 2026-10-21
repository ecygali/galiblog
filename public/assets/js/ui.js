// 界面小工具：转义、日期、提示、弹窗、口令锁

import { api } from './api.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function html(strings, ...vals) {
  return strings.reduce((out, s, i) => out + s + (i < vals.length ? vals[i] : ''), '');
}

const pad = (n) => String(n).padStart(2, '0');
export function fmtDate(ts, style = 'full') {
  const d = new Date(ts);
  if (style === 'md') return `${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
  if (style === 'ymd') return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
  if (style === 'time') return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

export function relTime(ts) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return fmtDate(ts, 'ymd');
}

export function toLocalInput(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

export function toast(msg, kind = '') {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, kind === 'error' ? 4200 : 2400);
}

// 通用弹窗，返回 { el, close, done }，done 在关闭时 resolve
export function modal(content, { wide = false, onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${content}</div>`;
  document.body.appendChild(wrap);
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));
  const close = (value) => {
    wrap.classList.remove('show');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => wrap.remove(), 200);
    onClose && onClose();
    resolveDone(value);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => e.target === wrap && close());
  wrap.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => close()));
  requestAnimationFrame(() => wrap.classList.add('show'));
  return { el: wrap.firstElementChild, close, done };
}

export function confirmBox(text, { ok = '确定', danger = false } = {}) {
  const m = modal(`<p class="confirm-text">${esc(text)}</p>
    <div class="modal-actions"><button class="btn ghost" data-close>算了</button>
    <button class="btn ${danger ? 'danger' : 'solid'}" data-ok>${esc(ok)}</button></div>`);
  m.el.querySelector('[data-ok]').onclick = () => m.close(true);
  m.el.querySelector('[data-ok]').focus();
  return m.done.then((v) => v === true);
}

export function promptBox(label, value = '', { placeholder = '' } = {}) {
  const m = modal(`<form class="prompt"><label class="field"><span>${esc(label)}</span>
    <input name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off"></label>
    <div class="modal-actions"><button type="button" class="btn ghost" data-close>取消</button><button class="btn solid">好</button></div></form>`);
  const form = m.el.querySelector('form');
  const input = form.v;
  setTimeout(() => { input.focus(); input.select(); }, 30);
  form.onsubmit = (e) => { e.preventDefault(); m.close(input.value); };
  return m.done.then((v) => (typeof v === 'string' ? v : null));
}

// 口令锁：resolve(true) 表示已解锁
export function unlock({ inline = false } = {}) {
  return new Promise((resolve) => {
    const content = `
      <form class="lock">
        <div class="lock-seal" aria-hidden="true">
          <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" stroke-width="1"/>
          <circle cx="24" cy="24" r="17" fill="none" stroke="currentColor" stroke-width=".6" stroke-dasharray="1.5 2.5"/>
          <path d="M18 23v-4a6 6 0 0 1 12 0v4" fill="none" stroke="currentColor" stroke-width="1.4"/>
          <rect x="15.5" y="23" width="17" height="12" rx="2" fill="currentColor"/></svg>
        </div>
        <h2>${inline ? '会话过期了' : '先说口令'}</h2>
        <p class="muted">${inline ? '重新输入口令后会继续刚才的操作，写的东西都还在。' : '只有知道口令的人可以在这里落笔。'}</p>
        <input type="text" name="pw" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="口令" required>
        <label class="check"><input type="checkbox" name="remember" checked><span>在这台设备上记住我（180 天）</span></label>
        <p class="lock-err" aria-live="polite"></p>
        <div class="modal-actions"><button type="button" class="btn ghost" data-close>离开</button><button class="btn solid">解锁</button></div>
      </form>`;
    const m = modal(content, { onClose: () => resolve(false) });
    const form = m.el.querySelector('form');
    setTimeout(() => form.pw.focus(), 50);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button.solid');
      btn.disabled = true;
      form.querySelector('.lock-err').textContent = '';
      try {
        await api.post('/auth/login', { password: form.pw.value, remember: form.remember.checked });
        resolve(true);
        m.close();
      } catch (err) {
        form.querySelector('.lock-err').textContent = err.message;
        form.classList.remove('shake');
        void form.offsetWidth;
        form.classList.add('shake');
        form.pw.select();
      } finally {
        btn.disabled = false;
      }
    };
  });
}

// 已登录则直接执行；遇到 401 时弹出口令锁后重试一次
export async function withAuth(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e.status !== 401) throw e;
    if (!(await unlock({ inline: true }))) throw e;
    return fn();
  }
}

export const icons = {
  bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
  italic: '<path d="M14 5h-4M14 19h-4M13.5 5l-3 14"/>',
  strike: '<path d="M5 12h14M16 7.5C15.4 6 14 5 12 5c-2.5 0-4 1.3-4 3 0 1.3.8 2.2 2.4 2.8M8 16.5c.6 1.5 2 2.5 4 2.5 2.5 0 4-1.3 4-3 0-.6-.2-1.2-.5-1.6"/>',
  underline: '<path d="M7 5v6a5 5 0 0 0 10 0V5M5 20h14"/>',
  mark: '<path d="m9 15 6-11 4 2.3-6 11zM9 15l-1.5 3.5L11 17M4 21h9"/>',
  code: '<path d="m9 8-4 4 4 4M15 8l4 4-4 4"/>',
  quote: '<path d="M6 17c-1.5-1-2-2.6-2-4.4C4 9.6 6 7.5 9 7M15 17c-1.5-1-2-2.6-2-4.4 0-3 2-5.1 5-5.6"/>',
  ul: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  ol: '<path d="M10 6h10M10 12h10M10 18h10M4 4.5h1.5V9M4 9h3M4 14.5c.5-.7 1.2-1 2-1 .9 0 1.5.6 1.5 1.3 0 1.2-3.5 2.2-3.5 4.2h3.5"/>',
  task: '<rect x="3.5" y="4.5" width="6" height="6" rx="1"/><path d="m4.8 15.8 1.4 1.4 2.6-2.8M13 7.5h7.5M13 16h7.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 2.5-2.5L20 19"/>',
  file: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5zM14 3.5v5h5"/>',
  clip: '<path d="m20 11.5-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17M3.5 14.5h17M10 4.5v15"/>',
  block: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="m8 10-2 2 2 2M16 10l2 2-2 2M13 9l-2 6"/>',
  hr: '<path d="M4 12h16M8 7h8M8 17h8"/>',
  callout: '<path d="M4 5.5h16v10H9l-5 4z"/><path d="M12 8.5v3M12 13.5v.01"/>',
  center: '<path d="M5 6h14M8 10h8M5 14h14M8 18h8"/>',
  details: '<path d="m7 9 5 5 5-5"/><path d="M4 4.5h16M4 19.5h16"/>',
  spoiler: '<rect x="3.5" y="9" width="17" height="6" rx="1"/><path d="M6 12h.01M9 12h.01M12 12h.01M15 12h.01M18 12h.01"/>',
  ruby: '<path d="M6 19 10 9l4 10M7.5 15.5h5M15 6.5h5M17.5 4v5"/>',
  foot: '<path d="M5 6h9M5 11h9M5 16h5M17 15v-4l2-1"/>',
  type: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  color: '<path d="M12 3.5c-4.7 0-8.5 3.6-8.5 8 0 4 3 7 6.5 7 1.5 0 1.5-1 1.5-2s.8-1.7 2-1.7h2.3c2.6 0 4.7-2 4.7-4.4 0-3.8-3.8-6.9-8.5-6.9z"/><circle cx="8" cy="11" r="1"/><circle cx="12" cy="8" r="1"/><circle cx="16" cy="11" r="1"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  split: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M12 4.5v15"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  focus: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  library: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  auto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5h6V7"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pin: '<path d="M9 4h6l-1 6 3 3v1.5H7V13l3-3zM12 14.5V20"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  rss: '<path d="M5 5a14 14 0 0 1 14 14M5 11a8 8 0 0 1 8 8"/><circle cx="6" cy="18" r="1.2"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>',
};

export const icon = (name, size = 18) =>
  `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ''}</svg>`;
