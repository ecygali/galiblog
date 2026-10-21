// D1 表结构（首次请求时自动建表）与站点默认设置

import { fail } from './util.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'essay',
    content TEXT NOT NULL DEFAULT '',
    excerpt TEXT NOT NULL DEFAULT '',
    cover TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft',
    pinned INTEGER NOT NULL DEFAULT 0,
    accent TEXT NOT NULL DEFAULT '',
    mood TEXT NOT NULL DEFAULT '',
    layout TEXT NOT NULL DEFAULT '',
    views INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    published_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_posts_list ON posts (status, published_at DESC)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    size INTEGER NOT NULL,
    storage TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT NOT NULL, ts INTEGER NOT NULL)`,
];

let ready = null;

export function db(env) {
  if (!env.DB) fail(503, '还没有绑定 D1 数据库：请在 Pages 项目设置里添加名为 DB 的 D1 绑定');
  if (!ready) {
    ready = env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s))).catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready.then(() => env.DB);
}

export const DEFAULT_SETTINGS = {
  title: 'Gali',
  tagline: 'gali的博客',
  author: 'Gali',
  avatar: '',
  favicon: 'G',
  manifesto: '尚未整理。\n想法、记录，以及一些半成品。',
  now: '在想一件很小的事',
  nowEmoji: '◐',
  about: '## 关于\n\n你可以在「工作室 → 设置」里随意改写这一页。\n\n写点什么，或者什么都不写。',
  showHero: true,
  homeLayout: 'index', // index | cards | stream
  defaultMode: 'auto', // auto | day | night
  bodyFont: 'serif', // serif | sans
  fontSize: 17,
  verticalTitle: true,
  webFonts: true,
  perPage: 20,
  nav: [
    { label: '文字', href: '/' },
    { label: '碎片', href: '/?type=note' },
    { label: '归档', href: '/archive' },
    { label: '关于', href: '/about' },
  ],
  links: [],
  footer: '以文字为居所。',
  customCss: '',
  customHead: '',
};

export async function loadSettings(env) {
  const DB = await db(env);
  const row = await DB.prepare(`SELECT value FROM settings WHERE key = 'site'`).first();
  let saved = {};
  if (row) {
    try { saved = JSON.parse(row.value); } catch {}
  }
  return { ...DEFAULT_SETTINGS, ...saved };
}

export function toPost(row, { full = true } = {}) {
  if (!row) return null;
  let tags = [];
  try { tags = JSON.parse(row.tags || '[]'); } catch {}
  const post = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    type: row.type,
    excerpt: row.excerpt,
    cover: row.cover,
    tags,
    status: row.status,
    pinned: !!row.pinned,
    accent: row.accent,
    mood: row.mood,
    layout: row.layout,
    views: row.views,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
  if (row.content !== undefined && full) post.content = row.content;
  if (row.words !== undefined) post.words = row.words;
  return post;
}
