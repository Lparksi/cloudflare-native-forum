-- A local operator inserts the first bootstrap audit. Its role grant is part
-- of this same statement, so an audit failure cannot leave an unaudited admin.
CREATE TRIGGER bootstrap_admin BEFORE INSERT ON moderation_logs WHEN NEW.action = 'bootstrap' BEGIN
  SELECT CASE WHEN NEW.target_kind != 'user' OR NEW.target_id != NEW.actor_id
    OR EXISTS(SELECT 1 FROM account_access WHERE role = 'admin' AND banned = 0)
    OR NOT EXISTS(SELECT 1 FROM account_access a INNER JOIN user u ON u.id=a.user_id
      WHERE a.user_id=NEW.actor_id AND a.role='member' AND a.banned=0 AND u.email_verified=1)
    THEN RAISE(ABORT, 'BOOTSTRAP_NOT_ALLOWED') END;
  UPDATE account_access SET role='admin',revision=revision+1 WHERE user_id=NEW.actor_id;
END;
