ALTER TABLE `email_logs` ADD `body` text;--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `recurrence_rule` text;--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `recurrence_parent_id` varchar(64);