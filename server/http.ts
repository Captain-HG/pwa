export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export function errorResponse(message: string, status: number): Response {
  return json({ error: message }, status);
}

export function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

export const SESSION_COOKIE = '__Host-sid';

export function getCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('Cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

export function sessionCookie(token: string, maxAgeSec: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, '请求格式错误');
  }
}

/** 写接口的 CSRF 防护：Origin 必须同源；带请求体的必须是 JSON */
export function checkWriteRequest(request: Request): Response | null {
  const origin = request.headers.get('Origin');
  if (origin) {
    let host = '';
    try {
      host = new URL(origin).host;
    } catch {
      /* 非法 Origin 按跨站处理 */
    }
    if (host !== new URL(request.url).host) return errorResponse('禁止跨站请求', 403);
  }
  if ((request.method === 'POST' || request.method === 'PATCH' || request.method === 'PUT') && !request.headers.get('Content-Type')?.includes('application/json')) {
    return errorResponse('仅接受 JSON 请求', 403);
  }
  return null;
}
