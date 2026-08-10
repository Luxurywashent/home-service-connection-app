CREATE TABLE `late_arrival_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`job_id` varchar(64) NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`detailer_name` varchar(255),
	`customer_name` varchar(255),
	`customer_phone` varchar(32),
	`delay_minutes` int NOT NULL,
	`new_eta` varchar(32),
	`sms_body` text,
	`sent_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `late_arrival_history_id` PRIMARY KEY(`id`)
);
