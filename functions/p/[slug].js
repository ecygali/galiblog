// 文章页仍由前端渲染，这里只把标题、摘要和封面写进 <head>，方便分享卡片与搜索引擎

import { db, loadSettings } from '../../lib/db.js';

export async function onRequestGet({ request, env, params }) {
  const page = await env.ASSETS.fetch(new URL('/', request.url));
  let post = null;
  let site = null;
  try {
    const DB = await db(env);
    post = await DB.prepare(`SELECT title, excerpt, cover, type FROM posts WHERE slug = ? AND status != 'draft'`)
      .bind(decodeURIComponent(params.slug)).first();
    site = await loadSettings(env);
  } catch {}
  if (!post || !site) return page;

  const origin = new URL(request.url).origin;
  const title = (post.title || post.excerpt.slice(0, 30) || '碎片') + ' · ' + site.title;
  const image = post.cover ? new URL(post.cover, origin).href : '';
  const meta = [
    ['description', post.excerpt],
    ['og:title', title],
    ['og:description', post.excerpt],
    ['og:type', 'article'],
    ['og:url', request.url],
    ['og:image', image],
    ['twitter:card', image ? 'summary_large_image' : 'summary'],
  ].filter(([, v]) => v);

  return new HTMLRewriter()
    .on('title', { element(el) { el.setInnerContent(title); } })
    .on('meta[name="description"]', { element(el) { el.remove(); } })
    .on('head', {
      element(el) {
        for (const [k, v] of meta) {
          const attr = k.startsWith('og:') ? 'property' : 'name';
          el.append(`<meta ${attr}="${k}" content="${v.replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`)}">`, { html: true });
        }
      },
    })
    .transform(page);
}
