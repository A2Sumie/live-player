ALTER TABLE `schedules` ADD `external_key` text;
CREATE UNIQUE INDEX `schedules_external_key_unique` ON `schedules` (`external_key`);
