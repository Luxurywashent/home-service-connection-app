CREATE TABLE `abandoned_carts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cart_id` varchar(64) NOT NULL,
	`customer_id` varchar(64),
	`source` enum('portal_app','website') NOT NULL,
	`package_id` varchar(64),
	`package_name` varchar(128),
	`vehicle_type` varchar(32),
	`selected_date` varchar(16),
	`estimated_total` decimal(10,2),
	`step_reached` varchar(64),
	`city` varchar(128),
	`customer_email` varchar(320),
	`customer_name` varchar(255),
	`completed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `abandoned_carts_id` PRIMARY KEY(`id`),
	CONSTRAINT `abandoned_carts_cart_id_unique` UNIQUE(`cart_id`)
);
--> statement-breakpoint
CREATE TABLE `customer_activity_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`session_id` varchar(64) NOT NULL,
	`customer_id` varchar(64) NOT NULL,
	`source` enum('portal_app','website') NOT NULL DEFAULT 'portal_app',
	`started_at` timestamp NOT NULL DEFAULT (now()),
	`ended_at` timestamp,
	`duration_seconds` int,
	`last_screen` varchar(128),
	`device_platform` varchar(32),
	`app_version` varchar(32),
	CONSTRAINT `customer_activity_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `customer_activity_sessions_session_id_unique` UNIQUE(`session_id`)
);
--> statement-breakpoint
CREATE TABLE `investor_inquiries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`inquiry_id` varchar(64) NOT NULL,
	`full_name` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`phone` varchar(32),
	`investment_interest` varchar(64),
	`message` text,
	`status` enum('new','contacted','qualified','closed') NOT NULL DEFAULT 'new',
	`admin_notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `investor_inquiries_id` PRIMARY KEY(`id`),
	CONSTRAINT `investor_inquiries_inquiry_id_unique` UNIQUE(`inquiry_id`)
);
--> statement-breakpoint
CREATE TABLE `package_images` (
	`id` int AUTO_INCREMENT NOT NULL,
	`package_id` varchar(64) NOT NULL,
	`image_url` text NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `package_images_id` PRIMARY KEY(`id`),
	CONSTRAINT `package_images_package_id_unique` UNIQUE(`package_id`)
);
--> statement-breakpoint
CREATE TABLE `refund_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`refund_record_id` varchar(64) NOT NULL,
	`job_id` varchar(64),
	`booking_id` varchar(64),
	`payment_intent_id` varchar(128) NOT NULL,
	`stripe_refund_id` varchar(128),
	`amount_cents` int NOT NULL,
	`reason` varchar(64) NOT NULL DEFAULT 'requested_by_customer',
	`admin_note` text,
	`issued_by` varchar(128) NOT NULL,
	`customer_name` varchar(255),
	`customer_email` varchar(255),
	`status` varchar(32) NOT NULL DEFAULT 'succeeded',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `refund_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `refund_records_refund_record_id_unique` UNIQUE(`refund_record_id`)
);
--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `invoice_token` varchar(128);--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `invoice_sent_at` datetime;--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `invoice_paid_at` datetime;--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `invoice_payment_intent_id` varchar(128);