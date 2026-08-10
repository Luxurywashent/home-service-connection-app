CREATE TABLE `inventory_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category_id` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `inventory_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `inventory_categories_category_id_unique` UNIQUE(`category_id`)
);
--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`item_id` varchar(64) NOT NULL,
	`category_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`min_threshold` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `inventory_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `inventory_items_item_id_unique` UNIQUE(`item_id`)
);
--> statement-breakpoint
CREATE TABLE `inventory_locations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`location_id` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`city` varchar(128),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inventory_locations_id` PRIMARY KEY(`id`),
	CONSTRAINT `inventory_locations_location_id_unique` UNIQUE(`location_id`)
);
--> statement-breakpoint
CREATE TABLE `inventory_stock` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stock_id` varchar(64) NOT NULL,
	`item_id` varchar(64) NOT NULL,
	`location_type` enum('warehouse','location','van') NOT NULL,
	`location_id` varchar(64) NOT NULL,
	`quantity` int NOT NULL DEFAULT 0,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `inventory_stock_id` PRIMARY KEY(`id`),
	CONSTRAINT `inventory_stock_stock_id_unique` UNIQUE(`stock_id`)
);
--> statement-breakpoint
CREATE TABLE `inventory_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tx_id` varchar(64) NOT NULL,
	`item_id` varchar(64) NOT NULL,
	`item_name` varchar(255),
	`action_type` enum('add','remove','adjust','transfer_out','transfer_in') NOT NULL,
	`quantity` int NOT NULL,
	`location_type` enum('warehouse','location','van') NOT NULL,
	`location_id` varchar(64) NOT NULL,
	`location_name` varchar(128),
	`related_location_id` varchar(64),
	`related_location_name` varchar(128),
	`note` text,
	`performed_by` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inventory_transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `inventory_transactions_tx_id_unique` UNIQUE(`tx_id`)
);
--> statement-breakpoint
CREATE TABLE `inventory_vans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`van_id` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`location_id` varchar(64) NOT NULL,
	`assigned_employee_id` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inventory_vans_id` PRIMARY KEY(`id`),
	CONSTRAINT `inventory_vans_van_id_unique` UNIQUE(`van_id`)
);
--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `video_urls` text;