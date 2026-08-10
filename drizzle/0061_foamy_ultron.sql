CREATE TABLE `email_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`log_id` varchar(64) NOT NULL,
	`to` varchar(255) NOT NULL,
	`subject` varchar(500) NOT NULL,
	`type` enum('booking_confirmation','notification','other') NOT NULL DEFAULT 'other',
	`customer_name` varchar(255),
	`booking_ref` varchar(64),
	`status` enum('sent','failed') NOT NULL DEFAULT 'sent',
	`sent_at` datetime NOT NULL,
	CONSTRAINT `email_logs_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_logs_log_id_unique` UNIQUE(`log_id`)
);
