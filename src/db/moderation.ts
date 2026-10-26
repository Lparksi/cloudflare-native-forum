import type { Role } from '../security/access';
export type Actor = { id: string; role: Role };
export function moderation(db: D1Database) {
  const staff = (id: string, adminOnly = false) =>
    db
      .prepare(
        `SELECT 1 FROM account_access WHERE user_id = ? AND banned = 0 AND role ${adminOnly ? "= 'admin'" : "IN ('admin','moderator')"}`,
      )
      .bind(id);
  // This fragment is always parameterized at each call; it rechecks current DB role at execution.
  const allowed =
    "EXISTS(SELECT 1 FROM account_access actor WHERE actor.user_id = ? AND actor.banned = 0 AND actor.role IN ('admin','moderator'))";
  const admin =
    "EXISTS(SELECT 1 FROM account_access actor WHERE actor.user_id = ? AND actor.banned = 0 AND actor.role = 'admin')";
  async function audited(
    statement: D1PreparedStatement,
    actor: string,
    action: string,
    kind: string,
    target: string,
    reason: string,
  ) {
    const rows = await db.batch([
      statement,
      db
        .prepare(
          `INSERT INTO moderation_logs(id,actor_id,action,target_kind,target_id,reason,created_at)
      SELECT ?,?,?,?,?,?,? WHERE changes() = 1`,
        )
        .bind(
          crypto.randomUUID(),
          actor,
          action,
          kind,
          target,
          reason,
          Date.now(),
        ),
    ]);
    return rows[0].results.length > 0;
  }
  return {
    async isStaff(id: string, adminOnly = false) {
      return !!(await staff(id, adminOnly).first());
    },
    async users(actorId: string, after = '') {
      return (
        await db
          .prepare(
            `SELECT u.id,u.name,a.role,a.banned,a.ban_reason AS banReason,a.revision FROM user u INNER JOIN account_access a ON a.user_id=u.id
        WHERE u.id > ? AND ${allowed} ORDER BY u.id LIMIT 31`,
          )
          .bind(after, actorId)
          .all()
      ).results;
    },
    async contents(actorId: string, kind: 'topics' | 'replies', after = '') {
      const rows = await db
        .prepare(
          `SELECT c.id,c.status,c.revision,c.author_id AS authorId,${kind === 'topics' ? 'c.title' : "'回复 #' || c.floor"} AS title,c.body,c.created_at AS createdAt FROM ${kind} c
        WHERE c.id > ? AND ${allowed} ORDER BY c.id LIMIT 31`,
        )
        .bind(after, actorId)
        .all();
      return rows.results;
    },
    async nodes(actorId: string, after = '') {
      return (
        await db
          .prepare(
            `SELECT * FROM nodes WHERE id > ? AND ${allowed} ORDER BY id LIMIT 31`,
          )
          .bind(after, actorId)
          .all()
      ).results;
    },
    async reports(actorId: string, after = '') {
      return (
        await db
          .prepare(
            `SELECT * FROM reports WHERE id > ? AND ${allowed} ORDER BY id LIMIT 31`,
          )
          .bind(after, actorId)
          .all()
      ).results;
    },
    async logs(actorId: string, after = '') {
      return (
        await db
          .prepare(
            `SELECT * FROM moderation_logs WHERE id > ? AND ${allowed} ORDER BY id LIMIT 31`,
          )
          .bind(after, actorId)
          .all()
      ).results;
    },
    async role(
      actorId: string,
      targetId: string,
      role: Role,
      revision: number,
      reason: string,
    ) {
      return audited(
        db
          .prepare(
            `UPDATE account_access SET role = ?,revision = revision + 1 WHERE user_id = ? AND user_id != ? AND revision = ? AND banned = 0
        AND ${admin} AND EXISTS(SELECT 1 FROM user WHERE id=account_access.user_id AND email_verified=1)
        AND NOT(role='admin' AND ?!='admin' AND (SELECT count(*) FROM account_access WHERE role='admin' AND banned=0)<=1) RETURNING user_id`,
          )
          .bind(role, targetId, actorId, revision, actorId, role),
        actorId,
        'set-role',
        'user',
        targetId,
        reason,
      );
    },
    async ban(
      actorId: string,
      targetId: string,
      banned: boolean,
      revision: number,
      reason: string,
    ) {
      return audited(
        db
          .prepare(
            `UPDATE account_access SET banned = ?,ban_reason = ?,revision = revision + 1
        WHERE user_id = ? AND user_id != ? AND revision = ? AND banned != ? AND role != 'admin' AND ${allowed}
        AND (role='member' OR ${admin}) RETURNING user_id`,
          )
          .bind(
            banned ? 1 : 0,
            banned ? reason : null,
            targetId,
            actorId,
            revision,
            banned ? 1 : 0,
            actorId,
            actorId,
          ),
        actorId,
        banned ? 'ban' : 'unban',
        'user',
        targetId,
        reason,
      );
    },
    async visibility(
      actorId: string,
      kind: 'topics' | 'replies',
      id: string,
      hidden: boolean,
      revision: number,
      reason: string,
    ) {
      return audited(
        db
          .prepare(
            `UPDATE ${kind} SET status = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND status = ? AND ${allowed} RETURNING id`,
          )
          .bind(
            hidden ? 'hidden' : 'published',
            Date.now(),
            id,
            revision,
            hidden ? 'published' : 'hidden',
            actorId,
          ),
        actorId,
        hidden ? 'hide' : 'restore',
        kind,
        id,
        reason,
      );
    },
    async resolve(
      actorId: string,
      id: string,
      status: 'resolved' | 'dismissed',
      revision: number,
      reason: string,
    ) {
      return audited(
        db
          .prepare(
            `UPDATE reports SET status = ?,resolution = ?,resolved_by = ?,revision = revision + 1 WHERE id = ? AND revision = ? AND status='open' AND ${allowed} RETURNING id`,
          )
          .bind(status, reason, actorId, id, revision, actorId),
        actorId,
        status,
        'report',
        id,
        reason,
      );
    },
    async saveNode(
      actorId: string,
      id: string,
      node: {
        slug: string;
        name: string;
        description: string;
        sortOrder: number;
        hidden: boolean;
      },
      reason: string,
      create: boolean,
    ) {
      const statement = create
        ? db
            .prepare(
              `INSERT INTO nodes(id,slug,name,description,sort_order,hidden) SELECT ?,?,?,?,?,? WHERE ${admin} RETURNING id`,
            )
            .bind(
              id,
              node.slug,
              node.name,
              node.description,
              node.sortOrder,
              node.hidden ? 1 : 0,
              actorId,
            )
        : db
            .prepare(
              `UPDATE nodes SET slug=?,name=?,description=?,sort_order=?,hidden=? WHERE id=? AND ${admin} RETURNING id`,
            )
            .bind(
              node.slug,
              node.name,
              node.description,
              node.sortOrder,
              node.hidden ? 1 : 0,
              id,
              actorId,
            );
      return audited(
        statement,
        actorId,
        create ? 'create-node' : 'edit-node',
        'node',
        id,
        reason,
      );
    },
    async report(
      reporterId: string,
      kind: 'topic' | 'reply',
      targetId: string,
      reason: string,
    ) {
      const topic = kind === 'topic';
      const result = await db
        .prepare(
          `INSERT INTO reports(id,reporter_id,topic_id,reply_id,reason,created_at)
        SELECT ?,?,${topic ? 't.id,NULL' : 'NULL,r.id'},?,? FROM ${topic ? 'topics t' : 'replies r INNER JOIN topics t ON r.topic_id=t.id'} INNER JOIN nodes n ON n.id=t.node_id
        WHERE ${topic ? 't.id' : 'r.id'}=? AND t.status='published' AND n.hidden=0 ${topic ? '' : "AND r.status='published'"}
        AND EXISTS(SELECT 1 FROM account_access WHERE user_id=? AND banned=0) ON CONFLICT DO NOTHING RETURNING id`,
        )
        .bind(
          crypto.randomUUID(),
          reporterId,
          reason,
          Date.now(),
          targetId,
          reporterId,
        )
        .all();
      return result.results.length > 0;
    },
  };
}
