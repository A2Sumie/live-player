ALTER TABLE `realtime_text_segments` ADD COLUMN `event_created_at` text;
ALTER TABLE `realtime_text_segments` ADD COLUMN `received_at` text;
ALTER TABLE `realtime_text_segments` ADD COLUMN `asr_latency_ms` integer;
ALTER TABLE `realtime_text_segments` ADD COLUMN `event_sequence` integer;
