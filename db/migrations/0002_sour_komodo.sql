CREATE TABLE `bookmarks` (
	`topic_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `topic_id`),
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bookmarks_topic` ON `bookmarks` (`topic_id`);--> statement-breakpoint
CREATE TABLE `replies` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`author_id` text NOT NULL,
	`floor` integer NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`request_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "replies_body_length" CHECK(length("replies"."body") BETWEEN 1 AND 20000),
	CONSTRAINT "replies_status_valid" CHECK("replies"."status" IN ('published', 'hidden', 'deleted')),
	CONSTRAINT "replies_numbers_valid" CHECK("replies"."floor" > 0 AND "replies"."revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `replies_topic_floor` ON `replies` (`topic_id`,`floor`);--> statement-breakpoint
CREATE UNIQUE INDEX `replies_author_request` ON `replies` (`author_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `replies_topic_status_created` ON `replies` (`topic_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `topic_votes` (
	`topic_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`topic_id`, `profile_id`),
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- Keep existing topics, foreign keys and indexes in place; additive migration only.
ALTER TABLE topics ADD COLUMN revision integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE topics ADD COLUMN reply_count integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE topics ADD COLUMN next_reply_floor integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE topics ADD COLUMN last_replied_at integer;
--> statement-breakpoint
ALTER TABLE topics ADD COLUMN vote_count integer NOT NULL DEFAULT 0
  CONSTRAINT topics_counters_valid CHECK(reply_count >= 0 AND next_reply_floor >= reply_count AND vote_count >= 0 AND revision > 0);
--> statement-breakpoint
-- Floor allocation and counters commit in the same SQLite statement as the reply.
CREATE TRIGGER replies_insert AFTER INSERT ON replies BEGIN
  UPDATE topics SET next_reply_floor = MAX(next_reply_floor, NEW.floor),
    reply_count = reply_count + CASE WHEN NEW.status = 'published' THEN 1 ELSE 0 END,
    last_replied_at = CASE WHEN NEW.status = 'published' THEN MAX(COALESCE(last_replied_at, 0), NEW.created_at) ELSE last_replied_at END
  WHERE id = NEW.topic_id;
END;
--> statement-breakpoint
CREATE TRIGGER replies_status AFTER UPDATE OF status ON replies WHEN OLD.status != NEW.status BEGIN
  UPDATE topics SET reply_count = reply_count + CASE WHEN NEW.status = 'published' THEN 1 ELSE 0 END - CASE WHEN OLD.status = 'published' THEN 1 ELSE 0 END,
    last_replied_at = (SELECT MAX(created_at) FROM replies WHERE topic_id = NEW.topic_id AND status = 'published')
  WHERE id = NEW.topic_id;
END;
--> statement-breakpoint
CREATE TRIGGER replies_delete AFTER DELETE ON replies BEGIN
  UPDATE topics SET reply_count = reply_count - CASE WHEN OLD.status = 'published' THEN 1 ELSE 0 END,
    last_replied_at = (SELECT MAX(created_at) FROM replies WHERE topic_id = OLD.topic_id AND status = 'published')
  WHERE id = OLD.topic_id;
END;
--> statement-breakpoint
CREATE TRIGGER topic_votes_insert AFTER INSERT ON topic_votes BEGIN
  UPDATE topics SET vote_count = vote_count + 1 WHERE id = NEW.topic_id;
END;
--> statement-breakpoint
CREATE TRIGGER topic_votes_delete AFTER DELETE ON topic_votes BEGIN
  UPDATE topics SET vote_count = vote_count - 1 WHERE id = OLD.topic_id;
END;
