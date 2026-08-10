CREATE TABLE `finance_assets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`asset_id` varchar(64) NOT NULL,
	`asset_type` enum('current','fixed') NOT NULL,
	`name` varchar(255) NOT NULL,
	`value` decimal(12,2) NOT NULL,
	`location` varchar(128),
	`date_added` varchar(16) NOT NULL,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `finance_assets_id` PRIMARY KEY(`id`),
	CONSTRAINT `finance_assets_asset_id_unique` UNIQUE(`asset_id`)
);
--> statement-breakpoint
CREATE TABLE `finance_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category_id` varchar(64) NOT NULL,
	`type` enum('income','expense') NOT NULL,
	`name` varchar(128) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `finance_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `finance_categories_category_id_unique` UNIQUE(`category_id`)
);
--> statement-breakpoint
CREATE TABLE `finance_equity` (
	`id` int AUTO_INCREMENT NOT NULL,
	`equity_id` varchar(64) NOT NULL,
	`description` varchar(255) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`date` varchar(16) NOT NULL,
	`notes` text,
	`performed_by` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `finance_equity_id` PRIMARY KEY(`id`),
	CONSTRAINT `finance_equity_equity_id_unique` UNIQUE(`equity_id`)
);
--> statement-breakpoint
CREATE TABLE `finance_liabilities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`liability_id` varchar(64) NOT NULL,
	`liability_type` enum('loan','credit_card','equipment_financing','other') NOT NULL,
	`name` varchar(255) NOT NULL,
	`balance` decimal(12,2) NOT NULL,
	`monthly_payment` decimal(10,2),
	`interest_rate` decimal(5,2),
	`due_date` varchar(16),
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `finance_liabilities_id` PRIMARY KEY(`id`),
	CONSTRAINT `finance_liabilities_liability_id_unique` UNIQUE(`liability_id`)
);
--> statement-breakpoint
CREATE TABLE `finance_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tx_id` varchar(64) NOT NULL,
	`type` enum('income','expense') NOT NULL,
	`category_id` varchar(64) NOT NULL,
	`category_name` varchar(128) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`date` varchar(16) NOT NULL,
	`location` varchar(128) NOT NULL,
	`van` varchar(128),
	`notes` text,
	`receipt_url` varchar(1024),
	`receipt_uploaded_at` timestamp,
	`has_receipt` enum('yes','no') NOT NULL DEFAULT 'no',
	`performed_by` varchar(64) NOT NULL,
	`edit_history` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `finance_transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `finance_transactions_tx_id_unique` UNIQUE(`tx_id`)
);
