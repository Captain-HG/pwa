/** 密码哈希与令牌。只用 Web Crypto，Workers 与 Node 20 都可运行 */

export const DEFAULT_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const enc = new TextEncoder();

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function randomToken(): string {
  return toBase64Url(randomBytes(32));
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, HASH_BYTES * 8);
  return new Uint8Array(bits);
}

/** 格式：pbkdf2_sha256$<迭代次数>$<盐 base64>$<哈希 base64>，与 scripts/create_user.py 一致 */
export async function hashPassword(password: string, iterations = DEFAULT_ITERATIONS): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2_sha256$${iterations}$${toBase64(salt)}$${toBase64(hash)}`;
}

// 用户不存在时用它走一遍计算，使响应时间与真实校验一致
const DUMMY_HASH = `pbkdf2_sha256$${DEFAULT_ITERATIONS}$${'A'.repeat(22)}==$${'A'.repeat(43)}=`;

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parts = (stored ?? DUMMY_HASH).split('$');
  const valid = parts.length === 4 && parts[0] === 'pbkdf2_sha256';
  const [, iterStr, saltB64, hashB64] = valid ? parts : DUMMY_HASH.split('$');
  const iterations = Number(iterStr);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  const actual = await pbkdf2(password, fromBase64(saltB64), iterations);
  return timingSafeEqual(actual, fromBase64(hashB64)) && valid && stored != null;
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
