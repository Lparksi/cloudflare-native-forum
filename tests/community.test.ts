import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import {
  setupDatabase,
  registerVerified,
  testProof,
  authRequest,
} from './auth-helpers';
import { api } from '../src/lib/api';
import { repository } from '../src/db/repository';
import { discussions } from '../src/db/discussions';
import { mentionNames } from '../src/lib/mentions';
import { renderMarkdown } from '../src/lib/markdown';
import { parseFeed } from '../src/lib/contracts';
let fixture: Awaited<ReturnType<typeof setupDatabase>>, env: Env;
type Profile = Awaited<
  ReturnType<ReturnType<typeof repository>['profileForUser']>
>;
let alice: { cookie: string; p: Profile },
  bob: typeof alice,
  carol: typeof alice,
  dave: typeof alice;
async function json<T>(response: Response) {
  return (await response.json()) as { data: T };
}
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  cookie = alice.cookie,
  overrides: Partial<Env> = {},
) {
  const action =
    method === 'POST' && path === '/topics'
      ? 'topic'
      : method === 'POST' && path.endsWith('/replies')
        ? 'reply'
        : null;
  return api.request(
    `http://localhost/api/v1${path}`,
    {
      method,
      headers: {
        Origin: 'http://localhost',
        'Content-Type': 'application/json',
        Cookie: cookie,
        ...(action
          ? {
              'x-turnstile-token': await testProof(
                env,
                `http://localhost/api/v1${path}`,
                action,
              ),
            }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    { ...env, ...overrides },
  );
}
async function inbox(cookie = bob.cookie) {
  return (
    await json<{
      items: {
        id: string;
        kind: string;
        title: string;
        readAt: number | null;
        replyId: string | null;
      }[];
      unread: number;
      nextCursor: string | null;
    }>(await request('/notifications', 'GET', undefined, cookie))
  ).data;
}
async function create(
  body = '正文',
  cookie = alice.cookie,
  requestId = crypto.randomUUID(),
) {
  const response = await request(
    '/topics',
    'POST',
    { title: '通知测试主题', body, nodeId: 'dev', requestId },
    cookie,
  );
  expect(response.status).toBe(201);
  return (await json<{ id: string }>(response)).data.id;
}
beforeAll(async () => {
  fixture = await setupDatabase();
  env = fixture.env;
  const member = async (ip: string) => {
    const { cookie } = await registerVerified(
      env,
      `${crypto.randomUUID()}@example.com`,
      ip,
    );
    const p = (
      await json<Profile>(
        await api.request(
          'http://localhost/api/v1/me/profile',
          { headers: { Cookie: cookie } },
          env,
        ),
      )
    ).data;
    return { cookie, p };
  };
  alice = await member('192.0.2.151');
  bob = await member('192.0.2.152');
  carol = await member('192.0.2.153');
  dave = await member('192.0.2.155');
});
beforeEach(async () => {
  await env.DB.prepare('DELETE FROM replies').run();
  await env.DB.prepare('DELETE FROM topic_votes').run();
  await env.DB.prepare('DELETE FROM topics').run();
  await env.DB.prepare('DELETE FROM write_limits').run();
  await env.DB.prepare('UPDATE nodes SET hidden=0').run();
});
afterAll(async () => {
  await fixture.mf.dispose();
});
it('parses only ordinary Markdown text, caps unique targets and uses the shared safe renderer', async () => {
  const body =
    '你好@alice @alice @Bob_Name\n\n`@inline`\n\n```js\n@code\n```\n\n> @quoted\n\n[@linked](https://example.com) ![@image](x)\n\nfoo@domain.com /@path @safe-name';
  expect(mentionNames(body)).toEqual(['alice', 'Bob_Name', 'safe-name']);
  const html = await renderMarkdown(body);
  expect(html).toContain('href="/member/alice"');
  expect(html).toContain('href="/member/Bob_Name"');
  expect(html).not.toMatch(
    /href="\/member\/(inline|code|quoted|linked|image|path)/,
  );
  expect(
    mentionNames(Array.from({ length: 25 }, (_, i) => `@user_${i}`).join(' ')),
  ).toHaveLength(20);
  expect(await renderMarkdown('@alice<script>alert(1)</script>')).not.toContain(
    '<script>',
  );
});
it('atomically creates mentions for verified active users, excludes self/unknown and deduplicates retries', async () => {
  const key = crypto.randomUUID(),
    body = `@${bob.p.username} @${bob.p.username} @${alice.p.username} @unknown`;
  const id = await create(body, alice.cookie, key);
  expect((await inbox()).items).toHaveLength(1);
  expect((await inbox()).unread).toBe(1);
  expect((await inbox(alice.cookie)).items).toHaveLength(0);
  const replay = await request('/topics', 'POST', {
    title: '通知测试主题',
    body,
    nodeId: 'dev',
    requestId: key,
  });
  expect(replay.status).toBe(200);
  const conflict = await request('/topics', 'POST', {
    title: '通知测试主题',
    body: `@${carol.p.username}`,
    nodeId: 'dev',
    requestId: key,
  });
  expect(conflict.status).toBe(409);
  expect((await inbox(carol.cookie)).items).toHaveLength(0);
  const edit = await request(`/topics/${id}`, 'PATCH', {
    title: '编辑标题',
    body: `${body} @${carol.p.username}`,
    revision: 1,
  });
  expect(edit.status).toBe(200);
  expect((await inbox()).items).toHaveLength(1);
  expect((await inbox(carol.cookie)).items).toHaveLength(1);
  expect(
    (
      await request(`/topics/${id}`, 'PATCH', {
        title: '过期编辑',
        body: `@${dave.p.username}`,
        revision: 1,
      })
    ).status,
  ).toBe(409);
  expect((await inbox(carol.cookie)).items).toHaveLength(1);
  expect((await inbox(dave.cookie)).items).toHaveLength(0);
  expect(
    (
      await request(
        `/topics/${id}`,
        'PATCH',
        { title: '越权编辑', body: `@${dave.p.username}`, revision: 2 },
        bob.cookie,
      )
    ).status,
  ).toBe(403);
  expect((await inbox(dave.cookie)).items).toHaveLength(0);
});
it('notifies topic author on a reply once, prefers mention, and never notifies a quoted mention', async () => {
  const id = await create();
  const key = crypto.randomUUID();
  const body =
    '@' +
    alice.p.username +
    '\n\n> @' +
    carol.p.username +
    '\n\n`@' +
    carol.p.username +
    '`';
  const calls = await Promise.all(
    Array.from({ length: 5 }, () =>
      request(
        `/topics/${id}/replies`,
        'POST',
        { body, requestId: key },
        bob.cookie,
      ),
    ),
  );
  expect(calls.filter((r) => r.status === 201)).toHaveLength(1);
  expect((await inbox(alice.cookie)).items).toHaveLength(1);
  expect((await inbox(alice.cookie)).items[0]!.kind).toBe('mention');
  expect((await inbox(carol.cookie)).items).toHaveLength(0);
  const own = await request(`/topics/${id}/replies`, 'POST', {
    body: '自己回复',
    requestId: crypto.randomUUID(),
  });
  expect(own.status).toBe(201);
  expect((await inbox(alice.cookie)).items).toHaveLength(1);
  const reply = (
    await json<{ id: string }>(calls.find((r) => r.status === 201)!)
  ).data.id;
  expect(
    (
      await request(
        `/replies/${reply}`,
        'PATCH',
        { body: `添加 @${carol.p.username}`, revision: 1 },
        bob.cookie,
      )
    ).status,
  ).toBe(200);
  expect((await inbox(carol.cookie)).items).toHaveLength(1);
});
it('keeps notification reads private, idempotent and protected by environment/session/origin', async () => {
  await create(`@${bob.p.username}`);
  const row = (await inbox()).items[0]!;
  expect((await request('/notifications', 'GET', undefined, '')).status).toBe(
    401,
  );
  expect(
    (await request(`/notifications/${row.id}/read`, 'PATCH', {})).status,
  ).toBe(404);
  expect(
    (
      await request(`/notifications/${row.id}/read`, 'PATCH', {}, bob.cookie, {
        APP_ENV: 'production',
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(
        `/notifications/${row.id}/read`,
        'PATCH',
        { recipientId: alice.p.userId },
        bob.cookie,
      )
    ).status,
  ).toBe(400);
  const cross = await api.request(
    `http://localhost/api/v1/notifications/${row.id}/read`,
    {
      method: 'PATCH',
      headers: {
        Cookie: bob.cookie,
        Origin: 'https://evil.example',
        'Content-Type': 'application/json',
      },
      body: '{}',
    },
    env,
  );
  expect(cross.status).toBe(403);
  expect(
    (await request(`/notifications/${row.id}/read`, 'PATCH', {}, bob.cookie))
      .status,
  ).toBe(200);
  const readAt = (await inbox()).items[0]!.readAt;
  expect(
    (await request(`/notifications/${row.id}/read`, 'PATCH', {}, bob.cookie))
      .status,
  ).toBe(200);
  expect((await inbox()).items[0]!.readAt).toBe(readAt);
  expect((await inbox()).unread).toBe(0);
});
it('filters hidden/deleted topics, replies and nodes from inbox, count and mark-read', async () => {
  const id = await create(`@${bob.p.username}`);
  const notice = (await inbox()).items[0]!;
  await env.DB.prepare("UPDATE topics SET status='hidden' WHERE id=?")
    .bind(id)
    .run();
  expect((await inbox()).items).toHaveLength(0);
  expect(await discussions(env.DB).unread(bob.p.userId!)).toBe(0);
  expect(
    (await request(`/notifications/${notice.id}/read`, 'PATCH', {}, bob.cookie))
      .status,
  ).toBe(404);
  await env.DB.prepare("UPDATE topics SET status='published' WHERE id=?")
    .bind(id)
    .run();
  expect((await inbox()).unread).toBe(1);
  const response = await request(
    `/topics/${id}/replies`,
    'POST',
    { body: `@${bob.p.username}`, requestId: crypto.randomUUID() },
    carol.cookie,
  );
  const reply = (await json<{ id: string }>(response)).data;
  await env.DB.prepare("UPDATE replies SET status='deleted' WHERE id=?")
    .bind(reply.id)
    .run();
  expect((await inbox()).items).toHaveLength(1);
  await env.DB.prepare("UPDATE nodes SET hidden=1 WHERE id='dev'").run();
  expect((await inbox()).items).toHaveLength(0);
  expect((await inbox()).unread).toBe(0);
});
it('rolls back content, revision and reply counters when notification delivery fails', async () => {
  await env.DB.prepare(
    "CREATE TRIGGER notification_fault BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT,'notification-fault'); END",
  ).run();
  try {
    const fail = await request('/topics', 'POST', {
      title: '失败主题',
      body: `@${bob.p.username}`,
      nodeId: 'dev',
      requestId: crypto.randomUUID(),
    });
    expect(fail.status).toBe(500);
    expect((await repository(env.DB).list()).items).toHaveLength(0);
  } finally {
    await env.DB.prepare('DROP TRIGGER notification_fault').run();
  }
  const id = await create();
  await env.DB.prepare(
    "CREATE TRIGGER notification_fault BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT,'notification-fault'); END",
  ).run();
  try {
    expect(
      (
        await request(
          `/topics/${id}/replies`,
          'POST',
          { body: `@${bob.p.username}`, requestId: crypto.randomUUID() },
          carol.cookie,
        )
      ).status,
    ).toBe(500);
    expect((await repository(env.DB).topic(id))!.replyCount).toBe(0);
    expect(
      (
        await request(`/topics/${id}`, 'PATCH', {
          title: '失败编辑',
          body: `@${bob.p.username}`,
          revision: 1,
        })
      ).status,
    ).toBe(500);
    expect((await repository(env.DB).topic(id))!.revision).toBe(1);
  } finally {
    await env.DB.prepare('DROP TRIGGER notification_fault').run();
  }
});
it('provides stable same-timestamp inbox cursors and never creates notifications for unverified/banned targets', async () => {
  const id = await create(`@${bob.p.username}`);
  const row = await env.DB.prepare(
    'SELECT * FROM notifications WHERE topic_id=?',
  )
    .bind(id)
    .first<{ recipient_id: string; actor_id: string }>();
  for (let i = 0; i < 22; i++) {
    const topic = await create();
    await env.DB.prepare(
      "INSERT INTO notifications(id,recipient_id,actor_id,topic_id,source_key,kind,created_at) VALUES (?,?,?, ?,?,'mention',100)",
    )
      .bind(
        i.toString(16).padStart(32, '0'),
        row!.recipient_id,
        row!.actor_id,
        topic,
        `topic:${topic}`,
      )
      .run();
  }
  const first = await inbox();
  expect(first.items).toHaveLength(20);
  const next = (
    await json<Awaited<ReturnType<typeof inbox>>>(
      await request(
        `/notifications?cursor=${encodeURIComponent(first.nextCursor!)}`,
        'GET',
        undefined,
        bob.cookie,
      ),
    )
  ).data;
  expect(next.items).toHaveLength(3);
  expect(new Set([...first.items, ...next.items].map((n) => n.id)).size).toBe(
    23,
  );
  await authRequest(
    env,
    '/sign-up/email',
    {
      name: '尚未验证',
      email: `${crypto.randomUUID()}@example.com`,
      password: 'Strong password 12345!',
    },
    '',
    '192.0.2.154',
  );
  const unverified = await env.DB.prepare(
    'SELECT id,username FROM profiles WHERE user_id IN(SELECT id FROM user WHERE email_verified=0)',
  ).first<{ id: string; username: string }>();
  expect(unverified).not.toBeNull();
  expect(
    await repository(env.DB).publicProfile('no-such-user'),
  ).toBeUndefined();
  expect(
    await repository(env.DB).publicProfile(unverified!.username),
  ).toBeUndefined();
  await env.DB.prepare('UPDATE account_access SET banned=1 WHERE user_id=?')
    .bind(carol.p.userId)
    .run();
  await create(`@${unverified!.username} @${carol.p.username}`);
  expect(
    (
      await env.DB.prepare('SELECT id FROM notifications WHERE recipient_id=?')
        .bind(carol.p.userId)
        .all()
    ).results,
  ).toHaveLength(0);
  await env.DB.prepare('UPDATE account_access SET banned=0 WHERE user_id=?')
    .bind(carol.p.userId)
    .run();
});
it('checks banned recipients again in notification SQL even when an old actor ID is supplied', async () => {
  await create(`@${dave.p.username}`);
  const item = (await inbox(dave.cookie)).items[0]!;
  await env.DB.prepare('UPDATE account_access SET banned=1 WHERE user_id=?')
    .bind(dave.p.userId)
    .run();
  const repo = discussions(env.DB);
  expect((await repo.notifications(dave.p.userId!)).items).toHaveLength(0);
  expect(await repo.unread(dave.p.userId!)).toBe(0);
  expect(await repo.readNotification(dave.p.userId!, item.id)).toBe(false);
  expect(
    (await request('/notifications', 'GET', undefined, dave.cookie)).status,
  ).toBe(401);
});
it('searches Chinese/title/body with literal LIKE wildcards and filters hidden content and author scope', async () => {
  const repo = repository(env.DB),
    percent = await create('中文关键词 100% 精确'),
    other = await create('中文关键词 1000 对照', bob.cookie);
  let result = await json<{ items: { id: string }[] }>(
    await request('/topics?q=' + encodeURIComponent('100%')),
  );
  expect(result.data.items.map((x) => x.id)).toEqual([percent]);
  result = await json(
    await request('/topics?q=' + encodeURIComponent("%' OR 1=1 --")),
  );
  expect(result.data.items).toHaveLength(0);
  result = await json(await request('/topics?q=' + encodeURIComponent('中文')));
  expect(result.data.items).toHaveLength(2);
  expect(
    (
      await repo.list(undefined, undefined, alice.p.id, {
        sort: 'hot',
        q: '中文',
      })
    ).items.map((x) => x.id),
  ).toEqual([percent]);
  await env.DB.prepare("UPDATE topics SET status='hidden' WHERE id=?")
    .bind(percent)
    .run();
  result = await json(await request('/topics?q=' + encodeURIComponent('中文')));
  expect(result.data.items.map((x) => x.id)).toEqual([other]);
  await env.DB.prepare("UPDATE nodes SET hidden=1 WHERE id='dev'").run();
  result = await json(await request('/topics?q=' + encodeURIComponent('中文')));
  expect(result.data.items).toHaveLength(0);
});
it('orders latest/hot/active using database counters and drops activity when a reply is deleted', async () => {
  const repo = repository(env.DB),
    old = await create(),
    middle = await create(),
    latest = await create();
  for (const [id, time] of [
    [old, 100],
    [middle, 200],
    [latest, 300],
  ] as const)
    await env.DB.prepare('UPDATE topics SET created_at=? WHERE id=?')
      .bind(time, id)
      .run();
  for (const p of [alice.p, bob.p])
    await env.DB.prepare(
      'INSERT INTO topic_votes(topic_id,profile_id,created_at) VALUES (?,?,1)',
    )
      .bind(old, p.id)
      .run();
  const reply = await discussions(env.DB).createReply(middle, bob.p.id, {
    body: '推动活跃',
    requestId: crypto.randomUUID(),
  });
  expect(reply.kind).toBe('ok');
  const ids = async (sort: 'latest' | 'hot' | 'active') =>
    (
      await repo.list(undefined, undefined, undefined, { sort, q: '' })
    ).items.map((x) => x.id);
  expect(await ids('latest')).toEqual([latest, middle, old]);
  expect(await ids('hot')).toEqual([old, middle, latest]);
  expect(await ids('active')).toEqual([middle, latest, old]);
  if (reply.kind === 'ok')
    await discussions(env.DB).deleteReply(reply.id, bob.p.id, 1);
  expect(await ids('active')).toEqual([latest, middle, old]);
});
it('paginates tied hot/active ranks without duplicates and binds cursors to search and sort', async () => {
  const repo = repository(env.DB);
  for (let i = 0; i < 26; i++) {
    const id = await create('分页关键词');
    await env.DB.prepare('UPDATE topics SET created_at=100 WHERE id=?')
      .bind(id)
      .run();
  }
  for (const sort of ['latest', 'hot', 'active'] as const) {
    const options = { sort, q: '分页' },
      first = await repo.list(undefined, undefined, undefined, options);
    expect(first.items).toHaveLength(20);
    const parsed = parseFeed(
      new URLSearchParams({ sort, q: '分页', cursor: first.nextCursor! }),
    );
    const second = await repo.list(
      parsed.cursor,
      undefined,
      undefined,
      parsed.options,
    );
    expect(second.items).toHaveLength(6);
    expect(
      new Set([...first.items, ...second.items].map((x) => x.id)).size,
    ).toBe(26);
    expect(
      (
        await request(
          '/topics?' +
            new URLSearchParams({ sort, q: '其他', cursor: first.nextCursor! }),
        )
      ).status,
    ).toBe(400);
    if (sort !== 'latest')
      expect(
        (
          await request(
            '/topics?' +
              new URLSearchParams({
                sort: 'latest',
                q: '分页',
                cursor: first.nextCursor!,
              }),
          )
        ).status,
      ).toBe(400);
  }
  for (const query of [
    'sort=bogus',
    'q=a',
    'q=' + encodeURIComponent('x'.repeat(81)),
    'q=%00',
    'cursor=%7Bbad',
  ])
    expect((await request(`/topics?${query}`)).status).toBe(400);
  expect(
    (
      await request(
        '/notifications?cursor=' +
          encodeURIComponent('{"createdAt":1,"id":"wrong"}'),
      )
    ).status,
  ).toBe(400);
});
