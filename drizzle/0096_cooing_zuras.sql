CREATE TABLE `loan_contracts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`loan_id` varchar(64) NOT NULL,
	`borrower_name` varchar(255) NOT NULL,
	`borrower_email` varchar(255) NOT NULL,
	`borrower_phone` varchar(20),
	`principal_amount` decimal(12,2) NOT NULL,
	`total_repayment_amount` decimal(12,2) NOT NULL,
	`number_of_payments` int NOT NULL,
	`payment_frequency` enum('weekly','biweekly','monthly') NOT NULL,
	`payment_day_of_week` int,
	`payment_day_of_month` varchar(50),
	`start_date` date NOT NULL,
	`status_lc` enum('draft','pending_signature','active','completed','cancelled') NOT NULL DEFAULT 'draft',
	`contract_url` text,
	`signed_contract_url` text,
	`signature_date` datetime,
	`created_at_lc` timestamp NOT NULL DEFAULT (now()),
	`updated_at_lc` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `loan_contracts_id` PRIMARY KEY(`id`),
	CONSTRAINT `loan_contracts_loan_id_unique` UNIQUE(`loan_id`)
);
--> statement-breakpoint
CREATE TABLE `loan_payment_schedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`schedule_id` varchar(64) NOT NULL,
	`loan_id_lps` varchar(64) NOT NULL,
	`payment_number` int NOT NULL,
	`due_date` date NOT NULL,
	`amount_due` decimal(12,2) NOT NULL,
	`status_lps` enum('scheduled','pending','completed','missed','delayed') NOT NULL DEFAULT 'scheduled',
	`reminder_sent_at` datetime,
	`created_at_lps` timestamp NOT NULL DEFAULT (now()),
	`updated_at_lps` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `loan_payment_schedules_id` PRIMARY KEY(`id`),
	CONSTRAINT `loan_payment_schedules_schedule_id_unique` UNIQUE(`schedule_id`)
);
--> statement-breakpoint
CREATE TABLE `loan_payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`payment_id` varchar(64) NOT NULL,
	`loan_id_lp` varchar(64) NOT NULL,
	`schedule_id_lp` varchar(64),
	`payment_number_lp` int NOT NULL,
	`amount_paid` decimal(12,2) NOT NULL,
	`paid_date` date NOT NULL,
	`payment_method` varchar(50),
	`notes_lp` text,
	`recorded_by` varchar(255),
	`created_at_lp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `loan_payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `loan_payments_payment_id_unique` UNIQUE(`payment_id`)
);
--> statement-breakpoint
CREATE INDEX `borrower_email_idx` ON `loan_contracts` (`borrower_email`);--> statement-breakpoint
CREATE INDEX `status_lc_idx` ON `loan_contracts` (`status_lc`);--> statement-breakpoint
CREATE INDEX `start_date_idx` ON `loan_contracts` (`start_date`);--> statement-breakpoint
CREATE INDEX `loan_id_lps_idx` ON `loan_payment_schedules` (`loan_id_lps`);--> statement-breakpoint
CREATE INDEX `due_date_idx` ON `loan_payment_schedules` (`due_date`);--> statement-breakpoint
CREATE INDEX `status_lps_idx` ON `loan_payment_schedules` (`status_lps`);--> statement-breakpoint
CREATE INDEX `loan_id_lp_idx` ON `loan_payments` (`loan_id_lp`);--> statement-breakpoint
CREATE INDEX `paid_date_idx` ON `loan_payments` (`paid_date`);