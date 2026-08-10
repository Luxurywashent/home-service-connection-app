CREATE TABLE `receptionist_call_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`call_id` varchar(64) NOT NULL,
	`call_sid` varchar(128),
	`caller_number` varchar(32),
	`outcome` enum('booked','inquiry','no_booking','failed') NOT NULL DEFAULT 'inquiry',
	`booking_id` varchar(64),
	`summary` text,
	`duration_seconds` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `receptionist_call_logs_id` PRIMARY KEY(`id`),
	CONSTRAINT `receptionist_call_logs_call_id_unique` UNIQUE(`call_id`)
);
