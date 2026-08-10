CREATE TABLE `sales_callbacks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`callback_id` varchar(64) NOT NULL,
	`assigned_to` varchar(64) NOT NULL,
	`assigned_to_name` varchar(255),
	`prospect_first_name` varchar(128) NOT NULL,
	`prospect_last_name` varchar(128) NOT NULL,
	`prospect_phone` varchar(32) NOT NULL,
	`prospect_email` varchar(320),
	`scheduled_at` timestamp NOT NULL,
	`timezone` varchar(64) NOT NULL DEFAULT 'America/Chicago',
	`notes` text,
	`status` enum('scheduled','completed','missed','cancelled','rescheduled') NOT NULL DEFAULT 'scheduled',
	`completed_at` timestamp,
	`outcome` text,
	`ghl_triggered` enum('yes','no','failed') NOT NULL DEFAULT 'no',
	`ghl_triggered_at` timestamp,
	`ghl_payload` text,
	`ghl_response` text,
	`reminder_sent` enum('yes','no') NOT NULL DEFAULT 'no',
	`reminder_sent_at` timestamp,
	`created_by` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sales_callbacks_id` PRIMARY KEY(`id`),
	CONSTRAINT `sales_callbacks_callback_id_unique` UNIQUE(`callback_id`)
);
--> statement-breakpoint
ALTER TABLE `employees` MODIFY COLUMN `role` enum('detailer','admin','office','operations_manager','door_hanger_rep','sales') NOT NULL;