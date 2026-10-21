// 服务端通用小工具

export function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const fail = (status, message) => { throw new HttpError(status, message); };

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    fail(400, '请求体不是合法的 JSON');
  }
}

const ALPHABET = '0123456789abcdefghijkmnpqrstuvwxyz';
export function newId(len = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

// 保留中日韩文字，URL 里会被编码，但浏览器地址栏显示的仍是原文
export function slugify(input) {
  return String(input || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export const now = () => Date.now();

export function clampStr(v, max, fallback = '') {
  if (typeof v !== 'string') return fallback;
  return v.slice(0, max);
}
