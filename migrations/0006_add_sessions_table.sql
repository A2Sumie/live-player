CREATE TABLE IF NOT EXISTS `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`last_seen` integer NOT NULL,
	`user_agent` text,
	`ip` text
);
