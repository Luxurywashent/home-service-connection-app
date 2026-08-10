CREATE TABLE `loan_payment_reminders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reminder_id` varchar(64) NOT NULL,
	`loan_id_lpr` varchar(64) NOT NULL,
	`schedule_id_lpr` varchar(64) NOT NULL,
	`reminder_type` enum('payment_due','payment_overdue','contract_pending') NOT NULL,
	`sent_at` datetime NOT NULL,
	`created_at_lpr` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `loan_payment_reminders_id` PRIMARY KEY(`id`),
	CONSTRAINT `loan_payment_reminders_reminder_id_unique` UNIQUE(`reminder_id`)
);
--> statement-breakpoint
ALTER TABLE `loan_contracts` ADD `contract_signed_at` datetime;--> statement-breakpoint
CREATE INDEX `loan_id_lpr_idx` ON `loan_payment_reminders` (`loan_id_lpr`);--> statement-breakpoint
CREATE INDEX `schedule_id_lpr_idx` ON `loan_payment_reminders` (`schedule_id_lpr`);