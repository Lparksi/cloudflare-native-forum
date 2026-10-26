import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/sqlite-core';

// Public identity only. Authentication tables will be generated from Better Auth in Phase 2.
export const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  bio: text('bio').notNull().default(''),
  createdAt: integer('created_at').notNull(),
});
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
  },
  (t) => [
    index('topics_status_created').on(t.status, t.createdAt, t.id),
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
    check('topics_title_length', sql`length(${t.title}) BETWEEN 3 AND 120`),
    check('topics_body_length', sql`length(${t.body}) BETWEEN 1 AND 20000`),
  ],
);
