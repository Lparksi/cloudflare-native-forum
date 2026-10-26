CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`reply_id` text,
	`source_key` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`recipient_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reply_id`) REFERENCES `replies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notifications_kind" CHECK("notifications"."kind" IN ('mention','reply')),
	CONSTRAINT "notifications_source" CHECK(("notifications"."reply_id" IS NULL AND "notifications"."source_key"='topic:' || "notifications"."topic_id" AND "notifications"."kind"='mention') OR ("notifications"."reply_id" IS NOT NULL AND "notifications"."source_key"='reply:' || "notifications"."reply_id"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_recipient_source` ON `notifications` (`recipient_id`,`source_key`);--> statement-breakpoint
CREATE INDEX `notifications_recipient_created` ON `notifications` (`recipient_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `topics_hot` ON `topics` (`status`,("vote_count" * 3 + "reply_count"),`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `topics_active` ON `topics` (`status`,(coalesce("last_replied_at","created_at")),`created_at`,`id`);
--> statement-breakpoint
-- Real accounts need a stable public handle before another member can mention them.
INSERT INTO profiles(id,user_id,username,display_name,bio,created_at)
SELECT 'member-' || u.id,u.id,'u_' || u.id,u.name,'',u.created_at FROM user u
WHERE NOT EXISTS(SELECT 1 FROM profiles p WHERE p.user_id=u.id);
--> statement-breakpoint
CREATE TRIGGER user_public_profile AFTER INSERT ON user BEGIN
  INSERT INTO profiles(id,user_id,username,display_name,bio,created_at)
  VALUES ('member-' || NEW.id,NEW.id,'u_' || NEW.id,NEW.name,'',NEW.created_at);
END;
--> statement-breakpoint
