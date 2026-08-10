CREATE TABLE `door_hanger_earnings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`record_id` varchar(64) NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`full_name` varchar(255),
	`week_start_date` varchar(16) NOT NULL,
	`photo_count` int NOT NULL DEFAULT 0,
	`total_earnings` decimal(10,2) NOT NULL DEFAULT '0',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `door_hanger_earnings_id` PRIMARY KEY(`id`),
	CONSTRAINT `door_hanger_earnings_record_id_unique` UNIQUE(`record_id`)
);
