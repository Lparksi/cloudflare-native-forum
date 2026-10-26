import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
  primaryKey,
} from 'drizzle-orm/sqlite-core';

import { user } from './auth-schema';
export * from './auth-schema';

// Nullable for pre-auth legacy authors; new members link to their auth identity.
export const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .unique()
    .references(() => user.id),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  bio: text('bio').notNull().default(''),
  avatarId: text('avatar_id'),
  revision: integer('revision').notNull().default(1),
  createdAt: integer('created_at').notNull(),
});
export const uploads = sqliteTable(
  'uploads',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => profiles.id),
    key: text('object_key').notNull().unique(),
    kind: text('kind', { enum: ['avatar', 'image'] }).notNull(),
    state: text('state', { enum: ['pending', 'ready', 'deleted'] })
      .notNull()
      .default('pending'),
    bytes: integer('bytes').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('uploads_owner_state').on(t.ownerId, t.state),
    check(
      'uploads_valid',
      sql`${t.kind} IN ('avatar','image') AND ${t.state} IN ('pending','ready','deleted') AND ${t.bytes}>0 AND ${t.width}>0 AND ${t.height}>0`,
    ),
  ],
);
export const nodes = sqliteTable(
  'nodes',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    index('nodes_visible_sort').on(t.hidden, t.sortOrder),
    check('nodes_hidden_valid', sql`${t.hidden} IN (0, 1)`),
  ],
);
export const topics = sqliteTable(
  'topics',
  {
    id: text('id').primaryKey(),
    authorId: text('author_id')
      .notNull()
      .references(() => profiles.id),
    nodeId: text('node_id')
      .notNull()
      .references(() => nodes.id),
    title: text('title').notNull(),
    body: text('body').notNull(),
    status: text('status', { enum: ['published', 'hidden', 'deleted'] })
      .notNull()
      .default('published'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    requestId: text('request_id').notNull(),
    revision: integer('revision').notNull().default(1),
    replyCount: integer('reply_count').notNull().default(0),
    nextReplyFloor: integer('next_reply_floor').notNull().default(0),
    lastRepliedAt: integer('last_replied_at'),
    voteCount: integer('vote_count').notNull().default(0),
  },
  (t) => [
    index('topics_status_created').on(t.status, t.createdAt, t.id),
    index('topics_author_status_created').on(
      t.authorId,
      t.status,
      t.createdAt,
      t.id,
    ),
    index('topics_node_status_created').on(
      t.nodeId,
      t.status,
      t.createdAt,
      t.id,
    ),
    uniqueIndex('topics_author_request').on(t.authorId, t.requestId),
    check(
      'topics_status_valid',
      sql`${t.status} IN ('published', 'hidden', 'deleted')`,
    ),
    check(
      'topics_counters_valid',
      sql`${t.replyCount} >= 0 AND ${t.nextReplyFloor} >= ${t.replyCount} AND ${t.voteCount} >= 0 AND ${t.revision} > 0`,
    ),
    check('topics_title_length', sql`length(${t.title}) BETWEEN 3 AND 120`),
    check('topics_body_length', sql`length(${t.body}) BETWEEN 1 AND 20000`),
  ],
);

// Tokens in this table are exclusively for the loopback-only development mailbox.
export const devMail = sqliteTable(
  'dev_mail',
  {
    id: text('id').primaryKey(),
    to: text('recipient').notNull(),
    kind: text('kind', { enum: ['verification', 'reset'] }).notNull(),
    url: text('url').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [
    index('dev_mail_expiry').on(t.expiresAt),
    index('dev_mail_recipient_created').on(t.to, t.createdAt),
  ],
);

export const replies = sqliteTable(
  'replies',
  {
    id: text('id').primaryKey(),
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id),
    authorId: text('author_id')
      .notNull()
      .references(() => profiles.id),
    floor: integer('floor').notNull(),
    body: text('body').notNull(),
    status: text('status', { enum: ['published', 'hidden', 'deleted'] })
      .notNull()
      .default('published'),
    requestId: text('request_id').notNull(),
    revision: integer('revision').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('replies_topic_floor').on(t.topicId, t.floor),
    uniqueIndex('replies_author_request').on(t.authorId, t.requestId),
    index('replies_topic_status_created').on(t.topicId, t.status, t.createdAt),
    check('replies_body_length', sql`length(${t.body}) BETWEEN 1 AND 20000`),
    check(
      'replies_status_valid',
      sql`${t.status} IN ('published', 'hidden', 'deleted')`,
    ),
    check('replies_numbers_valid', sql`${t.floor} > 0 AND ${t.revision} > 0`),
  ],
);
export const topicVotes = sqliteTable(
  'topic_votes',
  {
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.topicId, t.profileId] })],
);
export const bookmarks = sqliteTable(
  'bookmarks',
  {
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.topicId] }),
    index('bookmarks_topic').on(t.topicId),
  ],
);

export const accountAccess = sqliteTable(
  'account_access',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id),
    role: text('role', { enum: ['member', 'moderator', 'admin'] })
      .notNull()
      .default('member'),
    banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
    banReason: text('ban_reason'),
    revision: integer('revision').notNull().default(1),
  },
  (t) => [
    check(
      'account_access_valid',
      sql`${t.role} IN ('member','moderator','admin') AND ${t.banned} IN (0,1) AND ${t.revision} > 0`,
    ),
  ],
);
export const reports = sqliteTable(
  'reports',
  {
    id: text('id').primaryKey(),
    reporterId: text('reporter_id')
      .notNull()
      .references(() => user.id),
    topicId: text('topic_id').references(() => topics.id),
    replyId: text('reply_id').references(() => replies.id),
    reason: text('reason').notNull(),
    status: text('status', { enum: ['open', 'resolved', 'dismissed'] })
      .notNull()
      .default('open'),
    createdAt: integer('created_at').notNull(),
    resolvedBy: text('resolved_by').references(() => user.id),
    resolution: text('resolution'),
    revision: integer('revision').notNull().default(1),
  },
  (t) => [
    check(
      'reports_target',
      sql`(${t.topicId} IS NOT NULL) != (${t.replyId} IS NOT NULL)`,
    ),
    check(
      'reports_status',
      sql`${t.status} IN ('open','resolved','dismissed')`,
    ),
    uniqueIndex('reports_open_topic')
      .on(t.reporterId, t.topicId)
      .where(sql`${t.status} = 'open'`),
    uniqueIndex('reports_open_reply')
      .on(t.reporterId, t.replyId)
      .where(sql`${t.status} = 'open'`),
    index('reports_status_created').on(t.status, t.createdAt, t.id),
  ],
);
export const moderationLogs = sqliteTable(
  'moderation_logs',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id')
      .notNull()
      .references(() => user.id),
    action: text('action').notNull(),
    targetKind: text('target_kind').notNull(),
    targetId: text('target_id').notNull(),
    reason: text('reason').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('moderation_logs_created').on(t.createdAt, t.id)],
);
export const writeLimits = sqliteTable(
  'write_limits',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('write_limits_expiry').on(t.expiresAt)],
);
export const localChallenges = sqliteTable(
  'local_challenges',
  {
    token: text('token').primaryKey(),
    action: text('action').notNull(),
    ip: text('ip').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('local_challenges_expiry').on(t.expiresAt)],
);
