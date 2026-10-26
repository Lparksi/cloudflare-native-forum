import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import {
  setupDatabase,
  authRequest,
  cookies,
  mailLink,
  password,
  registerVerified,
} from './auth-helpers';
import { authRoutes } from '../src/auth/handler';
import { api } from '../src/lib/api';
import { createAuth } from '../src/auth/server';
import { sendAuthMail } from '../src/auth/mail';

let fixture: Awaited<ReturnType<typeof setupDatabase>>;
let env: Env;
beforeAll(async () => {
  fixture = await setupDatabase();
  env = fixture.env;
});
beforeEach(async () => {
  await env.DB.prepare('DELETE FROM rate_limit').run();
  await env.DB.prepare('DELETE FROM write_limits').run();
});
afterAll(async () => {
  await fixture.mf.dispose();
});
const signup = (email: string, overrides = {}) =>
  authRequest(env, '/sign-up/email', {
    email,
    password,
    name: '注册测试',
    callbackURL: '/login?verified=1',
    ...overrides,
  });

describe('Better Auth on D1', () => {
  it('requires verification, stores a password hash, preserves generic signup results', async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    const response = await signup(email);
    expect(response.status).toBe(200);
    expect(cookies(response)).not.toContain('session_token');
    expect(await (await authRequest(env, '/get-session')).json()).toBeNull();
    expect(
      (await authRequest(env, '/sign-in/email', { email, password })).status,
    ).toBe(403);
    const credential = await env.DB.prepare(
      'SELECT password FROM account INNER JOIN user ON user.id = account.user_id WHERE user.email = ?',
    )
      .bind(email)
      .first<{ password: string }>();
    expect(credential?.password).toBeTruthy();
    expect(credential?.password).not.toBe(password);
    const duplicate = await signup(email);
    expect(duplicate.status).toBe(200);
    expect(cookies(duplicate)).not.toContain('session_token');
    const verify = new URL(await mailLink(env, email, 'verification'));
    expect(
      (await authRequest(env, `/verify-email${verify.search}`)).status,
    ).toBe(302);
    const login = await authRequest(env, '/sign-in/email', { email, password });
    expect(login.status).toBe(200);
    const setCookie = login.headers.getSetCookie().join(';');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    const cookie = cookies(login);
    expect(
      await (await authRequest(env, '/get-session', undefined, cookie)).json(),
    ).toMatchObject({ user: { email, emailVerified: true } });
    const tampered = cookie.replace(
      /session_token=[^;]+/,
      'session_token=forged',
    );
    expect(
      await (
        await authRequest(env, '/get-session', undefined, tampered)
      ).json(),
    ).toBeNull();
    expect((await authRequest(env, '/sign-out', {}, cookie)).status).toBe(200);
    expect(
      await (await authRequest(env, '/get-session', undefined, cookie)).json(),
    ).toBeNull();
  });
  it('does not expose default profile updates that bypass the name contract', async () => {
    const { email, cookie } = await registerVerified(env);
    for (const name of ['', 'x'.repeat(81), '\0name']) {
      expect(
        (await authRequest(env, '/update-user', { name }, cookie)).status,
      ).toBe(404);
    }
    expect(
      (
        await env.DB.prepare('SELECT name FROM user WHERE email = ?')
          .bind(email)
          .first<{ name: string }>()
      )?.name,
    ).toBe('测试成员');
  });
  it('resends verification without exposing account existence and rejects invalid/expired verification', async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    await signup(email);
    const known = await authRequest(env, '/send-verification-email', {
      email,
      callbackURL: '/login',
    });
    const unknown = await authRequest(env, '/send-verification-email', {
      email: 'absent@example.com',
      callbackURL: '/login',
    });
    expect(known.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());
    expect((await authRequest(env, '/verify-email?token=invalid')).status).toBe(
      401,
    );
    // Library signs verification JWTs; an expired token is generated through the same official helper.
    const { createEmailVerificationToken } = await import('better-auth/api');
    const expired = await createEmailVerificationToken(
      env.BETTER_AUTH_SECRET,
      email,
      undefined,
      -1,
    );
    expect(
      (await authRequest(env, `/verify-email?token=${expired}`)).status,
    ).toBe(401);
  });
  it('resets a password once and revokes all existing sessions', async () => {
    const { email, cookie } = await registerVerified(env);
    const anotherLogin = await authRequest(env, '/sign-in/email', {
      email,
      password,
    });
    const anotherCookie = cookies(anotherLogin);
    const known = await authRequest(env, '/request-password-reset', {
      email,
      redirectTo: '/reset-password',
    });
    const unknown = await authRequest(env, '/request-password-reset', {
      email: 'absent@example.com',
      redirectTo: '/reset-password',
    });
    expect(known.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());
    const url = new URL(await mailLink(env, email, 'reset'));
    const token = url.pathname.split('/').at(-1)!;
    const newPassword = 'A different test password 2026!';
    const reset = await authRequest(env, '/reset-password', {
      token,
      newPassword,
    });
    expect(reset.status).toBe(200);
    expect(
      (await authRequest(env, '/reset-password', { token, newPassword }))
        .status,
    ).toBe(400);
    expect(
      await (await authRequest(env, '/get-session', undefined, cookie)).json(),
    ).toBeNull();
    expect(
      await (
        await authRequest(env, '/get-session', undefined, anotherCookie)
      ).json(),
    ).toBeNull();
    expect(
      (await authRequest(env, '/sign-in/email', { email, password })).status,
    ).toBe(401);
    expect(
      (
        await authRequest(env, '/sign-in/email', {
          email,
          password: newPassword,
        })
      ).status,
    ).toBe(200);
  });
  it('consumes a reset token atomically under concurrent submissions', async () => {
    const { email } = await registerVerified(env);
    await authRequest(env, '/request-password-reset', {
      email,
      redirectTo: '/reset-password',
    });
    const token = new URL(await mailLink(env, email, 'reset')).pathname
      .split('/')
      .at(-1)!;
    const results = await Promise.all(
      [0, 1].map(() =>
        authRequest(env, '/reset-password', {
          token,
          newPassword: 'Concurrent reset password 2026!',
        }),
      ),
    );
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 400,
    ]);
  });
  it('fails closed on a D1 password write failure and permits requesting a fresh link', async () => {
    const { email, cookie } = await registerVerified(env);
    await authRequest(env, '/request-password-reset', {
      email,
      redirectTo: '/reset-password',
    });
    const token = new URL(await mailLink(env, email, 'reset')).pathname
      .split('/')
      .at(-1)!;
    await env.DB.prepare(
      "CREATE TRIGGER fail_password_update BEFORE UPDATE OF password ON account BEGIN SELECT RAISE(ABORT, 'simulated-write-failure'); END",
    ).run();
    try {
      expect(
        (
          await authRequest(env, '/reset-password', {
            token,
            newPassword: 'Failure path password 2026!',
          })
        ).status,
      ).toBe(500);
    } finally {
      await env.DB.prepare('DROP TRIGGER fail_password_update').run();
    }
    expect(
      await (await authRequest(env, '/get-session', undefined, cookie)).json(),
    ).toBeNull();
    expect(
      (
        await authRequest(env, '/reset-password', {
          token,
          newPassword: password,
        })
      ).status,
    ).toBe(400);
    expect(
      (await authRequest(env, '/sign-in/email', { email, password })).status,
    ).toBe(200);
    expect(
      (
        await authRequest(env, '/request-password-reset', {
          email,
          redirectTo: '/reset-password',
        })
      ).status,
    ).toBe(200);
    const fresh = new URL(await mailLink(env, email, 'reset')).pathname
      .split('/')
      .at(-1)!;
    expect(fresh).not.toBe(token);
    expect(
      (
        await authRequest(env, '/reset-password', {
          token: fresh,
          newPassword: 'Recovered test password 2026!',
        })
      ).status,
    ).toBe(200);
  });
  it('rejects expired reset tokens and expired sessions', async () => {
    const { email, cookie } = await registerVerified(env);
    await authRequest(env, '/request-password-reset', {
      email,
      redirectTo: '/reset-password',
    });
    const token = new URL(await mailLink(env, email, 'reset')).pathname
      .split('/')
      .at(-1)!;
    await env.DB.prepare(
      'UPDATE verification SET expires_at = 0 WHERE identifier = ?',
    )
      .bind(`reset-password:${token}`)
      .run();
    expect(
      (
        await authRequest(env, '/reset-password', {
          token,
          newPassword: password,
        })
      ).status,
    ).toBe(400);
    await env.DB.prepare('UPDATE session SET expires_at = 0').run();
    expect(
      await (await authRequest(env, '/get-session', undefined, cookie)).json(),
    ).toBeNull();
  });
  it('rejects CSRF, external callbacks and oversized bodies', async () => {
    const response = await authRoutes.request(
      `${env.BETTER_AUTH_URL}/api/auth/sign-in/email`,
      {
        method: 'POST',
        headers: {
          Origin: 'https://evil.example',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'a@example.com', password }),
      },
      env,
    );
    expect(response.status).toBe(403);
    const missingOrigin = await authRoutes.request(
      `${env.BETTER_AUTH_URL}/api/auth/sign-out`,
      { method: 'POST' },
      env,
    );
    expect(missingOrigin.status).toBe(403);
    expect(
      (
        await signup(`${crypto.randomUUID()}@example.com`, {
          callbackURL: 'https://evil.example',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await authRequest(env, '/request-password-reset', {
          email: 'a@example.com',
          redirectTo: 'https://evil.example',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await signup(`${crypto.randomUUID()}@example.com`, {
          name: 'x'.repeat(17000),
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await signup(`${crypto.randomUUID()}@example.com`, {
          password: 'short',
        })
      ).status,
    ).toBe(400);
  });
  it('enforces persisted sign-in and reset rate limits', async () => {
    const requests = [];
    for (let i = 0; i < 6; i++)
      requests.push(
        await authRequest(env, '/sign-in/email', {
          email: 'absent@example.com',
          password,
        }),
      );
    expect(
      requests.slice(0, 5).every((response) => response.status === 401),
    ).toBe(true);
    expect(requests[5].status).toBe(429);
    for (let i = 0; i < 3; i++)
      expect(
        (
          await authRequest(env, '/request-password-reset', {
            email: 'absent@example.com',
          })
        ).status,
      ).toBe(200);
    expect(
      (
        await authRequest(env, '/request-password-reset', {
          email: 'absent@example.com',
        })
      ).status,
    ).toBe(429);
    expect(
      (await env.DB.prepare('SELECT count(*) AS n FROM rate_limit').first<{
        n: number;
      }>())!.n,
    ).toBeGreaterThan(0);
  });
  it('hides local mailbox and disables auth in unconfigured remote environments', async () => {
    for (const APP_ENV of ['test', 'production']) {
      const remote = { ...env, APP_ENV, AUTH_MAIL_MODE: 'disabled' };
      expect((await authRequest(remote, '/get-session')).status).toBe(503);
      expect(
        (
          await api.request(
            `${env.BETTER_AUTH_URL}/api/v1/dev/mail`,
            {},
            remote,
          )
        ).status,
      ).toBe(404);
      await expect(
        sendAuthMail(
          { ...remote, AUTH_MAIL_MODE: 'local' },
          { to: 'local@example.com', kind: 'reset', url: 'http://localhost' },
        ),
      ).rejects.toThrow();
    }
    expect(
      (await api.request('https://public.example/api/v1/dev/mail', {}, env))
        .status,
    ).toBe(404);
  });
  it('uses Secure cookies over HTTPS and the native email binding without a local token copy', async () => {
    const sent: EmailMessageBuilder[] = [];
    const remote: Env = {
      ...env,
      APP_ENV: 'test',
      AUTH_MAIL_MODE: 'cloudflare',
      BETTER_AUTH_URL: 'https://test.example.com',
      AUTH_MAIL_FROM: 'noreply@example.com',
      AUTH_EMAIL: {
        send: async (mail: EmailMessage | EmailMessageBuilder) => {
          if ('subject' in mail) sent.push(mail);
          return { messageId: 'test-message' };
        },
      },
    };
    const { email } = await registerVerified(env);
    const response = await createAuth(remote).api.signInEmail({
      body: { email, password },
      headers: new Headers({ Origin: remote.BETTER_AUTH_URL }),
      asResponse: true,
    });
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().join(';')).toContain('Secure');
    expect(response.headers.getSetCookie().join(';')).toContain('__Secure-');
    await sendAuthMail(remote, {
      to: email,
      kind: 'reset',
      url: 'https://test.example.com/reset-password?token=test',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: email, subject: '重置你的 0xca 密码' });
    expect(() => createAuth({ ...remote, BETTER_AUTH_SECRET: '' })).toThrow();
    expect(() =>
      createAuth({ ...remote, BETTER_AUTH_URL: 'http://test.example.com' }),
    ).toThrow();
  });
});
