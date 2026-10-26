CREATE TABLE `account_access` (
	`user_id` text PRIMARY KEY NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`banned` integer DEFAULT false NOT NULL,
	`ban_reason` text,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_access_valid" CHECK("account_access"."role" IN ('member','moderator','admin') AND "account_access"."banned" IN (0,1) AND "account_access"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE `local_challenges` (
	`token` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`ip` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `local_challenges_expiry` ON `local_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `moderation_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `moderation_logs_created` ON `moderation_logs` (`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_id` text NOT NULL,
	`topic_id` text,
	`reply_id` text,
	`reason` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_by` text,
	`resolution` text,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reply_id`) REFERENCES `replies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reports_target" CHECK(("reports"."topic_id" IS NOT NULL) != ("reports"."reply_id" IS NOT NULL)),
	CONSTRAINT "reports_status" CHECK("reports"."status" IN ('open','resolved','dismissed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reports_open_topic` ON `reports` (`reporter_id`,`topic_id`) WHERE "reports"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX `reports_open_reply` ON `reports` (`reporter_id`,`reply_id`) WHERE "reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX `reports_status_created` ON `reports` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `write_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `write_limits_expiry` ON `write_limits` (`expires_at`);--> statement-breakpoint
INSERT INTO account_access(user_id) SELECT id FROM user;
--> statement-breakpoint
CREATE TRIGGER account_access_create AFTER INSERT ON user BEGIN
  INSERT INTO account_access(user_id) VALUES (NEW.id);
END;
--> statement-breakpoint
CREATE TRIGGER account_ban_sessions AFTER UPDATE OF banned ON account_access WHEN NEW.banned = 1 BEGIN
  DELETE FROM session WHERE user_id = NEW.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER session_ban_guard BEFORE INSERT ON session
WHEN NOT EXISTS(SELECT 1 FROM account_access WHERE user_id = NEW.user_id AND banned = 0) BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_BANNED');
END;
--> statement-breakpoint
CREATE TRIGGER last_admin_guard BEFORE UPDATE OF role,banned ON account_access
WHEN OLD.role = 'admin' AND OLD.banned = 0 AND (NEW.role != 'admin' OR NEW.banned = 1)
AND NOT EXISTS(SELECT 1 FROM account_access WHERE user_id != OLD.user_id AND role = 'admin' AND banned = 0) BEGIN
  SELECT RAISE(ABORT, 'LAST_ADMIN');
END;
