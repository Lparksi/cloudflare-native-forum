import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { getSession } from '../auth/server';
import { localMailboxAllowed, localMessages } from '../auth/mail';
import { repository } from '../db/repository';
import { discussions } from '../db/discussions';
import {
  localWriteAllowed,
  parseCursor,
  topicInput,
  topicEditInput,
  replyInput,
  replyEditInput,
  revisionInput,
  previewInput,
  replyCursor,
} from './contracts';
import { renderMarkdown } from './markdown';

type ApiEnv = {
  Bindings: Env;
  Variables: { actor: { id: string; name: string } };
};
export const api = new Hono<ApiEnv>().basePath('/api/v1');
const error = (code: string, message: string) => ({ error: { code, message } });
async function input<T extends z.ZodType>(
  c: Context<ApiEnv>,
  schema: T,
): Promise<z.infer<T>> {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: 'JSON 格式无效' });
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success)
    throw new HTTPException(400, {
      message: '输入无效，请检查内容长度、格式或版本号',
    });
  return parsed.data;
}
function cursor(c: Context<ApiEnv>) {
  try {
    return parseCursor(c.req.query('cursor') ?? null);
  } catch {
    throw new HTTPException(400, { message: '分页参数无效' });
  }
}
function mutation(
  c: Context<ApiEnv>,
  result: 'ok' | 'not-found' | 'forbidden' | 'conflict',
) {
  if (result === 'not-found')
    return c.json(error('NOT_FOUND', '内容不存在或已移除'), 404);
  if (result === 'forbidden')
    return c.json(error('FORBIDDEN', '只能修改自己的内容'), 403);
  if (result === 'conflict')
    return c.json(error('CONFLICT', '内容已更新，请刷新后重新编辑'), 409);
  return c.json({ data: { status: 'ok' } });
}
api.use('*', async (c, next) => {
  if (['GET', 'HEAD'].includes(c.req.method)) return next();
  if (!localWriteAllowed(c.env.APP_ENV, c.req.url))
    return c.json(error('WRITE_DISABLED', '本阶段仅开放本地开发写入'), 403);
  if (c.req.header('origin') !== new URL(c.req.url).origin)
    return c.json(error('INVALID_ORIGIN', '请求来源无效'), 403);
  if (!c.req.header('content-type')?.startsWith('application/json'))
    return c.json(error('INVALID_CONTENT_TYPE', '请使用 JSON'), 415);
  const session = await getSession(c.env, c.req.raw);
  if (!session?.user.emailVerified)
    return c.json(error('UNAUTHORIZED', '请先验证邮箱并登录'), 401);
  c.set('actor', session.user);
  await next();
});
api.use(
  '*',
  bodyLimit({
    maxSize: 100000,
    onError: (c) => c.json(error('BODY_TOO_LARGE', '内容过大'), 413),
  }),
);
api.get('/health', async (c) => {
  await c.env.DB.prepare('SELECT 1').first();
  return c.json({ data: { status: 'ok', database: 'connected' } });
});
api.get('/nodes', async (c) =>
  c.json({ data: await repository(c.env.DB).nodes() }),
);
api.get('/topics', async (c) =>
  c.json({
    data: await repository(c.env.DB).list(cursor(c), c.req.query('node')),
  }),
);
api.get('/topics/:id', async (c) => {
  const topic = await repository(c.env.DB).topic(c.req.param('id'));
  return topic
    ? c.json({ data: topic })
    : c.json(error('NOT_FOUND', '主题不存在'), 404);
});
api.post('/topics', async (c) => {
  const payload = await input(c, topicInput);
  const repo = repository(c.env.DB);
  const profile = await repo.profileForUser(c.get('actor'));
  const result = await repo.create(payload, profile.id);
  if (result.kind === 'invalid-node')
    return c.json(error('INVALID_NODE', '节点不存在或已隐藏'), 400);
  if (result.kind === 'conflict')
    return c.json(
      error('IDEMPOTENCY_CONFLICT', '此提交标识已用于其他内容'),
      409,
    );
  return c.json({ data: { id: result.id } }, result.created ? 201 : 200);
});
api.patch('/topics/:id', async (c) =>
  mutation(
    c,
    await discussions(c.env.DB).editTopic(
      c.req.param('id'),
      `member-${c.get('actor').id}`,
      await input(c, topicEditInput),
    ),
  ),
);
api.delete('/topics/:id', async (c) =>
  mutation(
    c,
    await discussions(c.env.DB).deleteTopic(
      c.req.param('id'),
      `member-${c.get('actor').id}`,
      (await input(c, revisionInput)).revision,
    ),
  ),
);
api.get('/topics/:id/replies', async (c) => {
  const id = c.req.param('id');
  if (!(await repository(c.env.DB).topic(id)))
    return c.json(error('NOT_FOUND', '主题不存在'), 404);
  const after = replyCursor.safeParse(c.req.query('after') ?? 0);
  if (!after.success)
    return c.json(error('INVALID_CURSOR', '分页参数无效'), 400);
  return c.json({
    data: await discussions(c.env.DB).listReplies(id, after.data),
  });
});
api.post('/topics/:id/replies', async (c) => {
  const payload = await input(c, replyInput);
  const profile = await repository(c.env.DB).profileForUser(c.get('actor'));
  const result = await discussions(c.env.DB).createReply(
    c.req.param('id'),
    profile.id,
    payload,
  );
  if (result.kind === 'not-found')
    return c.json(error('NOT_FOUND', '内容不存在或已移除'), 404);
  if (result.kind === 'conflict')
    return c.json(
      error('IDEMPOTENCY_CONFLICT', '此提交标识已用于其他内容'),
      409,
    );
  return c.json(
    { data: { id: result.id, floor: result.floor } },
    result.created ? 201 : 200,
  );
});
api.patch('/replies/:id', async (c) =>
  mutation(
    c,
    await discussions(c.env.DB).editReply(
      c.req.param('id'),
      `member-${c.get('actor').id}`,
      await input(c, replyEditInput),
    ),
  ),
);
api.delete('/replies/:id', async (c) =>
  mutation(
    c,
    await discussions(c.env.DB).deleteReply(
      c.req.param('id'),
      `member-${c.get('actor').id}`,
      (await input(c, revisionInput)).revision,
    ),
  ),
);
api.get('/topics/:id/interactions', async (c) => {
  const session = await getSession(c.env, c.req.raw);
  const state = await discussions(c.env.DB).interactionState(
    c.req.param('id'),
    session ? `member-${session.user.id}` : '',
  );
  return state
    ? c.json({ data: state })
    : c.json(error('NOT_FOUND', '主题不存在'), 404);
});
for (const kind of ['vote', 'bookmark'] as const) {
  for (const method of ['PUT', 'DELETE'] as const) {
    api.on(method, `/topics/:id/${kind}`, async (c) => {
      const id = c.req.param('id')!;
      const profile = await repository(c.env.DB).profileForUser(c.get('actor'));
      const repo = discussions(c.env.DB);
      await repo.setInteraction(id, profile.id, kind, method === 'PUT');
      const state = await repo.interactionState(id, profile.id);
      return state
        ? c.json({ data: state })
        : c.json(error('NOT_FOUND', '主题不存在'), 404);
    });
  }
}
api.get('/bookmarks', async (c) => {
  const session = await getSession(c.env, c.req.raw);
  if (!session?.user.emailVerified)
    return c.json(error('UNAUTHORIZED', '请先登录'), 401);
  return c.json({
    data: await discussions(c.env.DB).bookmarks(
      `member-${session.user.id}`,
      cursor(c),
    ),
  });
});
api.post('/markdown/preview', async (c) =>
  c.json({
    data: { html: await renderMarkdown((await input(c, previewInput)).body) },
  }),
);
api.get('/dev/mail', async (c) => {
  if (!localMailboxAllowed(c.env, c.req.url))
    return c.json(error('NOT_FOUND', '不存在'), 404);
  return c.json({ data: await localMessages(c.env, c.req.query('email')) });
});
api.notFound((c) => c.json(error('NOT_FOUND', 'API 不存在'), 404));
api.onError((err, c) => {
  if (err instanceof HTTPException)
    return c.json(error('INVALID_INPUT', err.message), err.status);
  console.error(JSON.stringify({ event: 'api_error', name: err.name }));
  return c.json(error('INTERNAL_ERROR', '服务暂时不可用'), 500);
});
