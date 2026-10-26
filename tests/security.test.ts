import { beforeAll, beforeEach, afterAll, it, expect, vi } from 'vitest';
import { setupDatabase, registerVerified, testProof } from './auth-helpers';
import { consumeLimit, postingLimit } from '../src/security/limits';
import {
  issueLocalChallenge,
  verifyTurnstile,
} from '../src/security/turnstile';
import { api } from '../src/lib/api';
let fixture: Awaited<ReturnType<typeof setupDatabase>>, env: Env;
beforeAll(async () => {
  fixture = await setupDatabase();
  env = fixture.env;
});
beforeEach(async () => {
  await env.DB.prepare('DELETE FROM write_limits').run();
  await env.DB.prepare('DELETE FROM local_challenges').run();
});
afterAll(async () => {
  await fixture.mf.dispose();
});
function request(token: string, url = 'http://localhost/api/v1/topics') {
  return new Request(url, { headers: { 'x-turnstile-token': token } });
}
it('requires action, IP, expiry and single-use in the explicit local simulator', async () => {
  const token = (await issueLocalChallenge(env, request(''), 'topic'))!;
  expect(
    await verifyTurnstile(
      env,
      new Request('http://localhost/api/v1/topics', {
        headers: {
          'x-turnstile-token': token,
          'cf-connecting-ip': '192.0.2.44',
        },
      }),
      'topic',
    ),
  ).toBe(false);
  expect(await verifyTurnstile(env, request(token), 'reply')).toBe(false);
  expect(await verifyTurnstile(env, request(token), 'topic')).toBe(true);
  expect(await verifyTurnstile(env, request(token), 'topic')).toBe(false);
  const expired = (await issueLocalChallenge(env, request(''), 'topic'))!;
  await env.DB.prepare('UPDATE local_challenges SET expires_at=0 WHERE token=?')
    .bind(expired)
    .run();
  expect(await verifyTurnstile(env, request(expired), 'topic')).toBe(false);
  expect(
    await verifyTurnstile(
      { ...env, APP_ENV: 'production' },
      request('local.anything'),
      'topic',
    ),
  ).toBe(false);
  expect(
    await issueLocalChallenge(
      { ...env, APP_ENV: 'production' },
      request(''),
      'topic',
    ),
  ).toBeNull();
});
it('strictly validates real Siteverify action/hostname and never accepts dummy metadata alone', async () => {
  const managed = {
    ...env,
    APP_ENV: 'test',
    TURNSTILE_MODE: 'managed',
    TURNSTILE_SECRET: crypto.randomUUID(),
    BETTER_AUTH_URL: 'https://forum.example.com',
  };
  const req = new Request('https://forum.example.com/api/v1/topics', {
    headers: {
      'x-turnstile-token': 'a-fresh-token',
      'cf-connecting-ip': '192.0.2.1',
    },
  });
  for (const result of [
    { success: true, action: 'topic', hostname: 'forum.example.com' },
    { success: true, action: 'login', hostname: 'forum.example.com' },
    { success: true, action: 'topic', hostname: 'evil.example' },
    { success: true, hostname: 'forum.example.com' },
    { success: false, 'error-codes': ['timeout-or-duplicate'] },
    {
      success: true,
      hostname: 'example.com',
      metadata: { result_with_testing_key: true },
    },
  ]) {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(result));
    expect(await verifyTurnstile(managed, req, 'topic', fetcher)).toBe(
      'action' in result &&
        result.action === 'topic' &&
        result.hostname === 'forum.example.com' &&
        result.success,
    );
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    );
    const body = fetcher.mock.calls[0][1]!.body as URLSearchParams;
    expect(body.get('response')).toBe('a-fresh-token');
    expect(body.get('remoteip')).toBe('192.0.2.1');
  }
});
it('fails closed for missing/large tokens, network/non-JSON/non-2xx and disabled configuration', async () => {
  const managed = {
    ...env,
    TURNSTILE_MODE: 'managed',
    TURNSTILE_SECRET: crypto.randomUUID(),
  };
  expect(await verifyTurnstile(managed, request(''), 'topic')).toBe(false);
  expect(
    await verifyTurnstile(managed, request('x'.repeat(2049)), 'topic'),
  ).toBe(false);
  for (const fetcher of [
    vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')),
    vi.fn<typeof fetch>().mockResolvedValue(new Response('bad json')),
    vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 500 })),
  ])
    expect(
      await verifyTurnstile(managed, request('token'), 'topic', fetcher),
    ).toBe(false);
  expect(
    await verifyTurnstile(
      { ...managed, TURNSTILE_MODE: 'disabled' },
      request('token'),
      'topic',
    ),
  ).toBe(false);
});
it('enforces atomic persistent quotas under concurrent attempts and resets expired windows', async () => {
  const attempts = await Promise.allSettled(
    Array.from({ length: 15 }, () => consumeLimit(env.DB, 'parallel', 3)),
  );
  expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
  expect(
    (await env.DB.prepare('SELECT count AS n FROM write_limits WHERE key=?')
      .bind('parallel')
      .first<{ n: number }>())!.n,
  ).toBe(3);
  await env.DB.prepare('UPDATE write_limits SET expires_at=0').run();
  await expect(consumeLimit(env.DB, 'parallel', 3)).resolves.toBeUndefined();
});
it('separates topic/reply quotas, shares user quota across IPs and returns Retry-After', async () => {
  const member = await registerVerified(
    env,
    `${crypto.randomUUID()}@example.com`,
    '192.0.2.99',
  );
  const session = await (
    await import('../src/auth/server')
  ).getSession(
    env,
    new Request('http://localhost', { headers: { Cookie: member.cookie } }),
  );
  const limited = { ...env, TOPIC_RATE_LIMIT: '2', REPLY_RATE_LIMIT: '2' };
  await postingLimit(limited, 'reply', session!.user.id, '192.0.2.1');
  await postingLimit(limited, 'reply', session!.user.id, '192.0.2.2');
  await expect(
    postingLimit(limited, 'reply', session!.user.id, '192.0.2.3'),
  ).rejects.toThrow();
  for (let i = 0; i < 3; i++) {
    const token = await testProof(
      env,
      'http://localhost/api/v1/topics',
      'topic',
    );
    const result = await api.request(
      'http://localhost/api/v1/topics',
      {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
          'Content-Type': 'application/json',
          Cookie: member.cookie,
          'x-turnstile-token': token,
        },
        body: JSON.stringify({
          title: '限流测试主题',
          body: '测试正文',
          nodeId: 'dev',
          requestId: crypto.randomUUID(),
        }),
      },
      limited,
    );
    expect(result.status).toBe(i < 2 ? 201 : 429);
    if (i === 2)
      expect(Number(result.headers.get('Retry-After'))).toBeGreaterThan(0);
  }
});
it('cannot bypass the topic API with missing/failed/replayed proofs', async () => {
  const member = await registerVerified(
    env,
    `${crypto.randomUUID()}@example.com`,
    '192.0.2.98',
  );
  const token = await testProof(env, 'http://localhost/api/v1/topics', 'topic');
  const send = (proof: string) =>
    api.request(
      'http://localhost/api/v1/topics',
      {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
          'Content-Type': 'application/json',
          Cookie: member.cookie,
          'x-turnstile-token': proof,
        },
        body: JSON.stringify({
          title: '验证码测试主题',
          body: '正文',
          nodeId: 'dev',
          requestId: crypto.randomUUID(),
        }),
      },
      env,
    );
  expect((await send('')).status).toBe(403);
  expect((await send('forged')).status).toBe(403);
  expect((await send(token)).status).toBe(201);
  expect((await send(token)).status).toBe(403);
});
it('bootstraps the first admin atomically with audit and rejects subsequent bootstrap attempts', async () => {
  const own = await setupDatabase();
  try {
    const member = await registerVerified(own.env);
    const { getSession } = await import('../src/auth/server');
    const session = await getSession(
      own.env,
      new Request('http://localhost', { headers: { Cookie: member.cookie } }),
    );
    const insert = () =>
      own.env.DB.prepare(
        "INSERT INTO moderation_logs(id,actor_id,action,target_kind,target_id,reason,created_at) VALUES (?,?,'bootstrap','user',?,'Local operator bootstrap',?)",
      )
        .bind(
          crypto.randomUUID(),
          session!.user.id,
          session!.user.id,
          Date.now(),
        )
        .run();
    await own.env.DB.prepare(
      "CREATE TRIGGER bootstrap_audit_fault AFTER INSERT ON moderation_logs BEGIN SELECT RAISE(ABORT,'bootstrap-audit-failure'); END",
    ).run();
    await expect(insert()).rejects.toThrow('bootstrap-audit-failure');
    expect(
      (await own.env.DB.prepare(
        'SELECT role FROM account_access WHERE user_id=?',
      )
        .bind(session!.user.id)
        .first<{ role: string }>())!.role,
    ).toBe('member');
    await own.env.DB.prepare('DROP TRIGGER bootstrap_audit_fault').run();
    await insert();
    expect(
      (await own.env.DB.prepare(
        'SELECT role FROM account_access WHERE user_id=?',
      )
        .bind(session!.user.id)
        .first<{ role: string }>())!.role,
    ).toBe('admin');
    await expect(insert()).rejects.toThrow('BOOTSTRAP_NOT_ALLOWED');
  } finally {
    await own.mf.dispose();
  }
});
