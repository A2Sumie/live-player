-- Migration: Add schedules table for workflow automation
-- Created: 2026-01-27

CREATE TABLE `schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`schedule_type` text NOT NULL,
	`execution_time` text NOT NULL,
	`recurrence` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload` text,
	`created_by` text,
	`executed_at` text,
	`result` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
-->statement-breakpoint
CREATE INDEX `schedules_execution_time_idx` ON `schedules` (`execution_time`);
-->statement-breakpoint
CREATE INDEX `schedules_status_idx` ON `schedules` (`status`);
-->statement-breakpoint
CREATE INDEX `schedules_type_idx` ON `schedules` (`schedule_type`);
