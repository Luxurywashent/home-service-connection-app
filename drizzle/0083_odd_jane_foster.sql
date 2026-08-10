CREATE TABLE `job_event_seen` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`job_event_id` int NOT NULL,
	`seen_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `job_event_seen_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `job_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`job_id` varchar(64) NOT NULL,
	`event_type` enum('created','cancelled','rescheduled') NOT NULL,
	`customer_name` varchar(255),
	`location` varchar(64),
	`date_str` varchar(20),
	`time_slot` varchar(64),
	`assigned_to` varchar(64),
	`created_at_je` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `job_events_id` PRIMARY KEY(`id`)
);
