ALTER TABLE `online_bookings` MODIFY COLUMN `start_hour` decimal(4,1);--> statement-breakpoint
ALTER TABLE `online_bookings` MODIFY COLUMN `end_hour` decimal(4,1);--> statement-breakpoint
ALTER TABLE `schedule_jobs` MODIFY COLUMN `start_hour` decimal(4,1);--> statement-breakpoint
ALTER TABLE `schedule_jobs` MODIFY COLUMN `end_hour` decimal(4,1);--> statement-breakpoint
ALTER TABLE `employees` ADD `shift_start_hour` decimal(4,1) DEFAULT '8.0';--> statement-breakpoint
ALTER TABLE `employees` ADD `shift_end_hour` decimal(4,1) DEFAULT '17.0';--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `finished_at` datetime;