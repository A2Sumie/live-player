CREATE TABLE `system_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`details` text,
	`source` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
