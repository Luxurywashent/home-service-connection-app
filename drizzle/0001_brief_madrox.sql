CREATE TABLE `daily_performance` (
	`id` int AUTO_INCREMENT NOT NULL,
	`record_id` varchar(64) NOT NULL,
	`date` varchar(16) NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`full_name` varchar(255),
	`city` varchar(128),
	`hours_worked` decimal(6,2) DEFAULT '0',
	`revenue_produced` decimal(10,2) DEFAULT '0',
	`efficiency_percent` decimal(5,2) DEFAULT '0',
	`upsells` int DEFAULT 0,
	`created_by` varchar(64),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `daily_performance_id` PRIMARY KEY(`id`),
	CONSTRAINT `daily_performance_record_id_unique` UNIQUE(`record_id`)
);
--> statement-breakpoint
CREATE TABLE `employees` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`full_name` varchar(255) NOT NULL,
	`email` varchar(320),
	`pin` varchar(6) NOT NULL,
	`role` enum('detailer','admin','office','operations_manager') NOT NULL,
	`city` varchar(128),
	`active_status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`hire_date` varchar(32),
	`profile_photo_url` text,
	`phone_number` varchar(32),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `employees_id` PRIMARY KEY(`id`),
	CONSTRAINT `employees_employee_id_unique` UNIQUE(`employee_id`)
);
--> statement-breakpoint
CREATE TABLE `notification_read_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`log_id` varchar(64) NOT NULL,
	`notification_id` varchar(64) NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`action_type` enum('read','acknowledged') NOT NULL,
	`action_timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notification_read_log_id` PRIMARY KEY(`id`),
	CONSTRAINT `notification_read_log_log_id_unique` UNIQUE(`log_id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`notification_id` varchar(64) NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`full_name` varchar(255),
	`notification_type` enum('qc_issue','write_up','missed_step','coaching_note','time_off_update','company_announcement') NOT NULL,
	`title` varchar(512) NOT NULL,
	`message` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`created_by` varchar(255),
	`status` enum('unread','read','acknowledged') NOT NULL DEFAULT 'unread',
	`requires_acknowledgment` enum('yes','no') NOT NULL DEFAULT 'no',
	`read_at` timestamp,
	`acknowledged_at` timestamp,
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `notifications_notification_id_unique` UNIQUE(`notification_id`)
);
--> statement-breakpoint
CREATE TABLE `time_off_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`request_id` varchar(64) NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`full_name` varchar(255),
	`submitted_at` timestamp NOT NULL DEFAULT (now()),
	`start_date` varchar(16) NOT NULL,
	`end_date` varchar(16) NOT NULL,
	`total_days_requested` int NOT NULL,
	`days_notice_given` int NOT NULL,
	`reason` text,
	`policy_valid` enum('yes','no') NOT NULL,
	`policy_message` text,
	`status` enum('pending','approved','denied') NOT NULL DEFAULT 'pending',
	`manager_note` text,
	`decided_by` varchar(255),
	`decided_at` timestamp,
	CONSTRAINT `time_off_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `time_off_requests_request_id_unique` UNIQUE(`request_id`)
);
