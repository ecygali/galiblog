// 上传文件的访问地址：/f/<id>/<文件名>

import { db } from '../../lib/db.js';
import { getObject } from '../../lib/storage.js';

const INLINE = /^(image|video|audio|text)\/|^application\/pdf$/;
const DANGEROUS = /svg|html|xml|javascript/;

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!m || (!m[1] && !m[2])) return null;
  if (!m[1]) return { suffix: Math.min(+m[2], size) };
  const offset = +m[1];
  if (offset >= size) return null;
  const end = m[2] ? Math.min(+m[2], size - 1) : size - 1;
  return { offset, length: end - offset + 1 };
}

export async function onRequestGet({ request, env, params }) {
  const id = (params.path || [])[0];
  if (!id) return new Response('Not found', { status: 404 });
  let row;
  try {
    row = await (await db(env)).prepare('SELECT * FROM files WHERE id = ?').bind(id).first();
  } catch {
    return new Response('Storage not configured', { status: 503 });
  }
  if (!row) return new Response('Not found', { status: 404 });

  const range = row.storage === 'r2' ? parseRange(request.headers.get('range'), row.size) : null;
  const obj = await getObject(env, id, row.storage, range);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  headers.set('content-type', row.type);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('x-content-type-options', 'nosniff');
  const disp = INLINE.test(row.type) && !DANGEROUS.test(row.type) ? 'inline' : 'attachment';
  headers.set('content-disposition', `${disp}; filename*=UTF-8''${encodeURIComponent(row.name)}`);
  if (DANGEROUS.test(row.type)) headers.set('content-security-policy', 'sandbox');
  if (row.storage === 'r2') headers.set('accept-ranges', 'bytes');

  if (range && obj.range) {
    const start = range.suffix !== undefined ? row.size - range.suffix : range.offset;
    const len = range.suffix !== undefined ? range.suffix : range.length;
    headers.set('content-range', `bytes ${start}-${start + len - 1}/${row.size}`);
    headers.set('content-length', String(len));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('content-length', String(row.size));
  return new Response(obj.body, { headers });
}

export const onRequestHead = onRequestGet;
