CREATE TABLE `bank_statements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`statement_id` varchar(64) NOT NULL,
	`city_id` varchar(64),
	`bank_name` varchar(128),
	`account_last4` varchar(4),
	`statement_date` varchar(16),
	`period_from` varchar(16),
	`period_to` varchar(16),
	`file_url` varchar(1024),
	`file_name` varchar(255),
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`tx_count` int NOT NULL DEFAULT 0,
	`imported_count` int NOT NULL DEFAULT 0,
	`error_msg` text,
	`uploaded_by` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bank_statements_id` PRIMARY KEY(`id`),
	CONSTRAINT `bank_statements_statement_id_unique` UNIQUE(`statement_id`)
);
--> statement-breakpoint
CREATE TABLE `bank_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bank_tx_id` varchar(64) NOT NULL,
	`statement_id` varchar(64) NOT NULL,
	`date` varchar(16) NOT NULL,
	`description` varchar(512) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`type` enum('debit','credit') NOT NULL,
	`category` varchar(128),
	`balance` decimal(12,2),
	`status` enum('unmatched','matched','ignored') NOT NULL DEFAULT 'unmatched',
	`matched_tx_id` varchar(64),
	`finance_entry_created` tinyint NOT NULL DEFAULT 0,
	`finance_entry_tx_id` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bank_transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `bank_transactions_bank_tx_id_unique` UNIQUE(`bank_tx_id`)
);
--> statement-breakpoint
ALTER TABLE `finance_transactions` ADD `city_id` varchar(64);--> statement-breakpoint
ALTER TABLE `finance_transactions` ADD `job_id` varchar(64);