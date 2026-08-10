CREATE TABLE `sales_performance` (
	`id` int AUTO_INCREMENT NOT NULL,
	`record_id` varchar(64) NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`full_name` varchar(255),
	`date` varchar(16) NOT NULL,
	`jobs_booked` int NOT NULL DEFAULT 0,
	`revenue_scheduled` decimal(10,2) NOT NULL DEFAULT '0',
	`last_job_id` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sales_performance_id` PRIMARY KEY(`id`),
	CONSTRAINT `sales_performance_record_id_unique` UNIQUE(`record_id`)
);
