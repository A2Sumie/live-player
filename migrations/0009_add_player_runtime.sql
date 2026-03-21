CREATE TABLE `player_runtime` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_id` integer NOT NULL,
	`name` text,
	`description` text,
	`url` text,
	`cover_url` text,
	`stream_config` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`last_error` text,
	`last_seen_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_runtime_player_id_unique` ON `player_runtime` (`player_id`);
--> statement-breakpoint
CREATE INDEX `player_runtime_status_idx` ON `player_runtime` (`status`);
