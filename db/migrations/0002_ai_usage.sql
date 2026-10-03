CREATE TABLE `ai_usage` (
	`day` text PRIMARY KEY NOT NULL,
	`scans` integer DEFAULT 0 NOT NULL,
	`ai_calls` integer DEFAULT 0 NOT NULL
);
