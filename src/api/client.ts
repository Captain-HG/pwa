export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let fetchImpl: FetchLike = (input, init) => fetch(input, init);
let unauthorizedHandler: () => void = () => {};

/** 测试时替换为进程内的服务端 */
export function setApiFetch(fn: FetchLike): void {
  fetchImpl = fn;
}

/** 收到 401（未登录 / 会话被移除 / 已过期）时调用 */
export function onUnauthorized(fn: () => void): void {
  unauthorizedHandler = fn;
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetchImpl(path, {
    method: options.method ?? 'GET',
    headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    unauthorizedHandler();
    throw new ApiError(401, '登录已失效，请重新登录');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `请求失败（${res.status}）`);
  return data as T;
}
