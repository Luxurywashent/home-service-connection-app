ALTER TABLE `schedule_jobs` ADD `private_notes` text;--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `tags` text;--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `lead_source` varchar(128);--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `tax_amount` decimal(10,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `discount_code` varchar(64);--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `discount_amount` decimal(10,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `additional_vehicles` text;