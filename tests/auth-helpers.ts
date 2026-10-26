import { Miniflare } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { authRoutes } from '../src/auth/handler';

export const password = 'Test password for local auth 42!';
export async function setupDatabase() {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-07-30',
    d1Databases: ['DB'],
  });
  const env: Env = {
    DB: await mf.getD1Database('DB'),
    APP_ENV: 'local',
    AUTH_MAIL_MODE: 'local',
    BETTER_AUTH_URL: 'http://localhost',
    AUTH_MAIL_FROM: 'noreply@example.invalid',
    BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
    AUTH_EMAIL: {
      send: async () => {
        throw new Error('External email must not be used in local tests');
      },
    },
  };
  for (const file of readdirSync('db/migrations')
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    for (const statement of readFileSync(`db/migrations/${file}`, 'utf8').split(
      '--> statement-breakpoint',
    )) {
      if (statement.trim()) await env.DB.prepare(statement).run();
    }
  }
  const seed = readFileSync('db/seed.sql', 'utf8').replace(/^--.*$/gm, '');
  for (const statement of seed.split(';').filter((s) => s.trim()))
    await env.DB.prepare(statement).run();
  return { env, mf };
}
export function authRequest(
  env: Env,
  path: string,
  body?: unknown,
  cookie = '',
  ip = '192.0.2.1',
) {
  return authRoutes.request(
    `${env.BETTER_AUTH_URL}/api/auth${path}`,
    {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Origin: env.BETTER_AUTH_URL,
        'Content-Type': 'application/json',
        Cookie: cookie,
        'cf-connecting-ip': ip,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
    { waitUntil: () => {}, passThroughOnException: () => {}, props: {} },
  );
}
export function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}
export async function mailLink(
  env: Env,
  email: string,
  kind: 'verification' | 'reset',
) {
  const mail = await env.DB.prepare(
    'SELECT url FROM dev_mail WHERE recipient = ? AND kind = ? ORDER BY created_at DESC, id DESC LIMIT 1',
  )
    .bind(email, kind)
    .first<{ url: string }>();
  if (!mail) throw new Error('Expected local auth email');
  return mail.url;
}
export async function registerVerified(
  env: Env,
  email = `${crypto.randomUUID()}@example.com`,
  ip = '192.0.2.1',
) {
  const signup = await authRequest(
    env,
    '/sign-up/email',
    { email, password, name: '测试成员', callbackURL: '/login' },
    '',
    ip,
  );
  if (signup.status !== 200) throw new Error(`Signup failed: ${signup.status}`);
  const verification = new URL(await mailLink(env, email, 'verification'));
  const verify = await authRequest(
    env,
    verification.pathname.replace('/api/auth', '') + verification.search,
    undefined,
    '',
    ip,
  );
  if (![200, 302].includes(verify.status))
    throw new Error(`Verification failed: ${verify.status}`);
  const login = await authRequest(
    env,
    '/sign-in/email',
    { email, password },
    '',
    ip,
  );
  if (login.status !== 200) throw new Error(`Login failed: ${login.status}`);
  return { email, cookie: cookies(login), login };
}
