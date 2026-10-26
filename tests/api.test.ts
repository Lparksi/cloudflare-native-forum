import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { setupDatabase, registerVerified } from './auth-helpers';
import { api } from '../src/lib/api';

let mf: Miniflare;
let env: Env;
let cookie: string;
function create(
  overrides: Record<string, unknown> = {},
  mode: Env['APP_ENV'] = 'local',
  headers: Record<string, string> = {},
) {
  return api.request(
    'http://localhost/api/v1/topics',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost',
        Cookie: cookie,
        ...headers,
      },
      body: JSON.stringify({
        title: '测试主题',
        body: '真实写入 D1',
        nodeId: 'dev',
        requestId: crypto.randomUUID(),
        ...overrides,
      }),
    },
    { ...env, APP_ENV: mode },
  );
}
beforeAll(async () => {
  ({ mf, env } = await setupDatabase());
  ({ cookie } = await registerVerified(env));
});
beforeEach(async () => {
  await env.DB.prepare('DELETE FROM topics').run();
  await env.DB.prepare('UPDATE nodes SET hidden = 0').run();
});
afterAll(async () => {
  await mf.dispose();
});
describe('local D1 topic API', () => {
  it('persists and reads a topic with an escaped-content contract', async () => {
    const response = await create({ body: '<script>alert(1)</script>' });
    expect(response.status).toBe(201);
    const { data } = (await response.json()) as { data: { id: string } };
    const detail = await api.request(
      `http://localhost/api/v1/topics/${data.id}`,
      {},
      env,
    );
    expect(await detail.json()).toMatchObject({
      data: {
        title: '测试主题',
        body: '<script>alert(1)</script>',
        author: '测试成员',
      },
    });
    expect(
      (
        await env.DB.prepare('SELECT count(*) AS n FROM topics').first<{
          n: number;
        }>()
      )?.n,
    ).toBe(1);
  });
  it('handles concurrent duplicate writes and rejects key reuse with different content', async () => {
    const requestId = crypto.randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => create({ requestId })),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([
      200, 200, 200, 200, 200, 201,
    ]);
    expect(
      (
        await env.DB.prepare('SELECT count(*) AS n FROM topics').first<{
          n: number;
        }>()
      )?.n,
    ).toBe(1);
    expect((await create({ requestId, title: '另一主题' })).status).toBe(409);
  });
  it('rejects unauthenticated topic writes', async () => {
    expect((await create({}, 'local', { Cookie: '' })).status).toBe(401);
  });
  it('closes writes outside local mode and rejects cross-site requests', async () => {
    expect((await create({}, 'test')).status).toBe(403);
    expect((await create({}, 'production')).status).toBe(403);
    expect(
      (await create({}, 'local', { Origin: 'https://evil.example' })).status,
    ).toBe(403);
    const response = await api.request(
      'https://forum.example/api/v1/topics',
      { method: 'POST' },
      env,
    );
    expect(response.status).toBe(403);
  });
  it('validates content, JSON, size, nodes and cursor', async () => {
    expect((await create({ title: 'a' })).status).toBe(400);
    expect((await create({ authorId: 'local-developer' })).status).toBe(400);
    expect((await create({ title: '\u0000abc' })).status).toBe(400);
    expect((await create({ body: '\u0000abc' })).status).toBe(400);
    expect((await create({ nodeId: 'missing' })).status).toBe(400);
    expect((await create({ body: 'a'.repeat(100001) })).status).toBe(413);
    expect(
      (await create({}, 'local', { 'Content-Type': 'text/plain' })).status,
    ).toBe(415);
    expect(
      (await api.request('http://localhost/api/v1/topics?cursor=bad', {}, env))
        .status,
    ).toBe(400);
    const malformed = await api.request(
      'http://localhost/api/v1/topics',
      {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: '{',
      },
      env,
    );
    expect(malformed.status).toBe(400);
  });
  it('excludes hidden/deleted topics and hidden nodes from list and detail', async () => {
    const response = await create();
    const { data } = (await response.json()) as { data: { id: string } };
    for (const status of ['hidden', 'deleted']) {
      await env.DB.prepare('UPDATE topics SET status = ?').bind(status).run();
      expect(
        (
          await api.request(
            `http://localhost/api/v1/topics/${data.id}`,
            {},
            env,
          )
        ).status,
      ).toBe(404);
      expect(
        await (
          await api.request('http://localhost/api/v1/topics', {}, env)
        ).json(),
      ).toMatchObject({ data: { items: [] } });
    }
    await env.DB.prepare("UPDATE topics SET status = 'published'").run();
    await env.DB.prepare('UPDATE nodes SET hidden = 1 WHERE id = ?')
      .bind('dev')
      .run();
    expect((await create()).status).toBe(400);
    expect(
      (await api.request(`http://localhost/api/v1/topics/${data.id}`, {}, env))
        .status,
    ).toBe(404);
  });
  it('paginates with a stable tie breaker and no overlap', async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => create({ title: `分页主题 ${i}` })),
    );
    await env.DB.prepare('UPDATE topics SET created_at = 1000').run();
    type Page = {
      data: { items: { id: string }[]; nextCursor: string | null };
    };
    const first = (await (
      await api.request('http://localhost/api/v1/topics', {}, env)
    ).json()) as Page;
    expect(first.data.items).toHaveLength(20);
    const second = (await (
      await api.request(
        `http://localhost/api/v1/topics?cursor=${encodeURIComponent(first.data.nextCursor!)}`,
        {},
        env,
      )
    ).json()) as Page;
    expect(second.data.items).toHaveLength(5);
    expect(second.data.nextCursor).toBeNull();
    expect(
      new Set([...first.data.items, ...second.data.items].map((t) => t.id))
        .size,
    ).toBe(25);
  });
});
