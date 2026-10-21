// 口令校验与会话 Cookie。
// Cookie 里存的不是密码本身，而是「过期时间 + HMAC 签名」。修改 ADMIN_PASSWORD 后所有旧会话自动失效。

const COOKIE = 'gali_session';
const enc = new TextEncoder();

function b64url(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const secretOf = (env) => (env.SESSION_SECRET || '') + '\u0000' + (env.ADMIN_PASSWORD || '');

export async function checkPassword(env, input) {
  if (!env.ADMIN_PASSWORD) return false;
  // 对两边都做 HMAC 再比较，避免长度与逐字节比较泄漏时间信息
  const [a, b] = await Promise.all([
    hmac('pw-compare', String(input || '')),
    hmac('pw-compare', env.ADMIN_PASSWORD),
  ]);
  return safeEqual(a, b);
}

export async function issueCookie(env, request, remember) {
  const maxAge = remember ? 60 * 60 * 24 * 180 : 60 * 60 * 12;
  const exp = Date.now() + maxAge * 1000;
  const sig = await hmac(secretOf(env), 'gali:' + exp);
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  const age = remember ? `; Max-Age=${maxAge}` : '';
  return `${COOKIE}=${exp}.${sig}; Path=/; HttpOnly; SameSite=Lax${secure}${age}`;
}

export function clearCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
}

function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return '';
}

export async function isAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const value = readCookie(request, COOKIE);
  const dot = value.indexOf('.');
  if (dot < 1) return false;
  const exp = Number(value.slice(0, dot));
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = await hmac(secretOf(env), 'gali:' + exp);
  return safeEqual(expected, value.slice(dot + 1));
}
