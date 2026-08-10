CREATE TABLE `employee_days_off` (
	`id` int AUTO_INCREMENT NOT NULL,
	`day_off_id` varchar(64) NOT NULL,
	`employee_id_do` varchar(64) NOT NULL,
	`full_name_do` varchar(255) NOT NULL,
	`off_date` varchar(16) NOT NULL,
	`reason_do` enum('pto','sick','personal','other') NOT NULL DEFAULT 'pto',
	`notes_do` text,
	`assigned_by_do` varchar(255),
	`created_at_do` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `employee_days_off_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_days_off_day_off_id_unique` UNIQUE(`day_off_id`)
);
