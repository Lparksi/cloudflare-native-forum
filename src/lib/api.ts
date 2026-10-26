import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { repository } from '../db/repository';
import { localWriteAllowed, parseCursor, topicInput } from './contracts';

export const api = new Hono<{ Bindings: Env }>().basePath('/api/v1');
const error = (code: string, message: string) => ({ error: { code, message } });
api.get('/health', async (c) => {
  await c.env.DB.prepare('SELECT 1').first();
  return c.json({ data: { status: 'ok', database: 'connected' } });
});
api.get('/nodes', async (c) =>
  c.json({ data: await repository(c.env.DB).nodes() }),
);
api.get('/topics', async (c) => {
  let cursor;
  try {
    cursor = parseCursor(c.req.query('cursor') ?? null);
  } catch {
    return c.json(error('INVALID_CURSOR', '分页参数无效'), 400);
  }
  return c.json({
    data: await repository(c.env.DB).list(cursor, c.req.query('node')),
  });
});
api.get('/topics/:id', async (c) => {
  const topic = await repository(c.env.DB).topic(c.req.param('id'));
  return topic
    ? c.json({ data: topic })
    : c.json(error('NOT_FOUND', '主题不存在'), 404);
});
api.post(
  '/topics',
  async (c, next) => {
    if (!localWriteAllowed(c.env.APP_ENV, c.req.url))
      return c.json(error('WRITE_DISABLED', '本阶段仅开放本地开发写入'), 403);
    if (c.req.header('origin') !== new URL(c.req.url).origin)
      return c.json(error('INVALID_ORIGIN', '请求来源无效'), 403);
    if (!c.req.header('content-type')?.startsWith('application/json'))
      return c.json(error('INVALID_CONTENT_TYPE', '请使用 JSON'), 415);
    await next();
  },
  bodyLimit({
    maxSize: 100000,
    onError: (c) => c.json(error('BODY_TOO_LARGE', '内容过大'), 413),
  }),
  async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json(error('INVALID_JSON', 'JSON 格式无效'), 400);
    }
    const input = topicInput.safeParse(payload);
    if (!input.success)
      return c.json(
        error(
          'INVALID_INPUT',
          '标题需 3–120 字，正文需 1–20000 字，请选择节点',
        ),
        400,
      );
    const result = await repository(c.env.DB).create(input.data);
    if (result.kind === 'invalid-node')
      return c.json(error('INVALID_NODE', '节点不存在或已隐藏'), 400);
    if (result.kind === 'conflict')
      return c.json(
        error('IDEMPOTENCY_CONFLICT', '此提交标识已用于其他内容'),
        409,
      );
    return c.json({ data: { id: result.id } }, result.created ? 201 : 200);
  },
);
api.notFound((c) => c.json(error('NOT_FOUND', 'API 不存在'), 404));
api.onError((err, c) => {
  console.error(JSON.stringify({ event: 'api_error', name: err.name }));
  return c.json(error('INTERNAL_ERROR', '服务暂时不可用'), 500);
});
