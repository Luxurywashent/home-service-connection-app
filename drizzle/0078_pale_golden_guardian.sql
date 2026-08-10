CREATE TABLE `email_queue` (
	`id` int AUTO_INCREMENT NOT NULL,
	`queue_id` varchar(64) NOT NULL,
	`to` varchar(255) NOT NULL,
	`subject` varchar(500) NOT NULL,
	`html` text NOT NULL,
	`text_body` text,
	`type` enum('booking_confirmation','notification','other') NOT NULL DEFAULT 'other',
	`customer_name` varchar(255),
	`booking_ref` varchar(64),
	`status` enum('pending','sent','failed') NOT NULL DEFAULT 'pending',
	`send_after` datetime NOT NULL,
	`sent_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_queue_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_queue_queue_id_unique` UNIQUE(`queue_id`)
);
--> statement-breakpoint
ALTER TABLE `customers` ADD `city` varchar(128);--> statement-breakpoint
ALTER TABLE `expense_submissions` ADD `city_id_exp` varchar(64);