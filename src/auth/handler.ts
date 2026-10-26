import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { authEnabled, createAuth } from './server';

export const authRoutes = new Hono<{ Bindings: Env }>();
authRoutes.use('*', async (c, next) => {
  if (!authEnabled(c.env, c.req.url))
    return c.json(
      { error: { code: 'AUTH_DISABLED', message: '当前环境未开放认证' } },
      503,
    );
  // All state-changing requests require an explicit same-origin browser request.
  if (
    !['GET', 'HEAD'].includes(c.req.method) &&
    c.req.header('origin') !== new URL(c.env.BETTER_AUTH_URL).origin
  ) {
    return c.json(
      { error: { code: 'INVALID_ORIGIN', message: '请求来源无效' } },
      403,
    );
  }
  await next();
});
authRoutes.use(
  '*',
  bodyLimit({
    maxSize: 16384,
    onError: (c) =>
      c.json(
        { error: { code: 'BODY_TOO_LARGE', message: '请求内容过大' } },
        413,
      ),
  }),
);
authRoutes.all('*', (c) =>
  createAuth(
    c.env,
    c.env.APP_ENV === 'local' ? undefined : c.executionCtx,
  ).handler(c.req.raw),
);
authRoutes.onError((_error, c) => {
  console.error(JSON.stringify({ event: 'auth_request_failed' }));
  return c.json(
    { error: { code: 'AUTH_UNAVAILABLE', message: '认证服务暂时不可用' } },
    500,
  );
});
