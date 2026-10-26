import { expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
it('adds discussion and moderation migrations without losing existing content or auth sessions', async () => {
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
      if (file.startsWith('0003')) {
        await db
          .prepare(
            "INSERT INTO user(id,name,email,email_verified) VALUES ('existing-user','Existing','existing@example.com',1)",
          )
          .run();
        await db
          .prepare(
            "INSERT INTO session(id,token,user_id,expires_at,updated_at) VALUES ('existing-session','existing-token','existing-user',9999999999999,1)",
          )
          .run();
      }
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
      if (/^000[234567]/.test(file))
        expect(source).not.toMatch(/DROP TABLE|foreign_keys\s*=\s*OFF/i);
      for (const statement of source.split('--> statement-breakpoint'))
        if (statement.trim()) await db.prepare(statement).run();
    }
    expect(
      await db
        .prepare(
          'SELECT role,banned,revision FROM account_access WHERE user_id=?',
        )
        .bind('existing-user')
        .first(),
    ).toEqual({ role: 'member', banned: 0, revision: 1 });
    expect(
      await db
        .prepare('SELECT token FROM session WHERE id=?')
        .bind('existing-session')
        .first(),
    ).toEqual({ token: 'existing-token' });
    expect(
      await db
        .prepare('SELECT avatar_id,revision,bio FROM profiles WHERE id=?')
        .bind('old-author')
        .first(),
    ).toEqual({ avatar_id: null, revision: 1, bio: '' });
    expect(
      await db
        .prepare('SELECT username,display_name FROM profiles WHERE user_id=?')
        .bind('existing-user')
        .first(),
    ).toEqual({ username: 'u_existing-user', display_name: 'Existing' });
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
