import { beforeAll, beforeEach, afterAll, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { api } from '../src/lib/api';
import { repository } from '../src/db/repository';
import { validateImage } from '../src/lib/images';
import { setupDatabase, registerVerified } from './auth-helpers';
let fixture: Awaited<ReturnType<typeof setupDatabase>>,
  env: Env,
  owner: Awaited<ReturnType<typeof registerVerified>>,
  other: typeof owner;
const bytes = (name = 'image') =>
  new Uint8Array(readFileSync(`tests/fixtures/${name}.webp`));
const buffer = (name = 'image') => bytes(name).buffer;
function send(
  path: string,
  method = 'GET',
  body?: BodyInit,
  cookie = owner.cookie,
  mode = 'local',
  headers: Record<string, string> = {},
) {
  return api.request(
    `http://localhost/api/v1${path}`,
    {
      method,
      headers: {
        Origin: 'http://localhost',
        Cookie: cookie,
        'Content-Type':
          path.startsWith('/uploads/') && method === 'POST'
            ? 'image/webp'
            : 'application/json',
        ...headers,
      },
      body,
    },
    { ...env, APP_ENV: mode },
  );
}
type Profile = Awaited<
  ReturnType<ReturnType<typeof repository>['profileForUser']>
>;
type Image = { id: string; url: string };
const json = async <T>(response: Response) =>
  (await response.json()) as { data: T };
const profile = async (cookie = owner.cookie) =>
  (await json<Profile>(await send('/me/profile', 'GET', undefined, cookie)))
    .data;
const upload = async (kind = 'image') =>
  send(`/uploads/${kind}`, 'POST', bytes(kind));
beforeAll(async () => {
  fixture = await setupDatabase();
  env = fixture.env;
  owner = await registerVerified(env);
  other = await registerVerified(
    env,
    `${crypto.randomUUID()}@example.com`,
    '192.0.2.55',
  );
});
beforeEach(async () => {
  await env.DB.prepare('DELETE FROM write_limits').run();
});
afterAll(async () => {
  await fixture.mf.dispose();
});
it('decodes actual lossy/lossless WebP and rejects spoofed, truncated, oversized dimensions, animation and malformed data', async () => {
  for (const name of ['image', 'avatar', 'lossless'])
    expect(
      (
        await validateImage(
          buffer(name),
          name === 'avatar' ? 'avatar' : 'image',
        )
      ).width,
    ).toBe(name === 'avatar' ? 256 : name === 'lossless' ? 8 : 20);
  for (const value of [
    new TextEncoder().encode('<svg onload="alert(1)"></svg>').buffer,
    buffer('large'),
    buffer().slice(0, 24),
    new ArrayBuffer(2097153),
  ])
    await expect(validateImage(value, 'image')).rejects.toThrow();
  await expect(validateImage(buffer(), 'avatar')).rejects.toThrow();
  const malformed = bytes().slice(0, 30);
  new DataView(malformed.buffer).setUint32(4, 22, true);
  new DataView(malformed.buffer).setUint32(16, 10, true);
  await expect(validateImage(malformed.buffer, 'image')).rejects.toThrow();
  const animated = bytes();
  animated.set(new TextEncoder().encode('ANIM'), 12);
  await expect(validateImage(animated.buffer, 'image')).rejects.toThrow();
});
it('strips metadata and rejects trailing payload while retaining valid pixels', async () => {
  const source = bytes(),
    metadata = new TextEncoder().encode('PRIVATE GPS DATA'),
    extra = new Uint8Array(8 + metadata.length + (metadata.length % 2));
  extra.set(new TextEncoder().encode('EXIF'));
  new DataView(extra.buffer).setUint32(4, metadata.length, true);
  extra.set(metadata, 8);
  const combined = new Uint8Array(source.length + extra.length);
  combined.set(source);
  combined.set(extra, source.length);
  new DataView(combined.buffer).setUint32(4, combined.length - 8, true);
  const normalized = await validateImage(combined.buffer, 'image');
  expect(normalized.data).toEqual(source);
  expect(new TextDecoder().decode(normalized.data)).not.toContain('PRIVATE');
  const tail = new Uint8Array(source.length + 8);
  tail.set(source);
  await expect(validateImage(tail.buffer, 'image')).rejects.toThrow();
  const extended = new Uint8Array(18);
  extended.set(new TextEncoder().encode('VP8X'));
  new DataView(extended.buffer).setUint32(4, 10, true);
  extended[8] = 0x2c;
  extended[12] = 19;
  extended[15] = 9;
  const metadataChunk = (type: string) => {
    const chunk = extra.slice();
    chunk.set(new TextEncoder().encode(type));
    return chunk;
  };
  const chunks = [
    extended,
    metadataChunk('ICCP'),
    source.slice(12),
    metadataChunk('EXIF'),
    metadataChunk('XMP '),
  ];
  const wrapped = new Uint8Array(12 + chunks.reduce((n, c) => n + c.length, 0));
  wrapped.set(source.subarray(0, 12));
  new DataView(wrapped.buffer).setUint32(4, wrapped.length - 8, true);
  let at = 12;
  for (const chunk of chunks) {
    wrapped.set(chunk, at);
    at += chunk.length;
  }
  const clean = await validateImage(wrapped.buffer, 'image');
  expect(new TextDecoder().decode(clean.data)).not.toMatch(
    /ICCP|EXIF|XMP |PRIVATE/,
  );
  expect(clean.data[20]).toBe(0);
  wrapped[24] = 20;
  await expect(validateImage(wrapped.buffer, 'image')).rejects.toThrow();
});
it('requires verified session, exact origin, content type and local environment before accepting bytes', async () => {
  expect((await send('/uploads/image', 'POST', bytes(), '')).status).toBe(401);
  expect(
    (await send('/uploads/image', 'POST', bytes(), owner.cookie, 'production'))
      .status,
  ).toBe(403);
  expect(
    (
      await send('/uploads/image', 'POST', bytes(), owner.cookie, 'local', {
        Origin: 'https://evil.example',
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await send('/uploads/image', 'POST', bytes(), owner.cookie, 'local', {
        'Content-Type': 'image/png',
      })
    ).status,
  ).toBe(415);
  expect(
    (
      await send(
        '/uploads/image',
        'POST',
        new Uint8Array(2097153),
        owner.cookie,
        'local',
        { 'Content-Length': '10' },
      )
    ).status,
  ).toBe(413);
  expect(
    (await send('/uploads/image', 'POST', new Uint8Array(2097153))).status,
  ).toBe(413);
});
it('stores normalized bytes in real Miniflare R2 and serves only ready media with safe headers', async () => {
  const response = await upload();
  expect(response.status).toBe(201);
  const { data } = await json<Image>(response);
  const row = await repository(env.DB).media(data.id);
  expect(row!.ownerId).toBe((await profile()).id);
  const object = await env.UPLOADS.get(row!.key);
  expect(new Uint8Array(await object!.arrayBuffer())).toEqual(bytes());
  const media = await send(`/media/${data.id}`);
  expect(media.headers.get('Content-Type')).toBe('image/webp');
  expect(media.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(media.headers.get('Content-Security-Policy')).toContain('sandbox');
  expect(new Uint8Array(await media.arrayBuffer())).toEqual(bytes());
  expect((await send('/media/missing')).status).toBe(404);
});
it('edits only current profile, checks revisions and enforces avatar ownership/kind/readiness', async () => {
  const avatar = (await json<Image>(await upload('avatar'))).data;
  const current = await profile();
  const value = {
    displayName: '公开新名称',
    bio: '<script>安全纯文本</script>',
    avatarId: avatar.id,
    revision: current.revision,
  };
  expect(
    (
      await send(
        '/me/profile',
        'PATCH',
        JSON.stringify({ ...value, userId: 'someone-else' }),
      )
    ).status,
  ).toBe(400);
  expect(
    (await send('/me/profile', 'PATCH', JSON.stringify(value))).status,
  ).toBe(200);
  expect(
    (await send('/me/profile', 'PATCH', JSON.stringify(value))).status,
  ).toBe(409);
  const stranger = await profile(other.cookie);
  expect(
    (
      await send(
        '/me/profile',
        'PATCH',
        JSON.stringify({ ...value, revision: stranger.revision }),
        other.cookie,
      )
    ).status,
  ).toBe(409);
  const image = (await json<Image>(await upload())).data;
  expect(
    (
      await send(
        '/me/profile',
        'PATCH',
        JSON.stringify({
          ...value,
          revision: current.revision + 1,
          avatarId: image.id,
        }),
      )
    ).status,
  ).toBe(409);
  const publicProfile = await repository(env.DB).publicProfile(
    current.username,
  );
  expect(publicProfile!.displayName).toBe(value.displayName);
  expect(publicProfile).not.toHaveProperty('userId');
  expect(publicProfile).not.toHaveProperty('email');
});
it('owner alone can delete media; deletion clears avatar and prevents reassignment', async () => {
  const { data } = await json<Image>(await upload('avatar'));
  const current = await profile();
  await send(
    '/me/profile',
    'PATCH',
    JSON.stringify({
      displayName: current.displayName,
      bio: '',
      avatarId: data.id,
      revision: current.revision,
    }),
  );
  expect(
    (await send(`/uploads/${data.id}`, 'DELETE', undefined, other.cookie))
      .status,
  ).toBe(404);
  expect((await send(`/uploads/${data.id}`, 'DELETE')).status).toBe(200);
  expect((await send(`/media/${data.id}`)).status).toBe(404);
  expect((await profile()).avatarId).toBeNull();
  expect((await send(`/uploads/${data.id}`, 'DELETE')).status).toBe(200);
});
it('compensates R2 failure without exposing a pending object', async () => {
  const originalBucket = env.UPLOADS;
  env.UPLOADS = new Proxy(originalBucket, {
    get(target, key) {
      if (key === 'put')
        return vi.fn().mockRejectedValue(new Error('storage fault'));
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  expect((await upload()).status).toBe(500);
  env.UPLOADS = originalBucket;
  expect(
    (await env.DB.prepare("SELECT id FROM uploads WHERE state='pending'").all())
      .results,
  ).toEqual([]);
});
it('rechecks bans at reservation/finalization and compensates an upload banned during R2 put', async () => {
  const person = await registerVerified(
    env,
    `${crypto.randomUUID()}@example.com`,
    '192.0.2.66',
  );
  const p = await profile(person.cookie);
  const originalBucket = env.UPLOADS;
  env.UPLOADS = new Proxy(originalBucket, {
    get(target, key) {
      if (key === 'put')
        return async (...args: Parameters<R2Bucket['put']>) => {
          await env.DB.prepare(
            'UPDATE account_access SET banned=1 WHERE user_id=?',
          )
            .bind(p.userId)
            .run();
          return originalBucket.put(...args);
        };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  expect(
    (await send('/uploads/image', 'POST', bytes(), person.cookie)).status,
  ).toBe(500);
  env.UPLOADS = originalBucket;
  expect(
    (
      await env.DB.prepare('SELECT id FROM uploads WHERE owner_id=?')
        .bind(p.id)
        .all()
    ).results,
  ).toEqual([]);
  expect(
    (
      await send(
        '/me/profile',
        'PATCH',
        JSON.stringify({
          displayName: '绕过封禁',
          bio: '',
          avatarId: null,
          revision: p.revision,
        }),
        person.cookie,
      )
    ).status,
  ).toBe(401);
});
it('atomically enforces storage quota and limits upload attempts', async () => {
  const current = await profile(),
    repo = repository(env.DB);
  const attempts = await Promise.all(
    Array.from({ length: 15 }, () => {
      const id = crypto.randomUUID();
      return repo.reserveUpload(current.userId!, {
        id,
        key: `quota/${id}`,
        kind: 'image',
        bytes: 2097152,
        width: 1,
        height: 1,
      });
    }),
  );
  expect(attempts.filter(Boolean).length).toBeLessThanOrEqual(10);
  expect(attempts.filter(Boolean).length).toBeGreaterThan(0);
  await env.DB.prepare(
    "DELETE FROM uploads WHERE object_key LIKE 'quota/%'",
  ).run();
  // Keep the quota assertion in one fixed minute even when CI crosses :00.
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  try {
    for (let i = 0; i < 10; i++)
      expect(
        (await send('/uploads/image', 'POST', new Uint8Array([1]))).status,
      ).toBe(400);
    const limited = await upload();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    // The existing fixed-window policy permits requests in the next minute.
    clock.mockReturnValue((Math.floor(now / 60000) + 1) * 60000);
    expect((await upload()).status).toBe(201);
  } finally {
    clock.mockRestore();
  }
});
it('keeps failed cleanup pending and private, then allows retry after a normal delete failure', async () => {
  const original = env.UPLOADS;
  const person = await registerVerified(
    env,
    `${crypto.randomUUID()}@example.com`,
    '192.0.2.67',
  );
  const p = await profile(person.cookie);
  env.UPLOADS = new Proxy(original, {
    get(target, key) {
      if (key === 'put')
        return async (...args: Parameters<R2Bucket['put']>) => {
          await env.DB.prepare(
            'UPDATE account_access SET banned=1 WHERE user_id=?',
          )
            .bind(p.userId)
            .run();
          return original.put(...args);
        };
      if (key === 'delete')
        return vi.fn().mockRejectedValue(new Error('cleanup unavailable'));
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  expect(
    (await send('/uploads/image', 'POST', bytes(), person.cookie)).status,
  ).toBe(500);
  env.UPLOADS = original;
  const pending = await env.DB.prepare(
    "SELECT id,object_key FROM uploads WHERE owner_id=? AND state='pending'",
  )
    .bind(p.id)
    .first<{ id: string; object_key: string }>();
  expect(pending).not.toBeNull();
  expect((await send(`/media/${pending!.id}`)).status).toBe(404);
  const current = await profile();
  const pendingAvatar = crypto.randomUUID();
  await repository(env.DB).reserveUpload(current.userId!, {
    id: pendingAvatar,
    key: `pending/${pendingAvatar}`,
    kind: 'avatar',
    bytes: 100,
    width: 256,
    height: 256,
  });
  expect(
    (
      await send(
        '/me/profile',
        'PATCH',
        JSON.stringify({
          displayName: current.displayName,
          bio: '',
          avatarId: pendingAvatar,
          revision: current.revision,
        }),
      )
    ).status,
  ).toBe(409);
  await repository(env.DB).discardUpload(pendingAvatar);
  const { data } = await json<Image>(await upload());
  env.UPLOADS = new Proxy(original, {
    get(target, key) {
      if (key === 'delete')
        return vi.fn().mockRejectedValue(new Error('delete unavailable'));
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  expect((await send(`/uploads/${data.id}`, 'DELETE')).status).toBe(500);
  env.UPLOADS = original;
  expect((await send(`/media/${data.id}`)).status).toBe(404);
  expect((await send(`/uploads/${data.id}`, 'DELETE')).status).toBe(200);
});
it('enforces the shared IP quota across distinct users and lists only public author topics', async () => {
  const current = await profile(),
    repo = repository(env.DB);
  const otherProfile = await profile(other.cookie);
  await env.DB.prepare(
    'INSERT INTO write_limits(key,count,expires_at) VALUES (?,30,?)',
  )
    .bind(
      JSON.stringify(['upload', 'ip', '127.0.0.1']),
      (Math.floor(Date.now() / 60000) + 1) * 60000,
    )
    .run();
  expect(
    (await send('/uploads/image', 'POST', bytes(), other.cookie)).status,
  ).toBe(429);
  const topic = await repo.create(
    {
      title: '主页公开讨论',
      body: '公开内容',
      nodeId: 'dev',
      requestId: crypto.randomUUID(),
    },
    current.id,
  );
  expect(topic.kind).toBe('ok');
  await repo.create(
    {
      title: '其他作者讨论',
      body: '其他内容',
      nodeId: 'dev',
      requestId: crypto.randomUUID(),
    },
    otherProfile.id,
  );
  const page = await repo.list(undefined, undefined, current.id);
  expect(page.items).toHaveLength(1);
  await env.DB.prepare("UPDATE topics SET status='hidden' WHERE author_id=?")
    .bind(current.id)
    .run();
  expect(
    (await repo.list(undefined, undefined, current.id)).items,
  ).toHaveLength(0);
});
