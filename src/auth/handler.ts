import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { verifyTurnstile, type ChallengeAction } from '../security/turnstile';
import { clientIp, consumeLimit, RateLimited } from '../security/limits';
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
const protectedAuth: Record<string, ChallengeAction> = {
  '/api/auth/sign-up/email': 'signup',
  '/api/auth/sign-in/email': 'login',
  '/api/auth/request-password-reset': 'password_reset',
  '/api/auth/send-verification-email': 'verify_email',
};
authRoutes.use('*', async (c, next) => {
  const action =
    c.req.method === 'POST' ? protectedAuth[c.req.path] : undefined;
  if (action) {
    const ip = clientIp(c.req.raw);
    if (!ip)
      return c.json(
        { error: { code: 'INVALID_CLIENT', message: '无法确认请求来源' } },
        403,
      );
    await consumeLimit(
      c.env.DB,
      JSON.stringify(['auth-challenge', action, ip]),
      10,
    );
    if (!(await verifyTurnstile(c.env, c.req.raw, action)))
      return c.json(
        {
          error: {
            code: 'CHALLENGE_FAILED',
            message: '验证失败或已过期，请重新验证',
          },
        },
        403,
      );
  }
  await next();
});
authRoutes.all('*', (c) =>
  createAuth(
    c.env,
    c.env.APP_ENV === 'local' ? undefined : c.executionCtx,
  ).handler(c.req.raw),
);
authRoutes.onError((_error, c) => {
  if (_error instanceof RateLimited) {
    c.header('Retry-After', String(_error.retryAfter));
    return c.json(
      { error: { code: 'RATE_LIMITED', message: _error.message } },
      429,
    );
  }
  console.error(JSON.stringify({ event: 'auth_request_failed' }));
  return c.json(
    { error: { code: 'AUTH_UNAVAILABLE', message: '认证服务暂时不可用' } },
    500,
  );
});
