CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`object_key` text NOT NULL,
	`kind` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`bytes` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "uploads_valid" CHECK("uploads"."kind" IN ('avatar','image') AND "uploads"."state" IN ('pending','ready','deleted') AND "uploads"."bytes">0 AND "uploads"."width">0 AND "uploads"."height">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uploads_object_key_unique` ON `uploads` (`object_key`);--> statement-breakpoint
CREATE INDEX `uploads_owner_state` ON `uploads` (`owner_id`,`state`);--> statement-breakpoint
ALTER TABLE `profiles` ADD `avatar_id` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `revision` integer DEFAULT 1 NOT NULL;