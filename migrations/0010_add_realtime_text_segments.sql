CREATE TABLE `realtime_text_segments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `p_id` text NOT NULL,
  `stream_id` text NOT NULL,
  `segment_id` text NOT NULL,
  `start_ms` integer DEFAULT 0 NOT NULL,
  `end_ms` integer,
  `source_text` text,
  `translated_text` text,
  `language` text,
  `is_final` integer DEFAULT false NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX `realtime_text_segments_segment_id_unique` ON `realtime_text_segments` (`segment_id`);
CREATE INDEX `realtime_text_segments_pid_updated_idx` ON `realtime_text_segments` (`p_id`, `updated_at`);
