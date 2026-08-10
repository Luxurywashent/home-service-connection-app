CREATE TABLE `invoice_line_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`line_id` varchar(64) NOT NULL,
	`invoice_id` varchar(64) NOT NULL,
	`description` varchar(512) NOT NULL,
	`quantity` decimal(8,2) NOT NULL DEFAULT '1',
	`unit_price` decimal(10,2) NOT NULL DEFAULT '0',
	`line_total` decimal(10,2) NOT NULL DEFAULT '0',
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at_ili` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invoice_line_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoice_line_items_line_id_unique` UNIQUE(`line_id`)
);
--> statement-breakpoint
CREATE TABLE `maintenance_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`record_id` varchar(64) NOT NULL,
	`customer_id` varchar(64) NOT NULL,
	`vehicle_id` varchar(64),
	`type` enum('oil_change','wiper_blades','tire_rotation','air_filter','brake_service','other') NOT NULL,
	`label` varchar(255) NOT NULL,
	`service_date` varchar(20) NOT NULL,
	`mileage_at_service` int,
	`next_service_date` varchar(20),
	`next_service_mileage` int,
	`notes` text,
	`created_at_mr` timestamp NOT NULL DEFAULT (now()),
	`updated_at_mr` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `maintenance_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `maintenance_records_record_id_unique` UNIQUE(`record_id`)
);
--> statement-breakpoint
CREATE TABLE `schedule_blockers` (
	`id` varchar(36) NOT NULL,
	`detailer_name` varchar(100) NOT NULL,
	`city` varchar(100) NOT NULL,
	`date` varchar(16) NOT NULL,
	`start_hour` decimal(4,2) NOT NULL DEFAULT '8.00',
	`end_hour` decimal(4,2) NOT NULL DEFAULT '17.00',
	`all_day` tinyint NOT NULL DEFAULT 1,
	`reason` varchar(255) NOT NULL DEFAULT 'Day Off',
	`created_by` varchar(100),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `schedule_blockers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `standalone_invoices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoice_id` varchar(64) NOT NULL,
	`invoice_number` varchar(32) NOT NULL,
	`customer_name` varchar(255) NOT NULL,
	`customer_email` varchar(255),
	`customer_phone` varchar(32),
	`notes` text,
	`subtotal` decimal(10,2) NOT NULL DEFAULT '0',
	`tax_rate` decimal(5,2) NOT NULL DEFAULT '0',
	`tax_amount` decimal(10,2) NOT NULL DEFAULT '0',
	`discount_amount` decimal(10,2) NOT NULL DEFAULT '0',
	`total_amount` decimal(10,2) NOT NULL DEFAULT '0',
	`amount_paid` decimal(10,2) NOT NULL DEFAULT '0',
	`status` enum('draft','sent','paid','partial','void') NOT NULL DEFAULT 'draft',
	`payment_method` varchar(64),
	`payment_note` text,
	`due_date` varchar(20),
	`sent_at` timestamp,
	`paid_at` timestamp,
	`created_by` varchar(64),
	`created_at_si` timestamp NOT NULL DEFAULT (now()),
	`updated_at_si` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `standalone_invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `standalone_invoices_invoice_id_unique` UNIQUE(`invoice_id`)
);
--> statement-breakpoint
CREATE TABLE `warranty_docs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`doc_id` varchar(64) NOT NULL,
	`customer_id` varchar(64) NOT NULL,
	`vehicle_id` varchar(64),
	`category` enum('battery','tire','brake','other') NOT NULL,
	`label` varchar(255) NOT NULL,
	`file_url` varchar(1024) NOT NULL,
	`file_name` varchar(255) NOT NULL,
	`expiry_date` varchar(20),
	`notes` text,
	`created_at_wd` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `warranty_docs_id` PRIMARY KEY(`id`),
	CONSTRAINT `warranty_docs_doc_id_unique` UNIQUE(`doc_id`)
);
--> statement-breakpoint
ALTER TABLE `break_records` ADD `break_start_lat` decimal(10,7);--> statement-breakpoint
ALTER TABLE `break_records` ADD `break_start_lng` decimal(10,7);--> statement-breakpoint
ALTER TABLE `break_records` ADD `break_end_lat` decimal(10,7);--> statement-breakpoint
ALTER TABLE `break_records` ADD `break_end_lng` decimal(10,7);--> statement-breakpoint
ALTER TABLE `clock_in_out_records` ADD `clock_in_lat` decimal(10,7);--> statement-breakpoint
ALTER TABLE `clock_in_out_records` ADD `clock_in_lng` decimal(10,7);--> statement-breakpoint
ALTER TABLE `clock_in_out_records` ADD `clock_out_lat` decimal(10,7);--> statement-breakpoint
ALTER TABLE `clock_in_out_records` ADD `clock_out_lng` decimal(10,7);--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `custom_price` decimal(10,2);--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `upsell_ids` text;--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `upsell_qtys` text;