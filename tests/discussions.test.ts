import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { api } from '../src/lib/api';
import { setupDatabase, registerVerified, testProof } from './auth-helpers';
let fixture: Awaited<ReturnType<typeof setupDatabase>>;
let env: Env;
let alice: string;
let bob: string;
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  cookie = alice,
  overrides = {},
) {
  const action =
    method === 'POST' && path === '/topics'
      ? 'topic'
      : method === 'POST' && /\/replies$/.test(path)
        ? 'reply'
        : null;
  const proof = action
    ? await testProof(env, `http://localhost/api/v1${path}`, action)
    : '';
  return api.request(
    `http://localhost/api/v1${path}`,
    {
      method,
      headers: {
        Origin: 'http://localhost',
        'Content-Type': 'application/json',
        Cookie: cookie,
        'x-turnstile-token': proof,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    { ...env, ...overrides },
  );
}
async function topic() {
  const response = await request('/topics', 'POST', {
    title: '阶段三测试主题',
    body: '**原始正文**',
    nodeId: 'dev',
    requestId: crypto.randomUUID(),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { data: { id: string } }).data.id;
}
async function reply(
  id: string,
  body = '回复正文',
  requestId = crypto.randomUUID(),
  cookie = alice,
) {
  return request(`/topics/${id}/replies`, 'POST', { body, requestId }, cookie);
}
beforeAll(async () => {
  fixture = await setupDatabase();
  env = fixture.env;
  alice = (await registerVerified(env)).cookie;
  bob = (
    await registerVerified(
      env,
      `${crypto.randomUUID()}@example.com`,
      '192.0.2.2',
    )
  ).cookie;
});
beforeEach(async () => {
  for (const table of [
    'reports',
    'topic_votes',
    'bookmarks',
    'replies',
    'topics',
    'write_limits',
    'local_challenges',
  ])
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  await env.DB.prepare('UPDATE nodes SET hidden = 0').run();
});
afterAll(async () => {
  await fixture.mf.dispose();
});
describe('Phase 3 D1 discussion permissions and consistency', () => {
  it('previews through the exact server renderer and requires a verified session', async () => {
    expect(
      (await request('/markdown/preview', 'POST', { body: '**安全**' }, ''))
        .status,
    ).toBe(401);
    const preview = await request('/markdown/preview', 'POST', {
      body: '**安全**\n\n<script>alert(1)</script>',
    });
    expect(await preview.json()).toMatchObject({
      data: { html: '<p><strong>安全</strong></p>' },
    });
  });
  it('only lets an author edit/delete their topic and rejects stale revisions', async () => {
    const id = await topic();
    const patch = { title: '修改后的主题', body: '修改后的正文', revision: 1 };
    expect((await request(`/topics/${id}`, 'PATCH', patch, bob)).status).toBe(
      403,
    );
    expect(
      (await request(`/topics/${id}`, 'DELETE', { revision: 1 }, bob)).status,
    ).toBe(403);
    expect((await request(`/topics/${id}`, 'PATCH', patch)).status).toBe(200);
    expect((await request(`/topics/${id}`, 'PATCH', patch)).status).toBe(409);
    expect(
      (await request(`/topics/${id}`, 'DELETE', { revision: 1 })).status,
    ).toBe(409);
    expect(
      (await request(`/topics/${id}`, 'DELETE', { revision: 2 })).status,
    ).toBe(200);
    expect((await request(`/topics/${id}`)).status).toBe(404);
    const stored = await env.DB.prepare(
      'SELECT status, body FROM topics WHERE id = ?',
    )
      .bind(id)
      .first();
    expect(stored).toMatchObject({ status: 'deleted', body: '修改后的正文' });
  });
  it('allows only one winner when two edits use the same revision', async () => {
    const id = await topic();
    const results = await Promise.all(
      ['first', 'second'].map((body) =>
        request(`/topics/${id}`, 'PATCH', {
          title: '并发编辑主题',
          body,
          revision: 1,
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  it('allocates unique stable floors, counters and last reply time under concurrent writes', async () => {
    const id = await topic();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => reply(id, `并发回复 ${i}`)),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const rows = await env.DB.prepare(
      'SELECT floor FROM replies WHERE topic_id = ? ORDER BY floor',
    )
      .bind(id)
      .all<{ floor: number }>();
    expect(rows.results.map((r) => r.floor)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    const count = await env.DB.prepare(
      'SELECT reply_count, next_reply_floor, last_replied_at FROM topics WHERE id = ?',
    )
      .bind(id)
      .first<{
        reply_count: number;
        next_reply_floor: number;
        last_replied_at: number;
      }>();
    expect(count).toMatchObject({ reply_count: 12, next_reply_floor: 12 });
    expect(count!.last_replied_at).toBe(
      (await env.DB.prepare(
        'SELECT MAX(created_at) AS n FROM replies WHERE topic_id = ?',
      )
        .bind(id)
        .first<{ n: number }>())!.n,
    );
  });
  it('deduplicates replies without incrementing floors or counters', async () => {
    const id = await topic();
    const key = crypto.randomUUID();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => reply(id, '重复回复', key)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([
      200, 200, 200, 200, 200, 201,
    ]);
    expect((await reply(id, '不同内容', key)).status).toBe(409);
    expect(
      await env.DB.prepare(
        'SELECT reply_count, next_reply_floor FROM topics WHERE id = ?',
      )
        .bind(id)
        .first(),
    ).toEqual({ reply_count: 1, next_reply_floor: 1 });
  });
  it('enforces reply ownership and versions; deleted content becomes a body-free tombstone', async () => {
    const id = await topic();
    const created = (await (await reply(id)).json()) as {
      data: { id: string };
    };
    const replyId = created.data.id;
    expect(
      (
        await request(
          `/replies/${replyId}`,
          'PATCH',
          { body: '越权', revision: 1 },
          bob,
        )
      ).status,
    ).toBe(403);
    expect(
      (await request(`/replies/${replyId}`, 'DELETE', { revision: 1 }, bob))
        .status,
    ).toBe(403);
    expect(
      (
        await request(`/replies/${replyId}`, 'PATCH', {
          body: '回复编辑后',
          revision: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(`/replies/${replyId}`, 'PATCH', {
          body: '过期内容',
          revision: 1,
        })
      ).status,
    ).toBe(409);
    expect(
      (await request(`/replies/${replyId}`, 'DELETE', { revision: 2 })).status,
    ).toBe(200);
    expect(await (await request(`/topics/${id}/replies`)).json()).toMatchObject(
      { data: { items: [{ floor: 1, status: 'deleted', body: null }] } },
    );
    expect(
      await env.DB.prepare(
        'SELECT reply_count, next_reply_floor, last_replied_at FROM topics WHERE id = ?',
      )
        .bind(id)
        .first(),
    ).toEqual({ reply_count: 0, next_reply_floor: 1, last_replied_at: null });
    const next = (await (await reply(id)).json()) as {
      data: { floor: number };
    };
    expect(next.data.floor).toBe(2);
  });
  it('rolls back a reply and floor allocation if its counter update fails', async () => {
    const id = await topic();
    await env.DB.prepare(
      "CREATE TRIGGER fail_reply_count BEFORE UPDATE OF reply_count ON topics BEGIN SELECT RAISE(ABORT, 'simulated-counter-failure'); END",
    ).run();
    try {
      expect((await reply(id)).status).toBe(500);
    } finally {
      await env.DB.prepare('DROP TRIGGER fail_reply_count').run();
    }
    expect(
      (await env.DB.prepare('SELECT count(*) AS n FROM replies').first<{
        n: number;
      }>())!.n,
    ).toBe(0);
    expect(
      await env.DB.prepare(
        'SELECT reply_count, next_reply_floor FROM topics WHERE id = ?',
      )
        .bind(id)
        .first(),
    ).toEqual({ reply_count: 0, next_reply_floor: 0 });
  });
  it('paginates replies by floor and preserves tombstones without duplicates', async () => {
    const id = await topic();
    await Promise.all(Array.from({ length: 35 }, () => reply(id)));
    type Page = {
      data: {
        items: { id: string; floor: number; body: string | null }[];
        nextCursor: number | null;
      };
    };
    const first = (await (
      await request(`/topics/${id}/replies`)
    ).json()) as Page;
    expect(first.data.items).toHaveLength(30);
    expect(first.data.nextCursor).toBe(30);
    const second = (await (
      await request(`/topics/${id}/replies?after=30`)
    ).json()) as Page;
    expect(second.data.items.map((r) => r.floor)).toEqual([31, 32, 33, 34, 35]);
    expect(second.data.nextCursor).toBeNull();
    expect((await request(`/topics/${id}/replies?after=-1`)).status).toBe(400);
  });
  it('keeps votes and private bookmarks idempotent and isolated between users', async () => {
    const id = await topic();
    await Promise.all(
      Array.from({ length: 8 }, () => request(`/topics/${id}/vote`, 'PUT')),
    );
    expect(
      await (await request(`/topics/${id}/interactions`)).json(),
    ).toMatchObject({ data: { voteCount: 1, voted: true, bookmarked: false } });
    await request(`/topics/${id}/vote`, 'PUT', undefined, bob);
    await Promise.all(
      Array.from({ length: 5 }, () => request(`/topics/${id}/bookmark`, 'PUT')),
    );
    expect(await (await request('/bookmarks')).json()).toMatchObject({
      data: { items: [{ id }] },
    });
    expect(
      await (await request('/bookmarks', 'GET', undefined, bob)).json(),
    ).toMatchObject({ data: { items: [] } });
    expect(
      await (
        await request(`/topics/${id}/interactions`, 'GET', undefined, bob)
      ).json(),
    ).toMatchObject({ data: { voteCount: 2, voted: true, bookmarked: false } });
    await Promise.all(
      Array.from({ length: 8 }, () => request(`/topics/${id}/vote`, 'DELETE')),
    );
    await Promise.all(
      Array.from({ length: 5 }, () =>
        request(`/topics/${id}/bookmark`, 'DELETE'),
      ),
    );
    expect(
      await (await request(`/topics/${id}/interactions`)).json(),
    ).toMatchObject({
      data: { voteCount: 1, voted: false, bookmarked: false },
    });
    expect((await request('/bookmarks', 'GET', undefined, '')).status).toBe(
      401,
    );
  });
  it('hides child replies and bookmarks and rejects all mutations for removed parents or hidden nodes', async () => {
    const id = await topic();
    const child = (await (await reply(id)).json()) as { data: { id: string } };
    await request(`/topics/${id}/bookmark`, 'PUT');
    for (const hiddenBy of ['node', 'topic']) {
      if (hiddenBy === 'node')
        await env.DB.prepare('UPDATE nodes SET hidden = 1').run();
      else {
        await env.DB.prepare('UPDATE nodes SET hidden = 0').run();
        await env.DB.prepare("UPDATE topics SET status = 'deleted'").run();
      }
      expect((await request(`/topics/${id}/replies`)).status).toBe(404);
      expect((await reply(id)).status).toBe(404);
      expect(
        (
          await request(`/topics/${id}`, 'PATCH', {
            title: '隐藏内容不能修改',
            body: '内容',
            revision: 1,
          })
        ).status,
      ).toBe(404);
      expect(
        (await request(`/topics/${id}`, 'DELETE', { revision: 1 })).status,
      ).toBe(404);
      expect((await request(`/topics/${id}/vote`, 'DELETE')).status).toBe(404);
      expect((await request(`/topics/${id}/bookmark`, 'DELETE')).status).toBe(
        404,
      );
      expect(
        (
          await request(`/replies/${child.data.id}`, 'PATCH', {
            body: '隐藏后编辑',
            revision: 1,
          })
        ).status,
      ).toBe(404);
      expect(
        (await request(`/replies/${child.data.id}`, 'DELETE', { revision: 1 }))
          .status,
      ).toBe(404);
      expect((await request(`/topics/${id}/vote`, 'PUT')).status).toBe(404);
      expect((await request(`/topics/${id}/bookmark`, 'PUT')).status).toBe(404);
      expect(await (await request('/bookmarks')).json()).toMatchObject({
        data: { items: [] },
      });
    }
  });
  it('applies authentication, origin and environment gates to every write family', async () => {
    const id = await topic();
    const child = (await (await reply(id)).json()) as { data: { id: string } };
    const actions: [string, string, unknown][] = [
      [
        `/topics/${id}`,
        'PATCH',
        { title: '测试修改标题', body: '正文', revision: 1 },
      ],
      [`/topics/${id}`, 'DELETE', { revision: 1 }],
      [
        `/topics/${id}/replies`,
        'POST',
        { body: '回复', requestId: crypto.randomUUID() },
      ],
      [`/replies/${child.data.id}`, 'PATCH', { body: '正文', revision: 1 }],
      [`/replies/${child.data.id}`, 'DELETE', { revision: 1 }],
      [`/topics/${id}/vote`, 'PUT', undefined],
      [`/topics/${id}/bookmark`, 'DELETE', undefined],
    ];
    for (const [path, method, body] of actions) {
      expect((await request(path, method, body, '')).status).toBe(401);
      expect(
        (await request(path, method, body, alice, { APP_ENV: 'production' }))
          .status,
      ).toBe(403);
      const badOrigin = await api.request(
        `http://localhost/api/v1${path}`,
        {
          method,
          headers: {
            Origin: 'https://evil.example',
            'Content-Type': 'application/json',
            Cookie: alice,
          },
          body: JSON.stringify(body ?? {}),
        },
        env,
      );
      expect(badOrigin.status).toBe(403);
    }
  });
});
