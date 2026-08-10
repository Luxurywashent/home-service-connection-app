ALTER TABLE `employee_progression` ADD `attempt_result` enum('correct','incorrect') NOT NULL;--> statement-breakpoint
ALTER TABLE `quiz_questions` ADD `is_active` enum('yes','no') DEFAULT 'yes' NOT NULL;--> statement-breakpoint
ALTER TABLE `quiz_questions` ADD `expires_at` varchar(32);