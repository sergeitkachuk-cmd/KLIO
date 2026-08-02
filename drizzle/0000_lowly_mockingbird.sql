CREATE TABLE `accounts` (
	`email` text PRIMARY KEY NOT NULL,
	`display_name` text DEFAULT 'Пользователь' NOT NULL,
	`plan_id` text DEFAULT 'start' NOT NULL,
	`generation_month` text NOT NULL,
	`generations_used` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `brands` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`name` text NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`profile_json` text NOT NULL,
	`workspace_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `brands_owner_updated_idx` ON `brands` (`owner_email`,`updated_at`);--> statement-breakpoint
CREATE TABLE `generations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`brand_id` text,
	`format` text NOT NULL,
	`topic` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`meta_title` text DEFAULT '' NOT NULL,
	`meta_description` text DEFAULT '' NOT NULL,
	`editorial_comment` text DEFAULT '' NOT NULL,
	`keywords` text DEFAULT '' NOT NULL,
	`tone` text DEFAULT '' NOT NULL,
	`target_length` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `generations_owner_created_idx` ON `generations` (`owner_email`,`created_at`);--> statement-breakpoint
CREATE INDEX `generations_brand_created_idx` ON `generations` (`brand_id`,`created_at`);