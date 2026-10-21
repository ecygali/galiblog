// 所有 /api/* 请求的入口

import { json, fail, HttpError, readJson, newId, slugify, now, clampStr } from '../../lib/util.js';
import { checkPassword, issueCookie, clearCookie, isAdmin } from '../../lib/auth.js';
import { db, loadSettings, DEFAULT_SETTINGS, toPost } from '../../lib/db.js';
import { storageKind, putObject, deleteObject, LIMITS } from '../../lib/storage.js';

const TYPES = ['essay', 'note', 'page'];
const STATUSES = ['published', 'draft', 'hidden'];
const LAYOUTS = ['', 'wide', 'verse'];

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  try {
    // 写操作必须带自定义请求头，挡掉跨站表单提交
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.headers.get('x-gali') !== '1') {
      fail(403, '缺少请求头');
    }
    const ctx = { ...context, url, parts, admin: await isAdmin(request, context.env) };
    return await route(ctx);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, { status: e.status });
    console.error(e);
    return json({ error: '服务器出了点问题：' + (e && e.message ? e.message : String(e)) }, { status: 500 });
  }
}

function requireAdmin(ctx) {
  if (!ctx.admin) fail(401, '需要口令');
}

async function route(ctx) {
  const { request, parts } = ctx;
  const m = request.method;
  const [a, b] = parts;

  if (a === 'health' && m === 'GET') return health(ctx);
  if (a === 'auth') {
    if (b === 'me' && m === 'GET') return json({ admin: ctx.admin, configured: !!ctx.env.ADMIN_PASSWORD });
    if (b === 'login' && m === 'POST') return login(ctx);
    if (b === 'logout' && m === 'POST') {
      return json({ ok: true }, { headers: { 'set-cookie': clearCookie(request) } });
    }
  }
  if (a === 'settings') {
    if (m === 'GET') return json(await loadSettings(ctx.env), { headers: { 'cache-control': 'no-cache' } });
    if (m === 'PUT') return saveSettings(ctx);
  }
  if (a === 'posts') {
    if (!b && m === 'GET') return listPosts(ctx);
    if (!b && m === 'POST') return savePost(ctx, null);
    if (b && m === 'GET') return getPost(ctx, b);
    if (b && m === 'PUT') return savePost(ctx, b);
    if (b && m === 'DELETE') return deletePost(ctx, b);
  }
  if (a === 'tags' && m === 'GET') return listTags(ctx);
  if (a === 'archive' && m === 'GET') return archive(ctx);
  if (a === 'files') {
    if (!b && m === 'GET') return listFiles(ctx);
    if (!b && m === 'POST') return upload(ctx);
    if (b && m === 'DELETE') return deleteFile(ctx, b);
  }
  fail(404, '没有这个接口');
}

async function health(ctx) {
  const { env } = ctx;
  let dbOk = false;
  try { await db(env); dbOk = true; } catch {}
  const kind = storageKind(env);
  return json({
    db: dbOk,
    storage: kind,
    uploadLimit: kind ? LIMITS[kind] : 0,
    password: !!env.ADMIN_PASSWORD,
    admin: ctx.admin,
  });
}

// ---------- 登录 ----------

async function login(ctx) {
  const { request, env } = ctx;
  if (!env.ADMIN_PASSWORD) fail(503, '还没有设置口令：请在 Pages 项目的环境变量里添加 ADMIN_PASSWORD');
  const DB = await db(env);
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const since = now() - 15 * 60 * 1000;
  const row = await DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND ts > ?').bind(ip, since).first();
  if (row && row.n >= 8) fail(429, '尝试次数太多，过一刻钟再来');

  const body = await readJson(request);
  if (!(await checkPassword(env, body.password))) {
    await DB.batch([
      DB.prepare('INSERT INTO login_attempts (ip, ts) VALUES (?, ?)').bind(ip, now()),
      DB.prepare('DELETE FROM login_attempts WHERE ts < ?').bind(now() - 24 * 3600 * 1000),
    ]);
    await new Promise((r) => setTimeout(r, 400));
    fail(401, '口令不对');
  }
  await DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
  const cookie = await issueCookie(env, request, !!body.remember);
  return json({ ok: true }, { headers: { 'set-cookie': cookie } });
}

// ---------- 设置 ----------

