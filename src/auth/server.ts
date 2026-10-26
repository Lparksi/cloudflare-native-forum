import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/auth-schema';
import { authOptions } from './options';
import { localMailboxAllowed, sendAuthMail } from './mail';

export function authEnabled(env: Env, url: string) {
  if (env.AUTH_MAIL_MODE === 'disabled') return false;
  if (new URL(url).origin !== new URL(env.BETTER_AUTH_URL).origin) return false;
  return env.AUTH_MAIL_MODE === 'cloudflare' || localMailboxAllowed(env, url);
}
export function createAuth(
  env: Env,
  executionCtx?: Pick<ExecutionContext, 'waitUntil'>,
) {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32)
    throw new Error(
      'BETTER_AUTH_SECRET must contain at least 32 random characters',
    );
  const origin = new URL(env.BETTER_AUTH_URL);
  if (env.AUTH_MAIL_MODE === 'cloudflare' && origin.protocol !== 'https:')
    throw new Error('Remote authentication requires HTTPS');
  return betterAuth({
    ...authOptions,
    baseURL: origin.origin,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [origin.origin],
    database: drizzleAdapter(drizzle(env.DB), {
      provider: 'sqlite',
      schema,
      transaction: false,
    }),
    emailAndPassword: {
      ...authOptions.emailAndPassword,
      sendResetPassword: async ({ user, url }) =>
        sendAuthMail(env, { to: user.email, kind: 'reset', url }),
    },
    emailVerification: {
      ...authOptions.emailVerification,
      sendVerificationEmail: async ({ user, url }) =>
        sendAuthMail(env, { to: user.email, kind: 'verification', url }),
    },
    advanced: {
      disableOriginCheck: false,
      disableCSRFCheck: false,
      useSecureCookies: origin.protocol === 'https:',
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      ...(executionCtx
        ? {
            backgroundTasks: {
              handler: (promise: Promise<unknown>) =>
                executionCtx.waitUntil(
                  promise.catch(() => {
                    console.error(
                      JSON.stringify({ event: 'auth_background_task_failed' }),
                    );
                  }),
                ),
            },
          }
        : {}),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (
              user.name.trim().length < 1 ||
              user.name.length > 80 ||
              user.name.includes('\0')
            )
              throw new APIError('BAD_REQUEST', {
                message: '显示名称需 1–80 字，且不能包含 NUL',
              });
            return { data: { ...user, name: user.name.trim() } };
          },
        },
      },
    },
    // Avoid retaining token URLs or account details in framework logs.
    logger: { disabled: true },
  });
}
export async function getSession(env: Env, request: Request) {
  if (!authEnabled(env, request.url)) return null;
  return createAuth(env).api.getSession({
    headers: request.headers,
    query: { disableRefresh: true },
  });
}
