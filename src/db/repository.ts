import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { nodes, profiles, topics } from './schema';
import type { TopicInput, TopicCursor } from '../lib/contracts';

export function repository(binding: D1Database) {
  const db = drizzle(binding);
  const selection = {
    id: topics.id,
    title: topics.title,
    createdAt: topics.createdAt,
    node: nodes.name,
    slug: nodes.slug,
    username: profiles.username,
    author: profiles.displayName,
  };
  const visible = and(eq(topics.status, 'published'), eq(nodes.hidden, false));
  return {
    nodes: () =>
      db
        .select()
        .from(nodes)
        .where(eq(nodes.hidden, false))
        .orderBy(nodes.sortOrder, nodes.id),
    async list(cursor?: TopicCursor, slug?: string) {
      const rows = await db
        .select(selection)
        .from(topics)
        .innerJoin(nodes, eq(topics.nodeId, nodes.id))
        .innerJoin(profiles, eq(topics.authorId, profiles.id))
        .where(
          and(
            visible,
            slug ? eq(nodes.slug, slug) : undefined,
            cursor
              ? or(
                  lt(topics.createdAt, cursor.createdAt),
                  and(
                    eq(topics.createdAt, cursor.createdAt),
                    lt(topics.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(topics.createdAt), desc(topics.id))
        .limit(21);
      const hasNext = rows.length > 20;
      const items = rows.slice(0, 20);
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          hasNext && last
            ? JSON.stringify({ createdAt: last.createdAt, id: last.id })
            : null,
      };
    },
    async topic(id: string) {
      return (
        await db
          .select({ ...selection, body: topics.body })
          .from(topics)
          .innerJoin(nodes, eq(topics.nodeId, nodes.id))
          .innerJoin(profiles, eq(topics.authorId, profiles.id))
          .where(and(eq(topics.id, id), visible))
          .limit(1)
      )[0];
    },
    async create(input: TopicInput) {
      // INSERT…SELECT checks node visibility in the same SQL statement as the write.
      const node = db
        .select({ id: nodes.id })
        .from(nodes)
        .where(and(eq(nodes.id, input.nodeId), eq(nodes.hidden, false)));
      const now = Date.now();
      const result =
        await db.run(sql`INSERT INTO topics (id, author_id, node_id, title, body, status, created_at, updated_at, request_id)
        SELECT ${crypto.randomUUID()}, 'local-developer', id, ${input.title}, ${input.body}, 'published', ${now}, ${now}, ${input.requestId}
        FROM (${node}) WHERE true ON CONFLICT(author_id, request_id) DO NOTHING`);
      const existing = (
        await db
          .select()
          .from(topics)
          .where(
            and(
              eq(topics.authorId, 'local-developer'),
              eq(topics.requestId, input.requestId),
            ),
          )
          .limit(1)
      )[0];
      if (!existing) return { kind: 'invalid-node' as const };
      if (
        existing.title !== input.title ||
        existing.body !== input.body ||
        existing.nodeId !== input.nodeId
      )
        return { kind: 'conflict' as const };
      return {
        kind: 'ok' as const,
        id: existing.id,
        created: result.meta.changes === 1,
      };
    },
  };
}