async function saveSettings(ctx) {
  requireAdmin(ctx);
  const body = await readJson(ctx.request);
  const current = await loadSettings(ctx.env);
  const next = { ...current };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (!(key in body)) continue;
    const def = DEFAULT_SETTINGS[key];
    const v = body[key];
    if (typeof def === 'boolean') next[key] = !!v;
    else if (typeof def === 'number') next[key] = Number.isFinite(+v) ? +v : def;
    else if (Array.isArray(def)) {
      next[key] = Array.isArray(v)
        ? v.slice(0, 30).map((x) => ({ label: clampStr(x?.label, 60), href: clampStr(x?.href, 500) })).filter((x) => x.label || x.href)
        : def;
    } else next[key] = clampStr(v, 20000, def);
  }
  next.perPage = Math.min(100, Math.max(5, Math.round(next.perPage)));
  next.fontSize = Math.min(22, Math.max(14, next.fontSize));
  const DB = await db(ctx.env);
  await DB.prepare(`INSERT INTO settings (key, value) VALUES ('site', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(JSON.stringify(next)).run();
  return json(next);
}

// ---------- 帖子 ----------

const LIST_COLS = `id, slug, title, type, excerpt, cover, tags, status, pinned, accent, mood, layout, views,
  created_at, updated_at, published_at, length(content) AS words,
  CASE WHEN type = 'note' THEN content ELSE NULL END AS content`;

async function listPosts(ctx) {
  const { url, admin } = ctx;
  const DB = await db(ctx.env);
  const q = url.searchParams;
  const all = admin && q.get('all') === '1';
  const where = [];
  const args = [];
  if (!all) where.push(`status = 'published'`);
  const type = q.get('type');
  if (type && TYPES.includes(type)) { where.push('type = ?'); args.push(type); }
  else if (!all) where.push(`type != 'page'`);
  const tag = q.get('tag');
  if (tag) { where.push('EXISTS (SELECT 1 FROM json_each(posts.tags) WHERE json_each.value = ?)'); args.push(tag); }
  const kw = (q.get('q') || '').trim();
  if (kw) {
    where.push(`(title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')`);
    const like = '%' + kw.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    args.push(like, like, like);
  }
  const limit = Math.min(100, Math.max(1, parseInt(q.get('limit') || '20', 10) || 20));
  const page = Math.max(1, parseInt(q.get('page') || '1', 10) || 1);
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const order = !tag && !kw && !all ? 'pinned DESC, published_at DESC' : all ? 'updated_at DESC' : 'published_at DESC';
  const [rows, count] = await Promise.all([
    DB.prepare(`SELECT ${LIST_COLS} FROM posts ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .bind(...args, limit, (page - 1) * limit).all(),
    DB.prepare(`SELECT COUNT(*) AS n FROM posts ${whereSql}`).bind(...args).first(),
  ]);
  return json({
    posts: rows.results.map((r) => {
      const p = toPost(r);
      if (p.content === null) delete p.content;
      return p;
    }),
    total: count.n,
    page,
    pages: Math.max(1, Math.ceil(count.n / limit)),
  });
}

async function findPost(DB, key) {
  return DB.prepare('SELECT * FROM posts WHERE id = ? OR slug = ? LIMIT 1').bind(key, key).first();
}

async function getPost(ctx, key) {
  const DB = await db(ctx.env);
  const row = await findPost(DB, key);
  if (!row || (!ctx.admin && row.status === 'draft')) fail(404, '这里什么也没有');
  const post = toPost(row);
  if (row.type !== 'page') {
    const cols = 'slug, title, type, excerpt, published_at';
    const [prev, next] = await Promise.all([
      DB.prepare(`SELECT ${cols} FROM posts WHERE status = 'published' AND type != 'page' AND published_at < ? ORDER BY published_at DESC LIMIT 1`).bind(row.published_at).first(),
      DB.prepare(`SELECT ${cols} FROM posts WHERE status = 'published' AND type != 'page' AND published_at > ? ORDER BY published_at ASC LIMIT 1`).bind(row.published_at).first(),
    ]);
    const lite = (r) => r && { slug: r.slug, title: r.title, type: r.type, excerpt: r.excerpt, publishedAt: r.published_at };
    post.prev = lite(prev);
    post.next = lite(next);
  }
  if (!ctx.admin && row.status === 'published') {
    ctx.waitUntil(DB.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').bind(row.id).run().catch(() => {}));
  }
  return json(post);
}

function autoExcerpt(md) {
  return String(md || '')
    .replace(/^\[\^[^\]]+\]:.*$/gm, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^:::.*$/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{([^|}]+)\|[^}]*\}/g, '$1')
    .replace(/\[\^[^\]]+\]:?/g, '')
    .replace(/[#>*_`~=|\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

async function uniqueSlug(DB, base, selfId) {
  let slug = base;
  for (let i = 2; i < 200; i++) {
    const hit = await DB.prepare('SELECT id FROM posts WHERE slug = ?').bind(slug).first();
    if (!hit || hit.id === selfId) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${newId(4)}`;
}

async function savePost(ctx, key) {
  requireAdmin(ctx);
  const DB = await db(ctx.env);
  const body = await readJson(ctx.request);
  let existing = null;
  if (key) {
    existing = await findPost(DB, key);
    if (!existing) fail(404, '要修改的帖子不存在');
  }
  const t = now();
  const id = existing ? existing.id : newId(10);
  const type = TYPES.includes(body.type) ? body.type : existing?.type || 'essay';
  const status = STATUSES.includes(body.status) ? body.status : existing?.status || 'draft';
  const title = clampStr(body.title, 300).trim();
  const content = clampStr(body.content, 1_000_000);
  if (type !== 'note' && !title) fail(400, '文章和页面需要一个标题');
  if (!title && !content.trim()) fail(400, '什么都还没写');

  const wantedSlug = slugify(body.slug) || slugify(title) || (existing ? existing.slug : id);
  const slug = await uniqueSlug(DB, wantedSlug, id);

  let tags = Array.isArray(body.tags) ? body.tags : [];
  tags = [...new Set(tags.map((x) => String(x).trim().slice(0, 40)).filter(Boolean))].slice(0, 20);

  let publishedAt = Number(body.publishedAt) || 0;
  if (!publishedAt) publishedAt = existing && existing.status !== 'draft' ? existing.published_at : t;

  const row = {
    id,
    slug,
    title,
    type,
    content,
    excerpt: clampStr(body.excerpt, 500).trim() || autoExcerpt(content),
    cover: clampStr(body.cover, 1000),
    tags: JSON.stringify(tags),
    status,
    pinned: body.pinned ? 1 : 0,
    accent: /^#[0-9a-fA-F]{3,8}$/.test(body.accent || '') ? body.accent : '',
    mood: clampStr(body.mood, 40),
    layout: LAYOUTS.includes(body.layout) ? body.layout : '',
    created_at: existing ? existing.created_at : t,
    updated_at: t,
    published_at: publishedAt,
  };
  const cols = Object.keys(row);
  if (existing) {
    await DB.prepare(`UPDATE posts SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .bind(...cols.map((c) => row[c]), id).run();
  } else {
    await DB.prepare(`INSERT INTO posts (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .bind(...cols.map((c) => row[c])).run();
  }
  return json(toPost({ ...row, views: existing ? existing.views : 0 }), { status: existing ? 200 : 201 });
}

async function deletePost(ctx, key) {
  requireAdmin(ctx);
  const DB = await db(ctx.env);
  const res = await DB.prepare('DELETE FROM posts WHERE id = ? OR slug = ?').bind(key, key).run();
  if (!res.meta.changes) fail(404, '帖子不存在');
  return json({ ok: true });
}

async function listTags(ctx) {
  const DB = await db(ctx.env);
  const rows = await DB.prepare(`SELECT json_each.value AS tag, COUNT(*) AS n FROM posts, json_each(posts.tags)
    WHERE posts.status = 'published' AND posts.type != 'page' GROUP BY json_each.value ORDER BY n DESC, tag ASC`).all();
  return json(rows.results.map((r) => ({ tag: r.tag, count: r.n })));
}

async function archive(ctx) {
  const DB = await db(ctx.env);
  const rows = await DB.prepare(`SELECT slug, title, type, excerpt, mood, published_at, length(content) AS words
    FROM posts WHERE status = 'published' AND type != 'page' ORDER BY published_at DESC`).all();
  return json(rows.results.map((r) => ({
    slug: r.slug, title: r.title, type: r.type, excerpt: r.excerpt, mood: r.mood, words: r.words, publishedAt: r.published_at,
  })));
}

// ---------- 文件 ----------

function fileOut(r) {
  return { id: r.id, name: r.name, type: r.type, size: r.size, createdAt: r.created_at, url: `/f/${r.id}/${encodeURIComponent(r.name)}` };
}

async function listFiles(ctx) {
  requireAdmin(ctx);
  const DB = await db(ctx.env);
  const rows = await DB.prepare('SELECT * FROM files ORDER BY created_at DESC LIMIT 500').all();
  return json(rows.results.map(fileOut));
}

async function upload(ctx) {
  requireAdmin(ctx);
  const DB = await db(ctx.env);
  let form;
  try { form = await ctx.request.formData(); } catch { fail(400, '上传格式不对'); }
  const file = form.get('file');
  if (!file || typeof file === 'string') fail(400, '没有收到文件');
  const id = newId(12);
  const name = (file.name || 'file').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 120) || 'file';
  const storage = await putObject(ctx.env, id, file);
  const row = { id, name, type: file.type || 'application/octet-stream', size: file.size, storage, created_at: now() };
  await DB.prepare('INSERT INTO files (id, name, type, size, storage, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(row.id, row.name, row.type, row.size, row.storage, row.created_at).run();
  return json(fileOut(row), { status: 201 });
}

async function deleteFile(ctx, id) {
  requireAdmin(ctx);
  const DB = await db(ctx.env);
  const row = await DB.prepare('SELECT * FROM files WHERE id = ?').bind(id).first();
  if (!row) fail(404, '文件不存在');
  await deleteObject(ctx.env, id, row.storage);
  await DB.prepare('DELETE FROM files WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
