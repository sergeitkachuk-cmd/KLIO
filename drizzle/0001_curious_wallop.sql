CREATE TABLE `materials` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`brand_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'Сохранено' NOT NULL,
	`payload_json` text NOT NULL,
	`group_id` text NOT NULL,
	`version_number` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `materials_owner_created_idx` ON `materials` (`owner_email`,`created_at`);--> statement-breakpoint
CREATE INDEX `materials_brand_created_idx` ON `materials` (`brand_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `materials_group_version_idx` ON `materials` (`group_id`,`version_number`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `research_used` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `editor_actions_used` integer DEFAULT 0 NOT NULL;