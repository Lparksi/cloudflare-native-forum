CREATE TABLE `nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	CONSTRAINT "nodes_hidden_valid" CHECK("nodes"."hidden" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nodes_slug_unique` ON `nodes` (`slug`);--> statement-breakpoint
CREATE INDEX `nodes_visible_sort` ON `nodes` (`hidden`,`sort_order`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_username_unique` ON `profiles` (`username`);--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`node_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`request_id` text NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "topics_status_valid" CHECK("topics"."status" IN ('published', 'hidden', 'deleted')),
	CONSTRAINT "topics_title_length" CHECK(length("topics"."title") BETWEEN 3 AND 120),
	CONSTRAINT "topics_body_length" CHECK(length("topics"."body") BETWEEN 1 AND 20000)
);
--> statement-breakpoint
CREATE INDEX `topics_status_created` ON `topics` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `topics_node_status_created` ON `topics` (`node_id`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `topics_author_request` ON `topics` (`author_id`,`request_id`);