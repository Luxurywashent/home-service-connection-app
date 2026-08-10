CREATE TABLE `expense_submissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`expense_id` varchar(64) NOT NULL,
	`employee_id_exp` varchar(64) NOT NULL,
	`full_name_exp` varchar(255) NOT NULL,
	`amount_exp` decimal(10,2) NOT NULL,
	`category_exp` enum('fuel','supplies','equipment','car_wash','food','other') NOT NULL DEFAULT 'other',
	`note_exp` text,
	`receipt_url_exp` varchar(1024),
	`job_id_exp` varchar(64),
	`status_exp` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`admin_note_exp` text,
	`reviewed_by_exp` varchar(255),
	`reviewed_at_exp` timestamp,
	`submitted_at_exp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `expense_submissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `expense_submissions_expense_id_unique` UNIQUE(`expense_id`)
);
--> statement-breakpoint
ALTER TABLE `customer_bookings` ADD `discount_code` varchar(64);--> statement-breakpoint
ALTER TABLE `customer_bookings` ADD `discount_amount` decimal(10,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `customer_bookings` ADD `deposit_amount` decimal(10,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `customer_bookings` ADD `deposit_payment_intent_id` varchar(128);--> statement-breakpoint
ALTER TABLE `training_steps` ADD `video_url` varchar(512);