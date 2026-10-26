import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { api } from '../src/lib/api';
import { moderation } from '../src/db/moderation';
import { getSession } from '../src/auth/server';
import {
  authRequest,
  registerVerified,
  setupDatabase,
  testProof,
  password,
  cookies,
} from './auth-helpers';
let fixture: Awaited<ReturnType<typeof setupDatabase>>, env: Env;
type TestUser = { id: string; email: string; cookie: string; ip: string };
const users: TestUser[] = [];
const reason = '测试审核原因';
async function req(
  path: string,
  method = 'GET',
  body?: unknown,
  who = users[0],
  headers = {},
) {
  const action =
    method === 'POST' && path === '/topics'
      ? 'topic'
      : method === 'POST' && /\/replies$/.test(path)
        ? 'reply'
        : method === 'POST' && path === '/reports'
          ? 'report'
          : null;
  const proof = action
    ? await testProof(env, `http://localhost/api/v1${path}`, action, who.ip)
    : '';
  return api.request(
    `http://localhost/api/v1${path}`,
    {
      method,
      headers: {
        Origin: 'http://localhost',
        'Content-Type': 'application/json',
        Cookie: who.cookie,
        'cf-connecting-ip': who.ip,
        'x-turnstile-token': proof,
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}
async function topic() {
  const r = await req(
    '/topics',
    'POST',
    {
      title: '管理测试主题',
      body: '安全内容',
      nodeId: 'dev',
      requestId: crypto.randomUUID(),
    },
    users[3],
  );
  expect(r.status).toBe(201);
  return ((await r.json()) as { data: { id: string } }).data.id;
}
async function logs() {
  return (await env.DB.prepare('SELECT * FROM moderation_logs').all()).results;
}
beforeAll(async () => {
  fixture = await setupDatabase();
  env = fixture.env;
  for (let i = 0; i < 5; i++) {
    const ip = `192.0.2.${20 + i}`;
    const member = await registerVerified(
      env,
      `${crypto.randomUUID()}@example.com`,
      ip,
    );
    const session = await getSession(
      env,
      new Request('http://localhost', { headers: { Cookie: member.cookie } }),
    );
    users.push({
      id: session!.user.id,
      email: member.email,
      cookie: member.cookie,
      ip,
    });
  }
});
beforeEach(async () => {
  for (const table of [
    'reports',
    'topic_votes',
    'bookmarks',
    'replies',
    'topics',
    'moderation_logs',
    'rate_limit',
    'write_limits',
    'local_challenges',
  ])
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  await env.DB.prepare(
    "UPDATE account_access SET role='admin',banned=0,revision=1 WHERE user_id=?",
  )
    .bind(users[0].id)
    .run();
  await env.DB.prepare(
    "UPDATE account_access SET role='member',banned=0,revision=1 WHERE user_id!=?",
  )
    .bind(users[0].id)
    .run();
  for (const index of [1, 2])
    await env.DB.prepare(
      "UPDATE account_access SET role='moderator' WHERE user_id=?",
    )
      .bind(users[index].id)
      .run();
  for (const member of users) {
    const login = await authRequest(
      env,
      '/sign-in/email',
      { email: member.email, password },
      '',
      member.ip,
    );
    expect(login.status).toBe(200);
    member.cookie = cookies(login);
  }
  await env.DB.prepare('UPDATE nodes SET hidden=0').run();
});
afterAll(async () => {
  await fixture.mf.dispose();
});
it('rejects members and guests at every admin read/write boundary', async () => {
  for (const section of [
    'users',
    'topics',
    'replies',
    'nodes',
    'reports',
    'logs',
  ]) {
    expect(
      (await req(`/admin/${section}`, 'GET', undefined, users[3])).status,
    ).toBe(403);
    expect(
      (
        await req(`/admin/${section}`, 'GET', undefined, {
          ...users[3],
          cookie: '',
        })
      ).status,
    ).toBe(401);
  }
  expect(
    (
      await req(
        `/admin/users/${users[4].id}/role`,
        'PATCH',
        { role: 'admin', revision: 1, reason },
        users[3],
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await req(
        `/admin/users/${users[4].id}/role`,
        'PATCH',
        { role: 'admin', revision: 1, reason },
        users[1],
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await authRequest(
        env,
        '/admin/set-role',
        { userId: users[3].id, role: 'admin' },
        users[0].cookie,
      )
    ).status,
  ).toBe(404);
});
it('grants roles only through admin operations and records exactly one audit', async () => {
  expect(
    (
      await req(`/admin/users/${users[3].id}/role`, 'PATCH', {
        role: 'moderator',
        revision: 1,
        reason,
      })
    ).status,
  ).toBe(200);
  expect((await req('/admin/users', 'GET', undefined, users[3])).status).toBe(
    200,
  );
  expect(await logs()).toHaveLength(1);
  expect((await logs())[0]).toMatchObject({
    actor_id: users[0].id,
    action: 'set-role',
    target_id: users[3].id,
    reason,
  });
  expect(
    (
      await req(`/admin/users/${users[3].id}/role`, 'PATCH', {
        role: 'admin',
        revision: 1,
        reason,
      })
    ).status,
  ).toBe(409);
  expect(await logs()).toHaveLength(1);
});
it('does not trust a stale staff role after demotion', async () => {
  const id = await topic();
  expect(
    (
      await req(`/admin/users/${users[1].id}/role`, 'PATCH', {
        role: 'member',
        revision: 1,
        reason,
      })
    ).status,
  ).toBe(200);
  expect((await req('/admin/topics', 'GET', undefined, users[1])).status).toBe(
    403,
  );
  expect(
    await moderation(env.DB).visibility(
      users[1].id,
      'topics',
      id,
      true,
      1,
      reason,
    ),
  ).toBe(false);
  expect(await logs()).toHaveLength(1);
});
it('blocks self changes, bans of higher/equal roles and last-admin loss', async () => {
  expect(
    (
      await req(`/admin/users/${users[0].id}/role`, 'PATCH', {
        role: 'member',
        revision: 1,
        reason,
      })
    ).status,
  ).toBe(409);
  for (const target of [users[0], users[1], users[2]])
    expect(
      (
        await req(
          `/admin/users/${target.id}/ban`,
          'PATCH',
          { banned: true, revision: 1, reason },
          users[1],
        )
      ).status,
    ).toBe(403);
  expect(
    (
      await req(`/admin/users/${users[0].id}/ban`, 'PATCH', {
        banned: true,
        revision: 1,
        reason,
      })
    ).status,
  ).toBe(403);
  await expect(
    env.DB.prepare("UPDATE account_access SET role='member' WHERE user_id=?")
      .bind(users[0].id)
      .run(),
  ).rejects.toThrow('LAST_ADMIN');
  expect(await logs()).toHaveLength(0);
});
it('keeps one administrator when concurrent administrators demote each other', async () => {
  await env.DB.prepare("UPDATE account_access SET role='admin' WHERE user_id=?")
    .bind(users[4].id)
    .run();
  const results = await Promise.all([
    req(
      `/admin/users/${users[4].id}/role`,
      'PATCH',
      { role: 'member', revision: 1, reason },
      users[0],
    ),
    req(
      `/admin/users/${users[0].id}/role`,
      'PATCH',
      { role: 'member', revision: 1, reason },
      users[4],
    ),
  ]);
  expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  expect(
    (await env.DB.prepare(
      "SELECT count(*) AS n FROM account_access WHERE role='admin' AND banned=0",
    ).first<{ n: number }>())!.n,
  ).toBe(1);
  expect(await logs()).toHaveLength(1);
});
it('bans members, revokes old sessions and blocks both native login and direct session insertion', async () => {
  const member = users[3],
    oldCookie = member.cookie;
  expect(
    (
      await req(
        `/admin/users/${member.id}/ban`,
        'PATCH',
        { banned: true, revision: 1, reason },
        users[1],
      )
    ).status,
  ).toBe(200);
  expect(
    await getSession(
      env,
      new Request('http://localhost', { headers: { Cookie: oldCookie } }),
    ),
  ).toBeNull();
  expect(
    await (
      await authRequest(env, '/get-session', undefined, oldCookie, member.ip)
    ).json(),
  ).toBeNull();
  expect(
    (
      await authRequest(
        env,
        '/sign-in/email',
        { email: member.email, password },
        '',
        member.ip,
      )
    ).status,
  ).toBe(403);
  await expect(
    env.DB.prepare(
      'INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?)',
    )
      .bind(
        crypto.randomUUID(),
        crypto.randomUUID(),
        member.id,
        Date.now() + 60000,
        Date.now(),
        Date.now(),
      )
      .run(),
  ).rejects.toThrow('ACCOUNT_BANNED');
  expect(
    (
      await req(
        `/admin/users/${member.id}/ban`,
        'PATCH',
        { banned: false, revision: 2, reason },
        users[1],
      )
    ).status,
  ).toBe(200);
  expect(
    await getSession(
      env,
      new Request('http://localhost', { headers: { Cookie: oldCookie } }),
    ),
  ).toBeNull();
  expect(
    (
      await authRequest(
        env,
        '/sign-in/email',
        { email: member.email, password },
        '',
        member.ip,
      )
    ).status,
  ).toBe(200);
});
it('checks bans again inside SQL for sessions that raced with a ban', async () => {
  const id = await topic();
  await req(
    `/admin/users/${users[3].id}/ban`,
    'PATCH',
    { banned: true, revision: 1, reason },
    users[1],
  );
  const { discussions } = await import('../src/db/discussions');
  expect(
    await discussions(env.DB).editTopic(id, `member-${users[3].id}`, {
      title: '不能更新标题',
      body: '不能写入',
      revision: 1,
    }),
  ).not.toBe('ok');
  const result = await discussions(env.DB).createReply(
    id,
    `member-${users[3].id}`,
    { body: '不能回复', requestId: crypto.randomUUID() },
  );
  expect(result.kind).toBe('not-found');
});
it('hides/restores content, preserves ownership and updates reply counters', async () => {
  const id = await topic();
  const created = await req(
    `/topics/${id}/replies`,
    'POST',
    { body: '待审核回复', requestId: crypto.randomUUID() },
    users[3],
  );
  const child = ((await created.json()) as { data: { id: string } }).data.id;
  expect(
    (
      await req(
        `/admin/replies/${child}/visibility`,
        'PATCH',
        { hidden: true, revision: 1, reason },
        users[1],
      )
    ).status,
  ).toBe(200);
  expect(
    (await env.DB.prepare('SELECT reply_count AS n FROM topics WHERE id=?')
      .bind(id)
      .first<{ n: number }>())!.n,
  ).toBe(0);
  expect(
    (
      await req(
        `/admin/replies/${child}/visibility`,
        'PATCH',
        { hidden: false, revision: 2, reason },
        users[1],
      )
    ).status,
  ).toBe(200);
  expect(
    (await env.DB.prepare('SELECT reply_count AS n FROM topics WHERE id=?')
      .bind(id)
      .first<{ n: number }>())!.n,
  ).toBe(1);
  expect(
    (
      await req(
        `/admin/topics/${id}/visibility`,
        'PATCH',
        { hidden: true, revision: 1, reason },
        users[1],
      )
    ).status,
  ).toBe(200);
  expect((await req(`/topics/${id}`, 'GET', undefined, users[3])).status).toBe(
    404,
  );
  expect(
    (
      await req(
        `/admin/topics/${id}/visibility`,
        'PATCH',
        { hidden: false, revision: 2, reason },
        users[1],
      )
    ).status,
  ).toBe(200);
  expect((await req(`/topics/${id}`, 'GET', undefined, users[3])).status).toBe(
    200,
  );
  expect(await logs()).toHaveLength(4);
});
it('keeps moderation and session revocation atomic with mandatory audit', async () => {
  const id = await topic();
  const member = users[3];
  await env.DB.prepare(
    "CREATE TRIGGER fail_audit BEFORE INSERT ON moderation_logs BEGIN SELECT RAISE(ABORT,'audit-failure'); END",
  ).run();
  try {
    expect(
      (
        await req(
          `/admin/topics/${id}/visibility`,
          'PATCH',
          { hidden: true, revision: 1, reason },
          users[1],
        )
      ).status,
    ).toBe(500);
    expect(
      (
        await req(
          `/admin/users/${member.id}/ban`,
          'PATCH',
          { banned: true, revision: 1, reason },
          users[1],
        )
      ).status,
    ).toBe(500);
  } finally {
    await env.DB.prepare('DROP TRIGGER fail_audit').run();
  }
  expect((await req(`/topics/${id}`)).status).toBe(200);
  expect(
    await getSession(
      env,
      new Request('http://localhost', { headers: { Cookie: member.cookie } }),
    ),
  ).not.toBeNull();
  expect(await logs()).toHaveLength(0);
});
it('accepts reports once, restricts report reads and resolves/dismisses with audit', async () => {
  const id = await topic();
  const body = { kind: 'topic', targetId: id, reason: '疑似违规内容' };
  expect((await req('/reports', 'POST', body, users[3])).status).toBe(201);
  expect((await req('/reports', 'POST', body, users[3])).status).toBe(409);
  const list = await req('/admin/reports', 'GET', undefined, users[1]);
  const report = ((await list.json()) as { data: { items: { id: string }[] } })
    .data.items[0];
  expect(
    (
      await req(
        `/admin/reports/${report.id}`,
        'PATCH',
        { status: 'resolved', revision: 1, reason },
        users[1],
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await req(
        `/admin/reports/${report.id}`,
        'PATCH',
        { status: 'dismissed', revision: 1, reason },
        users[1],
      )
    ).status,
  ).toBe(409);
  expect((await logs())[0]).toMatchObject({
    action: 'resolved',
    target_id: report.id,
  });
  await req(
    `/admin/topics/${id}/visibility`,
    'PATCH',
    { hidden: true, revision: 1, reason },
    users[1],
  );
  expect((await req('/reports', 'POST', body, users[3])).status).toBe(404);
});
it('limits node management to admins and records node mutations', async () => {
  const body = {
    slug: `test-${crypto.randomUUID().slice(0, 8)}`,
    name: '管理节点',
    description: '节点介绍',
    sortOrder: 8,
    hidden: false,
    reason,
  };
  expect((await req('/admin/nodes', 'POST', body, users[1])).status).toBe(403);
  expect((await req('/admin/nodes', 'POST', body)).status).toBe(200);
  const node = await env.DB.prepare('SELECT id FROM nodes WHERE slug=?')
    .bind(body.slug)
    .first<{ id: string }>();
  expect(
    (await req(`/admin/nodes/${node!.id}`, 'PATCH', { ...body, hidden: true }))
      .status,
  ).toBe(200);
  expect(await logs()).toHaveLength(2);
});
it('retains origin, environment and validation restrictions for privileged writes', async () => {
  const path = `/admin/users/${users[3].id}/role`,
    body = { role: 'admin', revision: 1, reason };
  expect(
    (
      await req(path, 'PATCH', body, users[0], {
        Origin: 'https://evil.example',
      })
    ).status,
  ).toBe(403);
  expect((await req(path, 'PATCH', { ...body, reason: 'x' })).status).toBe(400);
  expect(
    (
      await api.request(
        `http://localhost/api/v1${path}`,
        {
          method: 'PATCH',
          headers: {
            Origin: 'http://localhost',
            'Content-Type': 'application/json',
            Cookie: users[0].cookie,
          },
          body: JSON.stringify(body),
        },
        { ...env, APP_ENV: 'production' },
      )
    ).status,
  ).toBe(403);
});
