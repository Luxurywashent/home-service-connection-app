CREATE TABLE `job_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`booking_ref` varchar(100) NOT NULL,
	`sender_type` varchar(20) NOT NULL,
	`sender_id` varchar(100) NOT NULL,
	`sender_name` varchar(100),
	`message` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`read_at` timestamp,
	CONSTRAINT `job_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tip_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`token` varchar(64) NOT NULL,
	`job_id` varchar(64) NOT NULL,
	`customer_name` varchar(255) NOT NULL,
	`customer_email` varchar(320) NOT NULL,
	`detailer_name` varchar(255),
	`service_title` varchar(255),
	`service_total` decimal(10,2) NOT NULL,
	`stripe_customer_id` varchar(128) NOT NULL,
	`stripe_payment_method_id` varchar(128) NOT NULL,
	`card_last4` varchar(4),
	`card_brand` varchar(32),
	`tip_amount_cents` int,
	`tip_payment_intent_id` varchar(128),
	`status` enum('pending','completed','skipped','expired') NOT NULL DEFAULT 'pending',
	`expires_at` timestamp NOT NULL,
	`created_at_tr` timestamp NOT NULL DEFAULT (now()),
	`completed_at_tr` timestamp,
	CONSTRAINT `tip_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `tip_requests_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
ALTER TABLE `job_events` MODIFY COLUMN `event_type` enum('created','cancelled','rescheduled','reassigned') NOT NULL;