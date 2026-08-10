CREATE TABLE `break_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`break_id` varchar(64) NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`full_name` varchar(255) NOT NULL,
	`date` varchar(16) NOT NULL,
	`break_type` enum('morning_15min','afternoon_15min','lunch_30min') NOT NULL,
	`break_start_time` timestamp,
	`break_end_time` timestamp,
	`duration_minutes` int NOT NULL,
	`status` enum('pending','taken','skipped') NOT NULL DEFAULT 'pending',
	`notification_sent` enum('yes','no') NOT NULL DEFAULT 'no',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `break_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `break_records_break_id_unique` UNIQUE(`break_id`)
);
--> statement-breakpoint
CREATE TABLE `clock_in_out_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`record_id` varchar(64) NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`full_name` varchar(255) NOT NULL,
	`date` varchar(16) NOT NULL,
	`clock_in_time` timestamp,
	`clock_out_time` timestamp,
	`total_hours` decimal(6,2) DEFAULT '0',
	`status` enum('clocked_in','clocked_out') NOT NULL DEFAULT 'clocked_out',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `clock_in_out_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `clock_in_out_records_record_id_unique` UNIQUE(`record_id`)
);
