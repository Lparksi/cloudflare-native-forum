export class RateLimited extends Error {
  constructor(public retryAfter: number) {
    super('操作过于频繁，请稍后重试');
  }
}
export function clientIp(request: Request) {
  const ip = request.headers.get('cf-connecting-ip');
  if (ip && ip.length <= 64) return ip;
  return ['localhost', '127.0.0.1', '[::1]'].includes(
    new URL(request.url).hostname,
  )
    ? '127.0.0.1'
    : null;
}
export async function consumeLimit(
  db: D1Database,
  key: string,
  limit: number,
  now = Date.now(),
) {
  const expires = (Math.floor(now / 60000) + 1) * 60000;
  const result = await db
    .prepare(
      `INSERT INTO write_limits(key,count,expires_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN expires_at <= ? THEN 1 ELSE count + 1 END,
    expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
    WHERE expires_at <= ? OR count < ? RETURNING key`,
    )
    .bind(key, expires, now, now, now, limit)
    .all();
  if (!result.results.length)
    throw new RateLimited(Math.max(1, Math.ceil((expires - now) / 1000)));
}
export function configuredLimit(value: string) {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error('Invalid rate limit configuration');
  return limit;
}
export async function postingLimit(
  env: Env,
  action: 'topic' | 'reply' | 'report',
  userId: string,
  ip: string,
) {
  const max =
    action === 'topic'
      ? configuredLimit(env.TOPIC_RATE_LIMIT)
      : action === 'reply'
        ? configuredLimit(env.REPLY_RATE_LIMIT)
        : 5;
  await consumeLimit(env.DB, JSON.stringify([action, 'ip', ip]), max * 3);
  await consumeLimit(env.DB, JSON.stringify([action, 'user', userId]), max);
}
