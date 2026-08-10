CREATE TABLE `ai_knowledge_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entry_id` varchar(64) NOT NULL,
	`category` varchar(64) NOT NULL,
	`title` varchar(255) NOT NULL,
	`content` text NOT NULL,
	`is_active` tinyint NOT NULL DEFAULT 1,
	`order_index` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ai_knowledge_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_knowledge_entries_entry_id_unique` UNIQUE(`entry_id`)
);
--> statement-breakpoint
CREATE TABLE `call_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`line_id` int,
	`twilio_call_sid` varchar(100),
	`direction` varchar(10) NOT NULL,
	`from_number` varchar(20) NOT NULL,
	`to_number` varchar(20) NOT NULL,
	`status` varchar(30),
	`duration_seconds` int DEFAULT 0,
	`answered_by_employee_id` varchar(50),
	`recording_url` text,
	`ai_handled` tinyint DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `call_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_payment_methods` (
	`id` int AUTO_INCREMENT NOT NULL,
	`method_id` varchar(64) NOT NULL,
	`customer_key` varchar(255) NOT NULL,
	`customer_name` varchar(255) NOT NULL,
	`customer_phone` varchar(32),
	`customer_email` varchar(320),
	`stripe_customer_id` varchar(64) NOT NULL,
	`stripe_payment_method_id` varchar(64) NOT NULL,
	`card_brand` varchar(32),
	`card_last4` varchar(4),
	`card_exp_month` int,
	`card_exp_year` int,
	`is_default` tinyint DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_payment_methods_id` PRIMARY KEY(`id`),
	CONSTRAINT `customer_payment_methods_method_id_unique` UNIQUE(`method_id`)
);
--> statement-breakpoint
CREATE TABLE `detailer_points` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`current_points` decimal(5,1) NOT NULL DEFAULT '10.0',
	`week_start_date` varchar(16) NOT NULL,
	`bonus_eligible` tinyint NOT NULL DEFAULT 1,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `detailer_points_id` PRIMARY KEY(`id`),
	CONSTRAINT `detailer_points_employee_id_unique` UNIQUE(`employee_id`)
);
--> statement-breakpoint
CREATE TABLE `do_not_service_list` (
	`id` int AUTO_INCREMENT NOT NULL,
	`customer_key` varchar(255) NOT NULL,
	`full_name` varchar(255),
	`phone` varchar(32),
	`email` varchar(320),
	`reason` text,
	`added_by` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `do_not_service_list_id` PRIMARY KEY(`id`),
	CONSTRAINT `do_not_service_list_customer_key_unique` UNIQUE(`customer_key`)
);
--> statement-breakpoint
CREATE TABLE `phone_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`line_name` varchar(100) NOT NULL,
	`phone_number` varchar(20) NOT NULL,
	`twilio_sid` varchar(100),
	`color` varchar(20) DEFAULT '#0a7ea4',
	`ai_receptionist_enabled` tinyint DEFAULT 0,
	`forward_to_employees` tinyint DEFAULT 1,
	`is_active` tinyint DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `phone_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `phone_lines_phone_number_unique` UNIQUE(`phone_number`)
);
--> statement-breakpoint
CREATE TABLE `point_violations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`violation_id` varchar(64) NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`employee_name` varchar(255),
	`violation_type` enum('missed_morning_meeting','no_before_after_photos','no_late_arrival_notice','vehicle_damage','qc_issue','forgot_clock_in_out','other') NOT NULL,
	`points_deducted` decimal(4,1) NOT NULL,
	`notes` text,
	`week_start_date` varchar(16) NOT NULL,
	`issued_by` varchar(255) NOT NULL,
	`issued_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `point_violations_id` PRIMARY KEY(`id`),
	CONSTRAINT `point_violations_violation_id_unique` UNIQUE(`violation_id`)
);
--> statement-breakpoint
CREATE TABLE `sms_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`line_id` int NOT NULL,
	`twilio_message_sid` varchar(100),
	`direction` varchar(10) NOT NULL,
	`from_number` varchar(20) NOT NULL,
	`to_number` varchar(20) NOT NULL,
	`body` text,
	`media_url` text,
	`status` varchar(30) DEFAULT 'received',
	`sent_by_employee_id` varchar(50),
	`is_read` tinyint DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sms_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `online_bookings` MODIFY COLUMN `status` enum('abandoned','pending','confirmed','en_route','in_progress','completed','follow_up_sent','closed','cancelled') NOT NULL DEFAULT 'confirmed';--> statement-breakpoint
ALTER TABLE `customers` ADD `do_not_service` tinyint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD `do_not_service_reason` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `show_on_booking_form` tinyint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `investors` ADD `role` varchar(32) DEFAULT 'investor' NOT NULL;--> statement-breakpoint
ALTER TABLE `online_bookings` ADD `preferred_detailer_id` varchar(64);--> statement-breakpoint
ALTER TABLE `online_bookings` ADD `preferred_detailer_name` varchar(255);--> statement-breakpoint
ALTER TABLE `online_bookings` ADD `assigned_to` varchar(255);--> statement-breakpoint
ALTER TABLE `online_bookings` ADD `pipeline_notes` text;--> statement-breakpoint
ALTER TABLE `online_bookings` ADD `webhook_payload` text;--> statement-breakpoint
ALTER TABLE `online_bookings` DROP COLUMN `zapier_payload`;