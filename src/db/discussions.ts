import { and, asc, desc, eq, gt, lt, or, sql } from 'drizzle-orm';
import { activeProfile } from '../security/access';
import { drizzle } from 'drizzle-orm/d1';
import {
  bookmarks,
  nodes,
  profiles,
  replies,
  topics,
  topicVotes,
} from './schema';
import type {
  ReplyInput,
  ReplyEditInput,
  TopicEditInput,
  TopicCursor,
} from '../lib/contracts';

export function discussions(binding: D1Database) {
  const db = drizzle(binding);
  const visible = and(eq(topics.status, 'published'), eq(nodes.hidden, false));
  const visibleTopic = (id: string) =>
    db
      .select({ id: topics.id })
      .from(topics)
      .innerJoin(nodes, eq(topics.nodeId, nodes.id))
      .where(and(eq(topics.id, id), visible));
  async function topicAccess(id: string, authorId: string) {
    const row = (
      await db
        .select({ authorId: topics.authorId })
        .from(topics)
        .innerJoin(nodes, eq(topics.nodeId, nodes.id))
        .where(and(eq(topics.id, id), visible))
        .limit(1)
    )[0];
    return !row
      ? ('not-found' as const)
      : row.authorId !== authorId
        ? ('forbidden' as const)
        : ('conflict' as const);
  }
  async function replyAccess(id: string, authorId: string) {
    const row = (
      await db
        .select({ authorId: replies.authorId })
        .from(replies)
        .innerJoin(topics, eq(replies.topicId, topics.id))
        .innerJoin(nodes, eq(topics.nodeId, nodes.id))
        .where(
          and(eq(replies.id, id), eq(replies.status, 'published'), visible),
        )
        .limit(1)
    )[0];
    return !row
      ? ('not-found' as const)
      : row.authorId !== authorId
        ? ('forbidden' as const)
        : ('conflict' as const);
  }
  return {
    async editTopic(id: string, authorId: string, input: TopicEditInput) {
      const result = await db
        .update(topics)
        .set({
          title: input.title,
          body: input.body,
          updatedAt: Date.now(),
          revision: sql`${topics.revision} + 1`,
        })
        .where(
          and(
            eq(topics.id, id),
            eq(topics.authorId, authorId),
            activeProfile(authorId),
            eq(topics.revision, input.revision),
            sql`${topics.id} IN (${visibleTopic(id)})`,
          ),
        )
        .returning({ id: topics.id });
      return result[0] ? ('ok' as const) : topicAccess(id, authorId);
    },
    async deleteTopic(id: string, authorId: string, revision: number) {
      const result = await db
        .update(topics)
        .set({
          status: 'deleted',
          revision: sql`${topics.revision} + 1`,
          updatedAt: Date.now(),
        })
        .where(
          and(
            eq(topics.id, id),
            eq(topics.authorId, authorId),
            activeProfile(authorId),
            eq(topics.revision, revision),
            sql`${topics.id} IN (${visibleTopic(id)})`,
          ),
        )
        .returning({ id: topics.id });
      return result[0] ? ('ok' as const) : topicAccess(id, authorId);
    },
    async listReplies(topicId: string, after = 0) {
      const rows = await db
        .select({
          id: replies.id,
          floor: replies.floor,
          status: replies.status,
          revision: replies.revision,
          body: sql<
            string | null
          >`CASE WHEN ${replies.status} = 'published' THEN ${replies.body} ELSE NULL END`,
          authorId: replies.authorId,
          author: profiles.displayName,
          username: profiles.username,
          avatarId: profiles.avatarId,
          createdAt: replies.createdAt,
          updatedAt: replies.updatedAt,
        })
        .from(replies)
        .innerJoin(profiles, eq(replies.authorId, profiles.id))
        .innerJoin(topics, eq(replies.topicId, topics.id))
        .innerJoin(nodes, eq(topics.nodeId, nodes.id))
        .where(
          and(eq(replies.topicId, topicId), gt(replies.floor, after), visible),
        )
        .orderBy(asc(replies.floor))
        .limit(31);
      const items = rows.slice(0, 30);
      return {
        items,
        nextCursor: rows.length > 30 ? items.at(-1)!.floor : null,
      };
    },
    async reply(id: string) {
      return (
        await db
          .select({
            id: replies.id,
            topicId: replies.topicId,
            authorId: replies.authorId,
            body: replies.body,
            revision: replies.revision,
            floor: replies.floor,
          })
          .from(replies)
          .innerJoin(topics, eq(replies.topicId, topics.id))
          .innerJoin(nodes, eq(topics.nodeId, nodes.id))
          .where(
            and(eq(replies.id, id), eq(replies.status, 'published'), visible),
          )
          .limit(1)
      )[0];
    },
    async createReply(topicId: string, authorId: string, input: ReplyInput) {
      const id = crypto.randomUUID();
      const now = Date.now();
      await db.run(sql`INSERT INTO replies (id, topic_id, author_id, floor, body, request_id, created_at, updated_at)
        SELECT ${id}, topics.id, ${authorId}, topics.next_reply_floor + 1, ${input.body}, ${input.requestId}, ${now}, ${now}
        FROM topics INNER JOIN nodes ON topics.node_id = nodes.id
        WHERE topics.id = ${topicId} AND topics.status = 'published' AND nodes.hidden = 0 AND ${activeProfile(authorId)}
        ON CONFLICT(author_id, request_id) DO NOTHING`);
      const existing = (
        await db
          .select({
            id: replies.id,
            floor: replies.floor,
            topicId: replies.topicId,
            body: replies.body,
          })
          .from(replies)
          .innerJoin(topics, eq(replies.topicId, topics.id))
          .innerJoin(nodes, eq(topics.nodeId, nodes.id))
          .where(
            and(
              eq(replies.authorId, authorId),
              activeProfile(authorId),
              eq(replies.requestId, input.requestId),
              eq(replies.status, 'published'),
              visible,
            ),
          )
          .limit(1)
      )[0];
      if (!existing) return { kind: 'not-found' as const };
      if (existing.topicId !== topicId || existing.body !== input.body)
        return { kind: 'conflict' as const };
      return {
        kind: 'ok' as const,
        id: existing.id,
        floor: existing.floor,
        created: existing.id === id,
      };
    },
    async editReply(id: string, authorId: string, input: ReplyEditInput) {
      const result = await db
        .update(replies)
        .set({
          body: input.body,
          revision: sql`${replies.revision} + 1`,
          updatedAt: Date.now(),
        })
        .where(
          and(
            eq(replies.id, id),
            eq(replies.authorId, authorId),
            activeProfile(authorId),
            eq(replies.status, 'published'),
            eq(replies.revision, input.revision),
            sql`${replies.topicId} IN (${db.select({ id: topics.id }).from(topics).innerJoin(nodes, eq(topics.nodeId, nodes.id)).where(visible)})`,
          ),
        )
        .returning({ id: replies.id });
      return result[0] ? ('ok' as const) : replyAccess(id, authorId);
    },
    async deleteReply(id: string, authorId: string, revision: number) {
      const result = await db
        .update(replies)
        .set({
          status: 'deleted',
          revision: sql`${replies.revision} + 1`,
          updatedAt: Date.now(),
        })
        .where(
          and(
            eq(replies.id, id),
            eq(replies.authorId, authorId),
            activeProfile(authorId),
            eq(replies.status, 'published'),
            eq(replies.revision, revision),
            sql`${replies.topicId} IN (${db.select({ id: topics.id }).from(topics).innerJoin(nodes, eq(topics.nodeId, nodes.id)).where(visible)})`,
          ),
        )
        .returning({ id: replies.id });
      return result[0] ? ('ok' as const) : replyAccess(id, authorId);
    },
    async interactionState(topicId: string, profileId: string) {
      return (
        await db
          .select({
            voteCount: topics.voteCount,
            voted:
              sql<boolean>`EXISTS(SELECT 1 FROM topic_votes WHERE topic_id = ${topics.id} AND profile_id = ${profileId})`.mapWith(
                Boolean,
              ),
            bookmarked:
              sql<boolean>`EXISTS(SELECT 1 FROM bookmarks WHERE topic_id = ${topics.id} AND profile_id = ${profileId})`.mapWith(
                Boolean,
              ),
          })
          .from(topics)
          .innerJoin(nodes, eq(topics.nodeId, nodes.id))
          .where(and(eq(topics.id, topicId), visible))
          .limit(1)
      )[0];
    },
    async setInteraction(
      topicId: string,
      profileId: string,
      kind: 'vote' | 'bookmark',
      active: boolean,
    ) {
      const table = kind === 'vote' ? topicVotes : bookmarks;
      if (active) {
        await db.run(sql`INSERT INTO ${table} (topic_id, profile_id, created_at) SELECT topics.id, ${profileId}, ${Date.now()}
          FROM topics INNER JOIN nodes ON topics.node_id = nodes.id WHERE topics.id = ${topicId} AND topics.status = 'published' AND nodes.hidden = 0 AND ${activeProfile(profileId)}
          ON CONFLICT DO NOTHING`);
      } else {
        await db
          .delete(table)
          .where(
            and(
              eq(table.topicId, topicId),
              eq(table.profileId, profileId),
              activeProfile(profileId),
              sql`${table.topicId} IN (${visibleTopic(topicId)})`,
            ),
          );
      }
    },
    async bookmarks(profileId: string, cursor?: TopicCursor) {
      const rows = await db
        .select({
          id: topics.id,
          title: topics.title,
          createdAt: topics.createdAt,
          node: nodes.name,
          slug: nodes.slug,
          author: profiles.displayName,
          username: profiles.username,
          avatarId: profiles.avatarId,
          replyCount: topics.replyCount,
          voteCount: topics.voteCount,
        })
        .from(bookmarks)
        .innerJoin(topics, eq(bookmarks.topicId, topics.id))
        .innerJoin(nodes, eq(topics.nodeId, nodes.id))
        .innerJoin(profiles, eq(topics.authorId, profiles.id))
        .where(
          and(
            eq(bookmarks.profileId, profileId),
            visible,
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
      const items = rows.slice(0, 20);
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          rows.length > 20 && last
            ? JSON.stringify({ createdAt: last.createdAt, id: last.id })
            : null,
      };
    },
  };
}
