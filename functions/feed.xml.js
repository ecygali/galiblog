// RSS 订阅：/feed.xml

import { marked } from '../public/assets/vendor/marked.esm.js';
import { db, loadSettings } from '../lib/db.js';

const esc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const cdata = (s) => '<![CDATA[' + String(s).replace(/]]>/g, ']]]]><![CDATA[>') + ']]>';

export async function onRequestGet({ request, env }) {
  const origin = new URL(request.url).origin;
  try {
    const DB = await db(env);
    const site = await loadSettings(env);
    const rows = await DB.prepare(`SELECT * FROM posts WHERE status = 'published' AND type != 'page'
      ORDER BY published_at DESC LIMIT 30`).all();
    const items = rows.results.map((p) => {
      const link = `${origin}/p/${encodeURIComponent(p.slug)}`;
      const html = marked.parse(p.content.replace(/\]\(\/f\//g, `](${origin}/f/`), { async: false });
      const title = p.title || (p.excerpt || '').slice(0, 40) || '碎片';
      return `<item><title>${esc(title)}</title><link>${link}</link><guid>${link}</guid>`
        + `<pubDate>${new Date(p.published_at).toUTCString()}</pubDate>`
        + `<description>${cdata(html)}</description></item>`;
    }).join('');
    const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>`
      + `<title>${esc(site.title)}</title><link>${origin}/</link><description>${esc(site.tagline)}</description>`
      + `${items}</channel></rss>`;
    return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=600' } });
  } catch (e) {
    return new Response('Feed unavailable: ' + e.message, { status: 503 });
  }
}
