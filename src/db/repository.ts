import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { contentWrite } from './discussions';
import { activeProfile } from '../security/access';
import { nodes, profiles, topics, uploads } from './schema';
import type { TopicInput, FeedCursor, FeedOptions } from '../lib/contracts';

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
    avatarId: profiles.avatarId,
    replyCount: topics.replyCount,
    voteCount: topics.voteCount,
  };
  const visible = and(eq(topics.status, 'published'), eq(nodes.hidden, false));
  return {
    async publicProfile(username: string) {
      return (
        await db
          .select({
            id: profiles.id,
            username: profiles.username,
            displayName: profiles.displayName,
            bio: profiles.bio,
            avatarId: profiles.avatarId,
            createdAt: profiles.createdAt,
          })
          .from(profiles)
          .where(
            and(
              eq(profiles.username, username),
              sql`(${profiles.userId} IS NULL OR EXISTS(SELECT 1 FROM user WHERE id=${profiles.userId} AND email_verified=1))`,
            ),
          )
          .limit(1)
      )[0];
    },
    async editProfile(
      userId: string,
      value: {
        displayName: string;
        bio: string;
        avatarId: string | null;
        revision: number;
      },
    ) {
      return (
        (
          await db
            .update(profiles)
            .set({
              displayName: value.displayName,
              bio: value.bio,
              avatarId: value.avatarId,
              revision: sql`${profiles.revision}+1`,
            })
            .where(
              and(
                eq(profiles.userId, userId),
                eq(profiles.revision, value.revision),
                activeProfile(`member-${userId}`),
                value.avatarId
                  ? sql`EXISTS(SELECT 1 FROM uploads WHERE id=${value.avatarId} AND owner_id=${profiles.id} AND kind='avatar' AND state='ready')`
                  : undefined,
              ),
            )
            .returning({ id: profiles.id })
        ).length === 1
      );
    },
    async reserveUpload(
      userId: string,
      upload: {
        id: string;
        key: string;
        kind: 'avatar' | 'image';
        bytes: number;
        width: number;
        height: number;
      },
    ) {
      return (
        (
          await db.run(sql`INSERT INTO uploads(id,owner_id,object_key,kind,bytes,width,height,created_at)
        SELECT ${upload.id},profiles.id,${upload.key},${upload.kind},${upload.bytes},${upload.width},${upload.height},${Date.now()} FROM profiles
        WHERE profiles.user_id=${userId} AND ${activeProfile(`member-${userId}`)}
        AND (SELECT COALESCE(SUM(bytes),0) FROM uploads WHERE owner_id=profiles.id AND state!='deleted')+${upload.bytes}<=20971520 RETURNING id`)
        ).results.length === 1
      );
    },
    async readyUpload(id: string, userId: string) {
      return (
        (
          await db
            .update(uploads)
            .set({ state: 'ready' })
            .where(
              and(
                eq(uploads.id, id),
                eq(uploads.ownerId, `member-${userId}`),
                eq(uploads.state, 'pending'),
                activeProfile(`member-${userId}`),
              ),
            )
            .returning({ id: uploads.id })
        ).length === 1
      );
    },
    discardUpload(id: string) {
      return db
        .delete(uploads)
        .where(and(eq(uploads.id, id), eq(uploads.state, 'pending')));
    },
    async media(id: string) {
      return (
        await db
          .select()
          .from(uploads)
          .where(and(eq(uploads.id, id), eq(uploads.state, 'ready')))
          .limit(1)
      )[0];
    },
    ownUploads(userId: string) {
      return db
        .select({
          id: uploads.id,
          kind: uploads.kind,
          bytes: uploads.bytes,
          createdAt: uploads.createdAt,
        })
        .from(uploads)
        .where(
          and(
            eq(uploads.ownerId, `member-${userId}`),
            eq(uploads.state, 'ready'),
          ),
        )
        .orderBy(desc(uploads.createdAt))
        .limit(50);
    },
    async deleteUpload(id: string, userId: string) {
      const rows = await binding.batch<{ object_key: string }>([
        binding
          .prepare(
            "UPDATE uploads SET state='deleted' WHERE id=? AND owner_id=? AND state IN ('ready','deleted') AND EXISTS(SELECT 1 FROM account_access WHERE user_id=? AND banned=0) RETURNING object_key",
          )
          .bind(id, `member-${userId}`, userId),
        binding
          .prepare(
            "UPDATE profiles SET avatar_id=NULL,revision=revision+1 WHERE user_id=? AND avatar_id=? AND EXISTS(SELECT 1 FROM uploads WHERE id=? AND owner_id=profiles.id AND state='deleted')",
          )
          .bind(userId, id, id),
      ]);
      return rows[0].results[0]?.object_key;
    },
    nodes: () =>
      db
        .select()
        .from(nodes)
        .where(eq(nodes.hidden, false))
        .orderBy(nodes.sortOrder, nodes.id),
    async list(
      cursor?: FeedCursor,
      slug?: string,
      authorId?: string,
      options: FeedOptions = { sort: 'latest', q: '' },
    ) {
      const rank =
        options.sort === 'hot'
          ? sql<number>`(${topics.voteCount} * 3 + ${topics.replyCount})`
          : options.sort === 'active'
            ? sql<number>`coalesce(${topics.lastRepliedAt},${topics.createdAt})`
            : sql<number>`${topics.createdAt}`;
      const query = options.q
        ? `%${options.q.replace(/[!%_]/g, '!$&')}%`
        : null;
      const rows = await db
        .select({ ...selection, rank })
        .from(topics)
        .innerJoin(nodes, eq(topics.nodeId, nodes.id))
        .innerJoin(profiles, eq(topics.authorId, profiles.id))
        .where(
          and(
            visible,
            query
              ? sql`(${topics.title} LIKE ${query} ESCAPE '!' OR ${topics.body} LIKE ${query} ESCAPE '!')`
              : undefined,
            authorId ? eq(topics.authorId, authorId) : undefined,
            slug ? eq(nodes.slug, slug) : undefined,
            cursor
              ? or(
                  lt(rank, cursor.rank ?? cursor.createdAt),
                  and(
                    eq(rank, cursor.rank ?? cursor.createdAt),
                    or(
                      lt(topics.createdAt, cursor.createdAt),
                      and(
                        eq(topics.createdAt, cursor.createdAt),
                        lt(topics.id, cursor.id),
                      ),
                    ),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(rank), desc(topics.createdAt), desc(topics.id))
        .limit(21);
      const hasNext = rows.length > 20;
      const items = rows.slice(0, 20);
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          hasNext && last
            ? JSON.stringify({
                createdAt: last.createdAt,
                id: last.id,
                ...(options.sort === 'latest'
                  ? {}
                  : { sort: options.sort, rank: last.rank }),
                ...(options.q ? { q: options.q } : {}),
              })
            : null,
      };
    },
    async topic(id: string) {
      return (
        await db
          .select({
            ...selection,
            body: topics.body,
            authorId: topics.authorId,
            revision: topics.revision,
            updatedAt: topics.updatedAt,
            lastRepliedAt: topics.lastRepliedAt,
          })
          .from(topics)
          .innerJoin(nodes, eq(topics.nodeId, nodes.id))
          .innerJoin(profiles, eq(topics.authorId, profiles.id))
          .where(and(eq(topics.id, id), visible))
          .limit(1)
      )[0];
    },
    async profileForUser(user: { id: string; name: string }) {
      await db
        .insert(profiles)
        .values({
          id: `member-${user.id}`,
          userId: user.id,
          username: `u_${user.id}`,
          displayName: user.name,
          createdAt: Date.now(),
        })
        .onConflictDoNothing({ target: profiles.userId });
      return (
        await db
          .select()
          .from(profiles)
          .where(eq(profiles.userId, user.id))
          .limit(1)
      )[0]!;
    },
    async create(input: TopicInput, authorId: string) {
      // INSERT…SELECT checks node visibility in the same SQL statement as the write.
      const node = db
        .select({ id: nodes.id })
        .from(nodes)
        .where(
          and(
            eq(nodes.id, input.nodeId),
            eq(nodes.hidden, false),
            activeProfile(authorId),
          ),
        );
      const now = Date.now();
      const id = crypto.randomUUID();
      const result = await contentWrite(
        binding,
        new SQLiteSyncDialect()
          .sqlToQuery(sql`INSERT INTO topics (id, author_id, node_id, title, body, status, created_at, updated_at, request_id)
        SELECT ${id}, ${authorId}, id, ${input.title}, ${input.body}, 'published', ${now}, ${now}, ${input.requestId}
        FROM (${node}) WHERE true ON CONFLICT(author_id, request_id) DO NOTHING`),
        { kind: 'topic', id, body: input.body },
      );
      const existing = (
        await db
          .select()
          .from(topics)
          .where(
            and(
              eq(topics.authorId, authorId),
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
