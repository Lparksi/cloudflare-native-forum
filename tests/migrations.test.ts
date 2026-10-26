import { expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
it('adds Phase 3 without rebuilding or losing existing topics and author relationships', async () => {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-07-30',
    d1Databases: ['DB'],
  });
  try {
    const db = await mf.getD1Database('DB');
    const files = readdirSync('db/migrations')
      .filter((file) => file.endsWith('.sql'))
      .sort();
    for (const file of files) {
      if (file.startsWith('0002')) {
        await db
          .prepare(
            "INSERT INTO profiles(id,username,display_name,created_at) VALUES ('old-author','old-name','旧作者',1)",
          )
          .run();
        await db
          .prepare(
            "INSERT INTO nodes(id,slug,name,description) VALUES ('old-node','old-node','旧节点','旧节点')",
          )
          .run();
        await db
          .prepare(
            "INSERT INTO topics(id,author_id,node_id,title,body,created_at,updated_at,request_id) VALUES ('old-topic','old-author','old-node','旧主题标题','旧主题正文',1,1,'old-request')",
          )
          .run();
      }
      const source = readFileSync(`db/migrations/${file}`, 'utf8');
      if (file.startsWith('0002'))
        expect(source).not.toMatch(/DROP TABLE|foreign_keys\s*=\s*OFF/i);
      for (const statement of source.split('--> statement-breakpoint'))
        if (statement.trim()) await db.prepare(statement).run();
    }
    expect(
      await db
        .prepare(
          'SELECT author_id,title,body,revision,reply_count,vote_count,next_reply_floor FROM topics WHERE id = ?',
        )
        .bind('old-topic')
        .first(),
    ).toEqual({
      author_id: 'old-author',
      title: '旧主题标题',
      body: '旧主题正文',
      revision: 1,
      reply_count: 0,
      vote_count: 0,
      next_reply_floor: 0,
    });
    expect(
      (await db.prepare('PRAGMA foreign_key_check').all()).results,
    ).toEqual([]);
  } finally {
    await mf.dispose();
  }
});
