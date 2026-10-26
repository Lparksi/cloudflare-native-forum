import { localWriteAllowed } from '../lib/contracts';
import { clientIp, consumeLimit } from './limits';
export const actions = [
  'signup',
  'login',
  'password_reset',
  'verify_email',
  'topic',
  'reply',
  'report',
] as const;
export type ChallengeAction = (typeof actions)[number];
export function localChallengeAllowed(env: Env, url: string) {
  return (
    env.TURNSTILE_MODE === 'local' &&
    localWriteAllowed(env.APP_ENV, url) &&
    new URL(url).origin === new URL(env.BETTER_AUTH_URL).origin
  );
}
export async function issueLocalChallenge(
  env: Env,
  request: Request,
  action: ChallengeAction,
) {
  if (!localChallengeAllowed(env, request.url)) return null;
  const ip = clientIp(request)!;
  await consumeLimit(env.DB, JSON.stringify(['challenge', ip]), 100);
  const now = Date.now();
  await env.DB.prepare('DELETE FROM local_challenges WHERE expires_at <= ?')
    .bind(now)
    .run();
  const token = `local.${crypto.randomUUID()}`;
  await env.DB.prepare(
    'INSERT INTO local_challenges(token,action,ip,expires_at) VALUES (?,?,?,?)',
  )
    .bind(token, action, ip, now + 300000)
    .run();
  return token;
}
export async function verifyTurnstile(
  env: Env,
  request: Request,
  action: ChallengeAction,
  fetcher: typeof fetch = fetch,
) {
  const token = request.headers.get('x-turnstile-token');
  if (!token || token.length > 2048) return false;
  const ip = clientIp(request);
  if (!ip) return false;
  if (env.TURNSTILE_MODE === 'local') {
    if (!localChallengeAllowed(env, request.url)) return false;
    const result = await env.DB.prepare(
      'DELETE FROM local_challenges WHERE token = ? AND action = ? AND ip = ? AND expires_at > ? RETURNING token',
    )
      .bind(token, action, ip, Date.now())
      .all();
    return result.results.length === 1;
  }
  if (env.TURNSTILE_MODE !== 'managed' || !env.TURNSTILE_SECRET) return false;
  const hostname = new URL(env.BETTER_AUTH_URL).hostname;
  if (
    env.APP_ENV !== 'local' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
  )
    return false;
  try {
    const response = await fetcher(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET,
          response: token,
          remoteip: ip,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) return false;
    const result: unknown = await response.json();
    return (
      typeof result === 'object' &&
      result !== null &&
      'success' in result &&
      result.success === true &&
      'action' in result &&
      result.action === action &&
      'hostname' in result &&
      result.hostname === hostname
    );
  } catch {
    return false;
  }
}
