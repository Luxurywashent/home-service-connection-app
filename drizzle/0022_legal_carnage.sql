CREATE TABLE `detailer_locations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`full_name` varchar(255),
	`lat` decimal(10,7) NOT NULL,
	`lng` decimal(10,7) NOT NULL,
	`job_id` varchar(64),
	`status` enum('on_my_way','arrived','inactive') NOT NULL DEFAULT 'on_my_way',
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `detailer_locations_id` PRIMARY KEY(`id`),
	CONSTRAINT `detailer_locations_employee_id_unique` UNIQUE(`employee_id`)
);
--> statement-breakpoint
CREATE TABLE `tracking_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`token` varchar(32) NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`job_id` varchar(64) NOT NULL,
	`customer_address` varchar(512),
	`customer_lat` decimal(10,7),
	`customer_lng` decimal(10,7),
	`customer_name` varchar(255),
	`detailer_name` varchar(255),
	`expires_at` timestamp NOT NULL,
	`active` enum('yes','no') NOT NULL DEFAULT 'yes',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tracking_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `tracking_tokens_token_unique` UNIQUE(`token`)
);
