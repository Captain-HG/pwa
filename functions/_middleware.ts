import { handle } from '../server/router';
import type { D1Like } from '../server/types';

interface PagesEnv {
  DB: D1Database;
}

/** 所有请求（含静态文件）先经过这里：校验登录，处理 /login 与 /api/* */
export const onRequest: PagesFunction<PagesEnv> = (ctx) =>
  handle(ctx.request, { DB: ctx.env.DB as unknown as D1Like }, () => ctx.next());
