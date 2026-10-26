import { and, asc, desc, eq, gt, lt, or, sql } from 'drizzle-orm';
import { activeProfile } from '../security/access';
import { drizzle } from 'drizzle-orm/d1';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { mentionNames } from '../lib/mentions';
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

// Notification INSERT directly follows the mutation: changes() belongs to that write.
// Unique recipient/source prevents edits and idempotent retries from notifying twice.
export async function contentWrite(
  binding: D1Database,
  query: { sql: string; params: unknown[] },
  source: {
    kind: 'topic' | 'reply';
    id: string;
    body: string;
    replyToAuthor?: boolean;
  },
) {
  const reply = source.kind === 'reply',
    names = JSON.stringify(mentionNames(source.body));
  const rows = await binding.batch([
    binding.prepare(query.sql).bind(...query.params),
    binding
      .prepare(
        `INSERT INTO notifications(id,recipient_id,actor_id,topic_id,reply_id,source_key,kind,created_at)
      SELECT lower(hex(randomblob(16))),p.user_id,${reply ? 'r.author_id' : 't.author_id'},t.id,${reply ? 'r.id' : 'NULL'},?,
        CASE WHEN p.username IN (SELECT value FROM json_each(?)) THEN 'mention' ELSE 'reply' END,?
      FROM ${reply ? 'replies r INNER JOIN topics t ON t.id=r.topic_id' : 'topics t'}
      INNER JOIN nodes n ON n.id=t.node_id CROSS JOIN profiles p
      INNER JOIN user u ON u.id=p.user_id INNER JOIN account_access a ON a.user_id=u.id
      WHERE changes()=1 AND ${reply ? "r.id=? AND r.status='published'" : 't.id=?'} AND t.status='published' AND n.hidden=0
        AND u.email_verified=1 AND a.banned=0 AND p.id!=${reply ? 'r.author_id' : 't.author_id'}
        AND (p.username IN (SELECT value FROM json_each(?)) ${source.replyToAuthor ? 'OR p.id=t.author_id' : ''})
      ON CONFLICT(recipient_id,source_key) DO NOTHING`,
      )
      .bind(`${source.kind}:${source.id}`, names, Date.now(), source.id, names),
  ]);
  return rows[0];
}
const notificationVisibility =
  "t.status='published' AND n.hidden=0 AND (v.reply_id IS NULL OR r.status='published')";
export type NotificationCursor = { createdAt: number; id: string };

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
    async unread(userId: string) {
      return (await binding
        .prepare(
          `SELECT count(*) AS count FROM notifications v INNER JOIN topics t ON t.id=v.topic_id INNER JOIN nodes n ON n.id=t.node_id LEFT JOIN replies r ON r.id=v.reply_id WHERE v.recipient_id=? AND v.read_at IS NULL AND ${notificationVisibility} AND EXISTS(SELECT 1 FROM account_access WHERE user_id=? AND banned=0)`,
        )
        .bind(userId, userId)
        .first<{ count: number }>())!.count;
    },
    async notifications(userId: string, cursor?: NotificationCursor) {
      const result = await binding
        .prepare(
          `SELECT v.id,v.kind,v.created_at AS createdAt,v.read_at AS readAt,t.id AS topicId,t.title,r.id AS replyId,r.floor,p.username,p.display_name AS actor
        FROM notifications v INNER JOIN topics t ON t.id=v.topic_id INNER JOIN nodes n ON n.id=t.node_id INNER JOIN profiles p ON p.id=v.actor_id LEFT JOIN replies r ON r.id=v.reply_id
        WHERE v.recipient_id=? AND ${notificationVisibility} AND EXISTS(SELECT 1 FROM account_access WHERE user_id=? AND banned=0)
        ${cursor ? 'AND (v.created_at<? OR (v.created_at=? AND v.id<?))' : ''} ORDER BY v.created_at DESC,v.id DESC LIMIT 21`,
        )
        .bind(
          userId,
          userId,
          ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []),
        )
        .all<{
          id: string;
          kind: 'mention' | 'reply';
          createdAt: number;
          readAt: number | null;
          topicId: string;
          title: string;
          replyId: string | null;
          floor: number | null;
          username: string;
          actor: string;
        }>();
      const items = result.results.slice(0, 20),
        last = items.at(-1);
      return {
        items,
        nextCursor:
          result.results.length > 20 && last
            ? JSON.stringify({ createdAt: last.createdAt, id: last.id })
            : null,
      };
    },
    async readNotification(userId: string, id: string) {
      return (
        (
          await binding
            .prepare(
              `UPDATE notifications SET read_at=coalesce(read_at,?) WHERE id=? AND recipient_id=? AND EXISTS(SELECT 1 FROM account_access WHERE user_id=? AND banned=0) AND id IN(SELECT v.id FROM notifications v INNER JOIN topics t ON t.id=v.topic_id INNER JOIN nodes n ON n.id=t.node_id LEFT JOIN replies r ON r.id=v.reply_id WHERE v.id=? AND ${notificationVisibility}) RETURNING id`,
            )
            .bind(Date.now(), id, userId, userId, id)
            .all()
        ).results.length === 1
      );
    },
    async editTopic(id: string, authorId: string, input: TopicEditInput) {
      const query = db
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
        .returning({ id: topics.id })
        .toSQL();
      const result = await contentWrite(binding, query, {
        kind: 'topic',
        id,
        body: input.body,
      });
      return result.results[0] ? ('ok' as const) : topicAccess(id, authorId);
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
      await contentWrite(
        binding,
        new SQLiteSyncDialect()
          .sqlToQuery(sql`INSERT INTO replies (id, topic_id, author_id, floor, body, request_id, created_at, updated_at)
        SELECT ${id}, topics.id, ${authorId}, topics.next_reply_floor + 1, ${input.body}, ${input.requestId}, ${now}, ${now}
        FROM topics INNER JOIN nodes ON topics.node_id = nodes.id
        WHERE topics.id = ${topicId} AND topics.status = 'published' AND nodes.hidden = 0 AND ${activeProfile(authorId)}
        ON CONFLICT(author_id, request_id) DO NOTHING`),
        { kind: 'reply', id, body: input.body, replyToAuthor: true },
      );
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
      const query = db
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
        .returning({ id: replies.id })
        .toSQL();
      const result = await contentWrite(binding, query, {
        kind: 'reply',
        id,
        body: input.body,
      });
      return result.results[0] ? ('ok' as const) : replyAccess(id, authorId);
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
