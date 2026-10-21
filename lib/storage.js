// 文件存储：优先使用 R2（绑定名 FILES），没有 R2 时退回 KV（绑定名 FILES_KV）

import { fail } from './util.js';

export function storageKind(env) {
  if (env.FILES && typeof env.FILES.head === 'function') return 'r2';
  if (env.FILES_KV) return 'kv';
  return null;
}

export const LIMITS = { r2: 95 * 1024 * 1024, kv: 25 * 1024 * 1024 };

export async function putObject(env, key, file) {
  const kind = storageKind(env);
  if (!kind) fail(503, '还没有绑定文件存储：请添加名为 FILES 的 R2 存储桶，或名为 FILES_KV 的 KV 命名空间');
  if (file.size > LIMITS[kind]) fail(413, `文件太大了，当前存储上限 ${Math.round(LIMITS[kind] / 1048576)}MB`);
  const type = file.type || 'application/octet-stream';
  if (kind === 'r2') {
    await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: type } });
  } else {
    await env.FILES_KV.put(key, await file.arrayBuffer(), { metadata: { type } });
  }
  return kind;
}

export async function getObject(env, key, storage, range) {
  if (storage === 'r2') {
    if (!env.FILES) return null;
    const obj = await env.FILES.get(key, range ? { range } : undefined);
    if (!obj) return null;
    return { body: obj.body, size: obj.size, range: obj.range, etag: obj.httpEtag };
  }
  if (!env.FILES_KV) return null;
  const { value, metadata } = await env.FILES_KV.getWithMetadata(key, { type: 'stream' });
  if (!value) return null;
  return { body: value, type: metadata?.type };
}

export async function deleteObject(env, key, storage) {
  if (storage === 'r2' && env.FILES) await env.FILES.delete(key);
  if (storage === 'kv' && env.FILES_KV) await env.FILES_KV.delete(key);
}
