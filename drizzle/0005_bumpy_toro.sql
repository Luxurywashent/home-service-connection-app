CREATE TABLE `challenges` (
	`id` int AUTO_INCREMENT NOT NULL,
	`challenge_id` varchar(64) NOT NULL,
	`title` varchar(512) NOT NULL,
	`prize_name` varchar(255),
	`prize_emoji` varchar(32),
	`is_active` enum('yes','no') NOT NULL DEFAULT 'yes',
	`expires_at` varchar(32),
	`created_by` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `challenges_id` PRIMARY KEY(`id`),
	CONSTRAINT `challenges_challenge_id_unique` UNIQUE(`challenge_id`)
);
--> statement-breakpoint
ALTER TABLE `quiz_questions` ADD `challenge_id` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `quiz_questions` DROP COLUMN `is_active`;--> statement-breakpoint
ALTER TABLE `quiz_questions` DROP COLUMN `expires_at`;--> statement-breakpoint
ALTER TABLE `quiz_questions` DROP COLUMN `created_by`;